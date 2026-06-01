"""
S3 - 备案目录匹配引擎
输入: 标准目录 + 材料元数据 + S2 抓取表 + S1 块
输出: 目录匹配结果 + 缺失/异常/待替换清单
"""

from __future__ import annotations

import json
import logging
from collections import defaultdict
from dataclasses import dataclass, field, asdict
from pathlib import Path

logger = logging.getLogger(__name__)


@dataclass
class MatchedMaterial:
    material_id: str
    file_name: str = ""
    evidence_block_ids: list[str] = field(default_factory=list)
    confidence: float = 0.0
    hit_rules: list[str] = field(default_factory=list)
    evidence_summary: str = ""


@dataclass
class DirectoryMatch:
    directory_item_id: str
    directory_item_name: str
    required: bool
    match_status: str = "missing"  # matched | missing | needs_replacement | exception
    matched_materials: list[MatchedMaterial] = field(default_factory=list)
    review_required: bool = True
    remark: str = ""
    diagnostics: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "directory_item_id": self.directory_item_id,
            "directory_item_name": self.directory_item_name,
            "required": self.required,
            "match_status": self.match_status,
            "matched_materials": [asdict(m) for m in self.matched_materials],
            "review_required": self.review_required,
            "remark": self.remark,
            "diagnostics": self.diagnostics,
        }


# ---------- 入口 ----------

def match_directory(
    project_id: str,
    directory_template_id: str,
    materials_meta: list[dict],
    basic_info_sheet: dict,
    layout_results: list[dict] | None = None,
    special_constraints: list[dict] | None = None,
    purchase_method: str | None = None,
    template_path: str | Path | None = None,
) -> dict:
    """主匹配函数"""
    # 1. 加载目录模板
    template = _load_template(directory_template_id, template_path)

    # 2. 准备索引: material_id -> blocks
    blocks_index = _index_blocks_by_material(layout_results or [])

    # 3. 字段表索引: item_key -> SheetItem
    field_index = _index_sheet_items(basic_info_sheet)
    purchase_method = purchase_method or _field_value(field_index, "purchase_method")

    # 4. 注入特殊约束生成的临时目录项
    items = list(template["items"])
    all_constraints = list(special_constraints or [])
    all_constraints.extend(_constraints_from_sheet(field_index))
    items.extend(_constraints_to_items(all_constraints))

    # 5. 逐项匹配
    matches: list[DirectoryMatch] = []
    for ditem in items:
        # 过滤不适用的采购方式
        applicable = ditem.get("applicable_purchase_methods", [])
        if applicable and purchase_method and purchase_method not in applicable:
            continue
        dm = _match_one_item(ditem, materials_meta, blocks_index, field_index)
        matches.append(dm)

    # 6. 收集 missing/exception/needs_replacement 列表
    missing = [m.directory_item_id for m in matches if m.match_status == "missing" and m.required]
    needs_replacement = [m.directory_item_id for m in matches if m.match_status == "needs_replacement"]
    exceptions = [m.directory_item_id for m in matches if m.match_status == "exception"]
    dependency_checks = _check_directory_dependencies(matches, field_index)
    coverage_warnings = _build_coverage_warnings(items, matches)

    return {
        "directory_matches": [m.to_dict() for m in matches],
        "missing_items": missing,
        "needs_replacement_items": needs_replacement,
        "exceptions": exceptions,
        "constraints_applied": [c["key"] for c in all_constraints],
        "dependency_checks": dependency_checks,
        "coverage_warnings": coverage_warnings,
    }


# ---------- 单项匹配 ----------

def _match_one_item(
    ditem: dict,
    materials_meta: list[dict],
    blocks_index: dict[str, list[dict]],
    field_index: dict[str, dict],
) -> DirectoryMatch:
    dm = DirectoryMatch(
        directory_item_id=ditem["directory_item_id"],
        directory_item_name=ditem["directory_item_name"],
        required=ditem.get("required", False),
    )

    rules = ditem.get("match_rules", [])
    for mat in materials_meta:
        material_id = mat["material_id"]
        hits = []
        confidences = []
        evidence_block_ids = []

        for rule in rules:
            ok, conf, evidence = _apply_rule(rule, mat, blocks_index.get(material_id, []), field_index)
            if ok:
                hits.append(_rule_label(rule))
                confidences.append(conf)
                evidence_block_ids.extend(evidence)

        if hits:
            evidence_summary = _summarize_evidence(evidence_block_ids, blocks_index.get(material_id, []))
            dm.matched_materials.append(MatchedMaterial(
                material_id=material_id,
                file_name=mat.get("file_name", ""),
                evidence_block_ids=list(dict.fromkeys(evidence_block_ids)),  # 去重保序
                confidence=max(confidences) if confidences else 0.5,
                hit_rules=hits,
                evidence_summary=evidence_summary,
            ))

    # 状态判定
    if not dm.matched_materials:
        dm.match_status = "missing" if dm.required else "matched"  # 非必需缺失视为通过
        if not dm.required:
            dm.review_required = False
            dm.remark = "非必需项,本项目未涉及"
        else:
            dm.review_required = True
            dm.remark = "必需项缺失,需补充材料"
        return dm

    best_conf = max(m.confidence for m in dm.matched_materials)
    if best_conf < 0.6:
        dm.match_status = "exception"
        dm.review_required = True
        dm.remark = f"匹配置信度过低 ({best_conf:.2f}),需人工确认"
        dm.diagnostics.append("low_confidence_match")
    elif len(dm.matched_materials) > 1 and _has_conflict(dm.matched_materials):
        dm.match_status = "needs_replacement"
        dm.review_required = True
        dm.remark = "多份材料同时匹配且内容存在冲突,需人工确认保留哪一份"
        dm.diagnostics.append("multiple_high_confidence_materials")
    else:
        dm.match_status = "matched"
        dm.review_required = best_conf < 0.85

    return dm


