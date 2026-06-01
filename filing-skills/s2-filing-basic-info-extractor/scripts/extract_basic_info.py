"""
S2 - 备案基础信息抓取主入口
输入: S1 LayoutResult 列表
输出: 备案基础信息抓取表 JSON (符合 extraction_schema.json)

核心流程: 聚合 S1 块 -> 字段抽取 -> 归一 -> 校验 -> 置信度
"""

from __future__ import annotations

import json
import logging
import re
from collections import defaultdict
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from validators import VALIDATORS  # 同目录

logger = logging.getLogger(__name__)


# ---------- 数据结构 ----------

@dataclass
class Source:
    material_id: str
    file_name: str
    block_id: str
    page: int = 0
    excerpt: str = ""


@dataclass
class ValidationResult:
    status: str = "skipped"  # passed | warning | failed | skipped
    message: str = ""


@dataclass
class SheetItem:
    category: str
    item_key: str
    item_name: str
    ai_value: Any = ""
    confirmed_value: Any = ""
    extract_status: str = "missing"  # success | missing | exception
    confidence: float = 0.0
    source: Source | None = None
    candidate_sources: list[Source] = field(default_factory=list)
    validation_result: ValidationResult = field(default_factory=ValidationResult)
    review_required: bool = True
    logic_flags: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict:
        d = asdict(self)
        if self.source is None:
            d["source"] = None
        return d


# ---------- 主入口 ----------

def extract_basic_info(
    project_id: str,
    layout_results: list[dict],
    field_dictionary_path: str | Path = None,
    known_fields: dict | None = None,
    domain_rules_path: str | Path | None = None,
    user_corrections: list[dict] | None = None,
) -> dict:
    """
    输入:
      project_id: 项目 ID
      layout_results: S1 输出列表, 每项是 LayoutResult.to_dict()
      field_dictionary_path: 字段权威清单路径
      known_fields: 调用方已知字段, 直接覆盖抽取结果

    输出:
      basic_info_sheet dict
    """
    # 1) 加载字段清单
    field_dictionary_path = Path(field_dictionary_path or _default_dict_path())
    field_dict = json.loads(field_dictionary_path.read_text(encoding="utf-8"))
    domain_rules = _load_domain_rules(domain_rules_path)

    # 2) 聚合: 把所有材料的块按 semantic_tag 分桶
    bucket = _bucket_blocks_by_tag(layout_results)
    supplier_rows = _collect_supplier_rows(layout_results)

    # 3) 抽取每个字段
    items: list[SheetItem] = []
    for fdef in field_dict["fields"]:
        if fdef.get("is_row_field"):
            continue  # 供应商行字段单独处理
        item = _extract_one_field(fdef, bucket, domain_rules)
        items.append(item)

    # 4) 供应商行字段展开
    for idx, row in enumerate(supplier_rows, start=1):
        for fdef in field_dict["fields"]:
            if not fdef.get("is_row_field"):
                continue
            item = _extract_supplier_field(fdef, row, idx)
            items.append(item)

    # 5) known_fields 覆盖
    for key, value in (known_fields or {}).items():
        for it in items:
            if it.item_key == key:
                it.confirmed_value = value
                it.review_required = False
                break

    # 6) 跨字段校验(如 bid_open_time > bid_close_time)
    logic_checks = _cross_validate(items, field_dict, domain_rules)
    review_queue = _build_review_queue(items)
    rule_feedback = _build_rule_feedback(items, user_corrections or [])

    return {
        "basic_info_sheet": {
            "project_id": project_id,
            "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "items": [it.to_dict() for it in items],
            "logic_checks": logic_checks,
            "review_queue": review_queue,
            "rule_feedback": rule_feedback,
        }
    }


# ---------- 聚合 ----------

