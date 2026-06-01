"""
S3 - 初稿大纲组装
把目录匹配结果 + 章节模板 + 字段表 编织成可注入 S4 的大纲 JSON。

注意: 本脚本不写入正文文本! 正文渲染由 S4 完成。这里只生成"骨架 + 引用"。
"""

from __future__ import annotations

import json
from pathlib import Path


def assemble_draft_outline(
    match_result: dict,
    basic_info_sheet: dict,
    outline_template_path: str | Path | None = None,
) -> list[dict]:
    """
    输入:
      match_result: match_directory() 输出
      basic_info_sheet: S2 输出
      outline_template_path: 自定义大纲模板路径,默认用 references/draft_outline_template.json

    输出: draft_outline 列表
    """
    template_path = Path(outline_template_path or _default_outline_path())
    template = json.loads(template_path.read_text(encoding="utf-8"))

    # 索引匹配结果
    match_by_dir = {dm["directory_item_id"]: dm for dm in match_result.get("directory_matches", [])}
    field_index = {it["item_key"]: it for it in basic_info_sheet.get("basic_info_sheet", {}).get("items", [])}

    outline = []
    for sec in template["sections"]:
        section = {
            "section_id": sec["section_id"],
            "section_title": sec["section_title"],
            "directory_item_ids": sec.get("directory_item_ids", []),
            "content_refs": [],
            "status": "ready",  # ready | partial | blocked
            "missing_refs": [],
        }

        for ref in sec.get("content_refs", []):
            resolved, ok = _resolve_ref(ref, match_by_dir, field_index)
            if not ok and ref.get("required", True) is False:
                resolved["optional"] = True
                resolved["resolution"] = resolved.get("resolution", "missing") + "_optional"
                ok = True
            section["content_refs"].append(resolved)
            if not ok:
                section["missing_refs"].append(resolved)

        # 状态: 全部引用都解析成功 -> ready; 部分缺失 -> partial; 全部缺失 -> blocked
        total = len(section["content_refs"])
        missing = len(section["missing_refs"])
        if total == 0:
            section["status"] = "ready"
        elif missing == 0:
            section["status"] = "ready"
        elif missing < total:
            section["status"] = "partial"
        else:
            section["status"] = "blocked"

        outline.append(section)

    return outline


def _resolve_ref(ref: dict, match_by_dir: dict, field_index: dict) -> tuple[dict, bool]:
    """
    解析一个 content_ref,补充实际值或材料引用。
    返回 (解析后的 ref, 是否成功)
    """
    rtype = ref.get("type")

    if rtype == "field":
        key = ref["item_key"]
        item = field_index.get(key)
        if not item:
            return {**ref, "value": None, "resolution": "field_not_defined"}, False
        # 优先 confirmed_value
        value = item.get("confirmed_value") or item.get("ai_value") or None
        ok = item.get("extract_status") == "success" and value not in (None, "")
        return {
            **ref,
            "value": value,
            "review_required": item.get("review_required", False),
            "resolution": "ok" if ok else "missing_or_unconfirmed",
        }, ok

    if rtype == "material":
        dir_id = ref.get("directory_item_id")
        dm = match_by_dir.get(dir_id)
        if not dm:
            return {**ref, "resolved_materials": [], "resolution": "directory_item_not_found"}, False
        if dm["match_status"] != "matched":
            return {
                **ref,
                "resolved_materials": [],
                "resolution": f"status_{dm['match_status']}",
            }, False
        return {
            **ref,
            "resolved_materials": dm["matched_materials"],
            "resolution": "ok",
        }, True

    if rtype == "table":
        # 自动表格生成: 目前支持 supplier_list
        if ref.get("source") == "supplier_list":
            rows = _build_supplier_table(field_index)
            return {
                **ref,
                "table_rows": rows,
                "resolution": "ok" if rows else "no_supplier_data",
            }, bool(rows)
        return {**ref, "resolution": "unsupported_table_source"}, False

    return {**ref, "resolution": "unknown_ref_type"}, False


def _build_supplier_table(field_index: dict) -> list[dict]:
    """从 supplier_<n>.* 字段聚合出供应商行"""
    rows_dict: dict[int, dict] = {}
    for key, item in field_index.items():
        if not key.startswith("supplier_"):
            continue
        try:
            idx_str, sub_key = key.split(".", 1)
            idx = int(idx_str.replace("supplier_", ""))
        except (ValueError, IndexError):
            continue
        rows_dict.setdefault(idx, {"_index": idx})
        rows_dict[idx][sub_key] = item.get("confirmed_value") or item.get("ai_value") or ""

    return [rows_dict[k] for k in sorted(rows_dict)]


def _default_outline_path() -> Path:
    return Path(__file__).resolve().parent.parent / "references" / "draft_outline_template.json"


if __name__ == "__main__":
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--match", required=True, help="match_directory 输出")
    p.add_argument("--sheet", required=True, help="S2 抓取表")
    p.add_argument("--output", "-o")
    args = p.parse_args()

    match = json.loads(Path(args.match).read_text(encoding="utf-8"))
    sheet = json.loads(Path(args.sheet).read_text(encoding="utf-8"))
    outline = assemble_draft_outline(match, sheet)
    text = json.dumps(outline, ensure_ascii=False, indent=2)
    if args.output:
        Path(args.output).write_text(text, encoding="utf-8")
    else:
        print(text)