def _apply_rule(
    rule: dict,
    material: dict,
    material_blocks: list[dict],
    field_index: dict[str, dict],
) -> tuple[bool, float, list[str]]:
    """返回 (是否命中, 置信度, 证据 block_id 列表)"""
    rtype = rule.get("type")

    if rtype == "filename_keyword":
        file_name = material.get("file_name", "")
        for kw in rule.get("keywords", []):
            if kw in file_name:
                return True, 0.85, []
        return False, 0.0, []

    if rtype == "material_type":
        hint = material.get("material_type_hint", "")
        if hint in rule.get("values", []):
            return True, 0.95, []
        return False, 0.0, []

    if rtype == "content_tag":
        wanted = set(rule.get("tags", []))
        min_hits = rule.get("min_hits", 1)
        hit_blocks = [b["block_id"] for b in material_blocks if b.get("semantic_tag") in wanted]
        if len(hit_blocks) >= min_hits:
            return True, min(0.6 + 0.1 * len(hit_blocks), 0.95), hit_blocks
        return False, 0.0, []

    if rtype == "content_keyword":
        keywords = rule.get("keywords", [])
        min_hits = rule.get("min_hits", 1)
        hit_blocks = []
        for block in material_blocks:
            text = block.get("text", "")
            if any(kw in text for kw in keywords):
                hit_blocks.append(block["block_id"])
        if len(hit_blocks) >= min_hits:
            return True, min(0.62 + 0.08 * len(hit_blocks), 0.92), hit_blocks
        return False, 0.0, []

    if rtype == "field_present":
        keys = rule.get("item_keys", [])
        # 字段在抓取表里 success
        present = []
        for k in keys:
            it = field_index.get(k)
            # supplier_1.* 也算
            if not it:
                present.extend([fk for fk in field_index if fk.startswith(k.replace("supplier_1", "supplier_"))])
                continue
            if it and it.get("extract_status") == "success":
                present.append(k)
        if present:
            return True, 0.8, []
        return False, 0.0, []

    if rtype == "field_value_contains":
        for key in rule.get("item_keys", []):
            item = field_index.get(key)
            value = _item_value(item)
            if value and any(kw in str(value) for kw in rule.get("keywords", [])):
                return True, 0.75, []
        return False, 0.0, []

    return False, 0.0, []


def _rule_label(rule: dict) -> str:
    rtype = rule.get("type")
    if rtype == "filename_keyword":
        return f"filename:{rule.get('keywords', [])}"
    if rtype == "material_type":
        return f"type:{rule.get('values', [])}"
    if rtype == "content_tag":
        return f"tag:{rule.get('tags', [])}"
    if rtype == "field_present":
        return f"field:{rule.get('item_keys', [])}"
    if rtype == "content_keyword":
        return f"keyword:{rule.get('keywords', [])}"
    if rtype == "field_value_contains":
        return f"field_contains:{rule.get('item_keys', [])}"
    return rtype or "unknown"


def _has_conflict(materials: list[MatchedMaterial]) -> bool:
    """
    简化版冲突检测: 多个材料置信度都 >= 0.85 视为可能冲突,需人工裁决。
    真实实现可以比较具体字段值是否一致。
    """
    high = [m for m in materials if m.confidence >= 0.85]
    distinct_names = {m.file_name or m.material_id for m in high}
    return len(distinct_names) >= 2


def _summarize_evidence(block_ids: list[str], material_blocks: list[dict]) -> str:
    by_id = {b.get("block_id"): b for b in material_blocks}
    excerpts = []
    for block_id in list(dict.fromkeys(block_ids))[:3]:
        text = (by_id.get(block_id, {}).get("text") or "").strip()
        if text:
            excerpts.append(text[:60])
    return " | ".join(excerpts)