def _bucket_blocks_by_tag(layout_results: list[dict]) -> dict[str, list[dict]]:
    """按 semantic_tag 分桶,每个块附带 material_id/file_name 上下文"""
    bucket: dict[str, list[dict]] = defaultdict(list)
    for lr in layout_results:
        for blk in lr.get("blocks", []):
            tag = blk.get("semantic_tag", "unknown")
            enriched = {
                **blk,
                "_material_id": lr["material_id"],
                "_file_name": lr["file_name"],
                "_parse_status": lr.get("parse_status"),
            }
            bucket[tag].append(enriched)
            bucket["_all"].append(enriched)
    return bucket


def _collect_supplier_rows(layout_results: list[dict]) -> list[dict]:
    """
    把所有材料里 supplier_list_header 表格的行展开成 row dict 列表。
    """
    rows = []
    for lr in layout_results:
        for blk in lr.get("blocks", []):
            if blk.get("semantic_tag") != "supplier_list_header":
                continue
            if blk.get("block_type") != "table" or not blk.get("table_data"):
                continue
            table = blk["table_data"]
            if len(table) < 2:
                continue
            header = [h.strip() for h in table[0]]
            for r in table[1:]:
                row = dict(zip(header, [c.strip() for c in r]))
                row["_material_id"] = lr["material_id"]
                row["_file_name"] = lr["file_name"]
                row["_block_id"] = blk["block_id"]
                rows.append(row)
    return rows


# ---------- 单字段抽取 ----------

def _extract_one_field(fdef: dict, bucket: dict[str, list[dict]], domain_rules: dict) -> SheetItem:
    fdef = _with_domain_aliases(fdef, domain_rules)
    key = fdef["key"]
    item = SheetItem(
        category=fdef["category"],
        item_key=key,
        item_name=fdef["name"],
    )

    candidates = _find_field_candidates(fdef, bucket, domain_rules)
    candidates = _prefer_precise_candidates(candidates, fdef)
    if not candidates:
        # 没命中 semantic_tag, 留给后续 LLM 兜底(本骨架不实现)
        item.extract_status = "missing"
        item.validation_result = ValidationResult("warning", f"未在材料中找到{fdef['name']}")
        item.review_required = True
        return item

    # 选 page 最小 + confidence 最高
    best = sorted(candidates, key=lambda b: (b.get("page", 999), -b.get("confidence", 0)))[0]
    raw_text = best["text"]
    normalized = _normalize_value(raw_text, fdef)
    normalized_values = _distinct_normalized_values(candidates, fdef)

    item.ai_value = normalized
    item.confidence = best.get("confidence", 0.5)
    item.source = Source(
        material_id=best["_material_id"],
        file_name=best["_file_name"],
        block_id=best["block_id"],
        page=best.get("page", 0),
        excerpt=raw_text[:200],
    )
    item.candidate_sources = [
        Source(
            material_id=c["_material_id"],
            file_name=c["_file_name"],
            block_id=c["block_id"],
            page=c.get("page", 0),
            excerpt=c.get("text", "")[:200],
        )
        for c in candidates[:5]
    ]
    item.metadata["candidate_count"] = len(candidates)
    item.metadata["match_reasons"] = sorted({c.get("_match_reason", "semantic_tag") for c in candidates})
    item.review_required = False

    if len(normalized_values) > 1:
        item.extract_status = "exception"
        item.review_required = True
        item.validation_result = ValidationResult(
            "warning",
            f"发现多个候选值,需人工确认: {normalized_values[:5]}",
        )
        item.logic_flags.append("candidate_conflict")
        return item

    # 校验
    validator_name = fdef.get("validator")
    if validator_name and validator_name in VALIDATORS:
        v_status, v_msg = VALIDATORS[validator_name](normalized, fdef)
        item.validation_result = ValidationResult(v_status, v_msg)
        if v_status == "failed":
            item.extract_status = "exception"
            item.review_required = True
            return item
        if v_status == "warning":
            item.review_required = True

    item.extract_status = "success"
    if item.confidence < 0.7:
        item.review_required = True
    return item


def _extract_supplier_field(fdef: dict, row: dict, idx: int) -> SheetItem:
    """从供应商行 row 字典里取一个字段"""
    aliases = {
        "supplier_name": ["供应商名称", "投标人名称", "单位名称", "报名单位"],
        "social_credit_code": ["统一社会信用代码", "信用代码", "社会信用代码"],
        "registration_time": ["报名时间", "登记时间", "提交时间"],
        "registration_status": ["报名状态", "状态", "审核状态"],
        "supplier_contact": ["联系方式", "联系电话", "联系人/电话", "联系人"],
    }
    raw = _lookup_row_value(row, aliases.get(fdef["key"], []))
    item = SheetItem(
        category=fdef["category"],
        item_key=f"supplier_{idx}.{fdef['key']}",
        item_name=f"供应商{idx}-{fdef['name']}",
    )
    if not raw:
        item.extract_status = "missing"
        item.validation_result = ValidationResult("warning", f"供应商{idx}的{fdef['name']}缺失")
        return item

    normalized = _normalize_value(raw, fdef)
    item.ai_value = normalized
    item.confidence = 0.85  # 表格抽取默认置信度,可后续替换
    item.review_required = False
    item.source = Source(
        material_id=row["_material_id"],
        file_name=row["_file_name"],
        block_id=row["_block_id"],
        excerpt=raw[:200],
    )

    validator_name = fdef.get("validator")
    if validator_name and validator_name in VALIDATORS:
        v_status, v_msg = VALIDATORS[validator_name](normalized, fdef)
        item.validation_result = ValidationResult(v_status, v_msg)
        if v_status == "failed":
            item.extract_status = "exception"
            item.review_required = True
            return item
        if v_status == "warning":
            item.review_required = True

    item.extract_status = "success"
    return item


def _find_field_candidates(fdef: dict, bucket: dict[str, list[dict]], domain_rules: dict) -> list[dict]:
    key = fdef["key"]
    candidates: list[dict] = []
    seen: set[tuple[str, str]] = set()

    def add(block: dict, reason: str) -> None:
        ident = (block.get("_material_id", ""), block.get("block_id", ""))
        if ident in seen:
            return
        seen.add(ident)
        candidates.append({**block, "_match_reason": reason})

    for block in bucket.get(key, []):
        add(block, "semantic_tag")

    aliases = set(fdef.get("aliases", []))
    aliases.add(fdef.get("name", ""))
    aliases.update(domain_rules.get("field_aliases", {}).get(key, []))
    aliases = {a for a in aliases if a}

    if aliases:
        for block in bucket.get("_all", []):
            table_text = _extract_table_candidate_text(block, aliases)
            if table_text:
                add({**block, "text": table_text}, "table_label")
                continue
            text = block.get("text", "")
            if any(alias in text for alias in aliases):
                add(block, "alias")
    return candidates


def _with_domain_aliases(fdef: dict, domain_rules: dict) -> dict:
    aliases = set(fdef.get("aliases", []))
    aliases.update(domain_rules.get("field_aliases", {}).get(fdef["key"], []))
    if not aliases:
        return fdef
    return {**fdef, "aliases": sorted(aliases, key=len, reverse=True)}


def _prefer_precise_candidates(candidates: list[dict], fdef: dict) -> list[dict]:
    """优先使用表格标签或明确'字段名:值'候选,减少叙述句误命中。"""
    table_candidates = [c for c in candidates if c.get("_match_reason") == "table_label"]
    if table_candidates:
        return table_candidates
    aliases = [fdef.get("name", ""), *fdef.get("aliases", [])]
    labeled = [
        c for c in candidates
        if _looks_like_labeled_value(c.get("text", ""), aliases)
    ]
    return labeled or candidates


def _looks_like_labeled_value(text: str, aliases: list[str]) -> bool:
    text = str(text or "").strip()
    for alias in sorted((a for a in aliases if a), key=len, reverse=True):
        if text.startswith(alias):
            return True
    return False