# ---------- 索引辅助 ----------

def _index_blocks_by_material(layout_results: list[dict]) -> dict[str, list[dict]]:
    idx = defaultdict(list)
    for lr in layout_results:
        idx[lr["material_id"]].extend(lr.get("blocks", []))
    return idx


def _index_sheet_items(sheet: dict) -> dict[str, dict]:
    items = sheet.get("basic_info_sheet", {}).get("items", [])
    return {it["item_key"]: it for it in items}


def _item_value(item: dict | None):
    if not item:
        return ""
    return item.get("confirmed_value") or item.get("ai_value") or ""


def _field_value(field_index: dict[str, dict], key: str) -> str:
    return str(_item_value(field_index.get(key)) or "")


def _load_template(template_id: str, override_path: str | Path | None) -> dict:
    if override_path:
        return json.loads(Path(override_path).read_text(encoding="utf-8"))
    default = Path(__file__).resolve().parent.parent / "references" / "standard_directory.json"
    template = json.loads(default.read_text(encoding="utf-8"))
    if template.get("template_id") != template_id:
        logger.warning("请求的模板 %s 与默认模板 %s 不一致", template_id, template.get("template_id"))
    return template


def _constraints_to_items(constraints: list[dict]) -> list[dict]:
    """把特殊约束转化为临时必需目录项"""
    items = []
    for i, c in enumerate(constraints, start=900):
        value = str(c.get("value", "")).strip()
        keywords = c.get("keywords") or ([value] if value else [])
        items.append({
            "directory_item_id": f"dir_{i}",
            "directory_item_name": f"特殊归档:{value}",
            "required": True,
            "match_rules": [
                {"type": "content_keyword", "keywords": keywords, "min_hits": 1}
            ] if keywords else [],
            "applicable_purchase_methods": [],
            "_from_constraint": c.get("key"),
        })
    return items


def _constraints_from_sheet(field_index: dict[str, dict]) -> list[dict]:
    constraints = []
    for key in ("extra_archive_requirement", "temporary_rule", "format_requirement"):
        value = _field_value(field_index, key)
        if value:
            constraints.append({"key": key, "value": value})
    return constraints


def _check_directory_dependencies(matches: list[DirectoryMatch], field_index: dict[str, dict]) -> list[dict]:
    by_id = {m.directory_item_id: m for m in matches}
    checks = []
    if _field_value(field_index, "temporary_rule"):
        checks.append({
            "type": "temporary_rule_requires_manual_review",
            "status": "warning",
            "message": "存在临时规则/动态结算描述,需人工确认是否新增目录项或替换模板。",
        })
    if by_id.get("dir_006") and by_id["dir_006"].match_status == "missing" and by_id.get("dir_007"):
        checks.append({
            "type": "review_record_dependency",
            "status": "warning",
            "message": "资格审查表缺失时,评标报告/评审记录链路可能不完整。",
        })
    return checks


def _build_coverage_warnings(items: list[dict], matches: list[DirectoryMatch]) -> list[dict]:
    by_id = {m.directory_item_id: m for m in matches}
    warnings = []
    for item in items:
        match = by_id.get(item["directory_item_id"])
        if item.get("required") and not item.get("match_rules"):
            warnings.append({
                "directory_item_id": item["directory_item_id"],
                "message": "必需目录项缺少自动匹配规则,只能进入人工归档。",
            })
        if match and match.match_status == "missing" and item.get("required"):
            warnings.append({
                "directory_item_id": item["directory_item_id"],
                "message": "必需目录项未匹配,需补材料或扩充规则。",
            })
    return warnings


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--sheet", required=True, help="S2 输出 JSON")
    parser.add_argument("--materials", required=True, help="materials_meta JSON 列表")
    parser.add_argument("--layouts", help="S1 LayoutResult JSON 列表(可选)")
    parser.add_argument("--project-id", default="proj_001")
    parser.add_argument("--template-id", default="std_filing_v3")
    parser.add_argument("--output", "-o")
    args = parser.parse_args()

    sheet = json.loads(Path(args.sheet).read_text(encoding="utf-8-sig"))
    materials = json.loads(Path(args.materials).read_text(encoding="utf-8-sig"))
    layouts = json.loads(Path(args.layouts).read_text(encoding="utf-8-sig")) if args.layouts else []
    # 兼容: 单个 LayoutResult dict 也允许传入
    if isinstance(layouts, dict):
        layouts = [layouts]

    res = match_directory(
        args.project_id, args.template_id, materials, sheet, layouts
    )
    text = json.dumps(res, ensure_ascii=False, indent=2)
    if args.output:
        Path(args.output).write_text(text, encoding="utf-8")
    else:
        print(text)