def _extract_table_candidate_text(block: dict, aliases: set[str]) -> str:
    """从普通两列表/登记表中按'字段名-值'相邻单元格抽候选文本。"""
    table = block.get("table_data")
    if block.get("block_type") != "table" or not table:
        return ""
    normalized_aliases = [a.strip().replace(" ", "") for a in aliases if a]
    header = [str(c or "").strip() for c in table[0]]
    first_header = header[0].replace(" ", "") if header else ""
    if first_header in {"序号", "编号"}:
        for col_idx, header_cell in enumerate(header):
            compact_header = header_cell.replace(" ", "")
            if not any(alias and compact_header.startswith(alias) for alias in normalized_aliases):
                continue
            for row in table[1:]:
                if col_idx < len(row):
                    value = str(row[col_idx] or "").strip()
                    if value:
                        return f"{header_cell}: {value}"
    for row in table:
        cells = [str(c or "").strip() for c in row]
        if not cells:
            continue
        label = cells[0]
        compact = label.replace(" ", "")
        if not compact:
            continue
        if not any(alias and compact.startswith(alias) for alias in normalized_aliases):
            continue
        right_values = [c for c in cells[1:] if c]
        if right_values:
            return f"{label}: {right_values[0]}"
        m = re.search(r"[:：]\s*(.+)$", label)
        if m:
            return label
    return ""


def _distinct_normalized_values(candidates: list[dict], fdef: dict) -> list[Any]:
    values = []
    for c in candidates:
        value = _normalize_value(c.get("text", ""), fdef)
        if value in ("", None):
            continue
        if value not in values:
            values.append(value)
    return values


def _lookup_row_value(row: dict, aliases: list[str]) -> str:
    normalized_headers = {str(k).strip().replace(" ", ""): v for k, v in row.items()}
    for alias in aliases:
        key = alias.strip().replace(" ", "")
        if key in normalized_headers:
            return str(normalized_headers[key]).strip()
    for header, value in normalized_headers.items():
        if any(alias.replace(" ", "") in header for alias in aliases):
            return str(value).strip()
    return ""


# ---------- 归一化 ----------

def _normalize_value(raw: str, fdef: dict) -> Any:
    """把原始文本归一成字段类型对应的值。"""
    ftype = fdef.get("type")
    text = raw.strip()
    # 去除常见前缀,如"项目名称:" / "项目编号:"
    names = sorted({fdef["name"], *fdef.get("aliases", [])}, key=len, reverse=True)
    for name in names:
        text = re.sub(rf"^.*?{re.escape(name)}\s*[:：]\s*", "", text)

    if ftype == "decimal":
        if _looks_like_dynamic_pricing(text):
            return text
        # 抽数字 + 处理"万"
        m = re.search(r"([\d,]+\.?\d*)\s*(万|元)?", text)
        if not m:
            return text
        num = float(m.group(1).replace(",", ""))
        unit = m.group(2) or "元"
        if unit == "万":
            num *= 10000
        return num

    if ftype == "integer":
        m = re.search(r"\d+", text)
        if not m:
            return text
        return int(m.group(0))

    if ftype == "datetime":
        # 把"2025年6月18日 09:30"统一成 ISO; 这里只做轻量
        text = (text.replace("年", "-").replace("月", "-").replace("日", " ")
                    .replace("时", ":").replace("分", "").strip())
        return text

    if ftype == "enum":
        for opt in fdef.get("enum", []):
            if opt in text:
                return opt
        return text

    if fdef.get("key") == "project_name":
        return re.sub(r"(招标文件|采购文件|磋商文件|谈判文件)$", "", text).strip()

    return text


# ---------- 跨字段校验 ----------

def _cross_validate(items: list[SheetItem], field_dict: dict, domain_rules: dict) -> list[dict]:
    by_key = {it.item_key: it for it in items}
    checks: list[dict] = []
    for fdef in field_dict["fields"]:
        cross = fdef.get("cross_check")
        if not cross:
            continue
        if cross.startswith("must_be_after:"):
            other = cross.split(":", 1)[1]
            a = by_key.get(fdef["key"])
            b = by_key.get(other)
            a_dt = _parse_datetime_for_compare(a.ai_value) if a else None
            b_dt = _parse_datetime_for_compare(b.ai_value) if b else None
            ok = bool(a_dt and b_dt and a_dt >= b_dt)
            checks.append({
                "type": "cross_field_order",
                "field": fdef["key"],
                "depends_on": other,
                "status": "passed" if ok else "warning",
            })
            if a and b and a.ai_value and b.ai_value and a_dt and b_dt and a_dt < b_dt:
                a.validation_result = ValidationResult(
                    "failed", f"{a.item_name}必须晚于{b.item_name},当前出现倒置"
                )
                a.extract_status = "exception"
                a.review_required = True
                a.logic_flags.append(f"must_be_after:{other}")

    for rule in domain_rules.get("logic_required_pairs", []):
        when = by_key.get(rule.get("when"))
        require = by_key.get(rule.get("require"))
        if when and when.ai_value and (not require or not require.ai_value):
            checks.append({
                "type": "domain_required_pair",
                "field": rule.get("when"),
                "requires": rule.get("require"),
                "status": "warning",
                "message": rule.get("message", "命中领域规则后缺少配套字段"),
            })
            when.logic_flags.append(f"requires:{rule.get('require')}")
            when.review_required = True
    return checks


def _parse_datetime_for_compare(value: Any) -> datetime | None:
    text = str(value or "").strip()
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d", "%Y/%m/%d %H:%M", "%Y/%m/%d"):
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue
    return None


def _looks_like_dynamic_pricing(text: str) -> bool:
    return any(key in text for key in ("下浮率", "折扣率", "动态结算", "据实结算", "单价结算"))


def _build_review_queue(items: list[SheetItem]) -> list[dict]:
    queue = []
    for item in items:
        if not item.review_required:
            continue
        queue.append({
            "item_key": item.item_key,
            "item_name": item.item_name,
            "extract_status": item.extract_status,
            "reason": item.validation_result.message or ";".join(item.logic_flags) or "低置信/需确认",
        })
    return queue


def _build_rule_feedback(items: list[SheetItem], user_corrections: list[dict]) -> list[dict]:
    feedback = []
    for item in items:
        if item.extract_status in {"missing", "exception"}:
            feedback.append({
                "item_key": item.item_key,
                "event": item.extract_status,
                "suggested_action": "补充字段别名/校验规则或人工确认标准来源",
            })
    for correction in user_corrections:
        feedback.append({
            "item_key": correction.get("item_key"),
            "event": "user_correction",
            "before": correction.get("before"),
            "after": correction.get("after"),
            "suggested_action": "将人工修正沉淀到 domain_rules.field_aliases 或 field_dictionary",
        })
    return feedback


def _load_domain_rules(path: str | Path | None) -> dict:
    if path:
        return json.loads(Path(path).read_text(encoding="utf-8-sig"))
    default = Path(__file__).resolve().parent.parent / "references" / "domain_rules.json"
    if default.exists():
        return json.loads(default.read_text(encoding="utf-8"))
    return {"field_aliases": {}, "logic_required_pairs": []}


# ---------- 辅助 ----------

def _default_dict_path() -> Path:
    return Path(__file__).resolve().parent.parent / "references" / "field_dictionary.json"


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("layout_results", help="S1 输出 JSON 文件路径(列表)")
    parser.add_argument("--project-id", default="proj_001")
    parser.add_argument("--output", "-o")
    args = parser.parse_args()

    layouts = json.loads(Path(args.layout_results).read_text(encoding="utf-8-sig"))
    if isinstance(layouts, dict):
        layouts = [layouts]
    result = extract_basic_info(args.project_id, layouts)
    text = json.dumps(result, ensure_ascii=False, indent=2)
    if args.output:
        Path(args.output).write_text(text, encoding="utf-8")
    else:
        print(text)
