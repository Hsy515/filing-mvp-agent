"""
S5 - 开评标表格生成主入口

流程: 加载表格定义 -> 从 S2 抓取表 + extra_data 组装 placeholder_mapping
     -> 调用 S4 的 inject_docx/inject_xlsx 完成模板注入

注意:
  - 本脚本不内嵌评审结论,只把数据摆到表格里,留待专家填
  - 模板文件需由模板设计师按 S4 占位符规范提供,不在本仓库分发
"""

from __future__ import annotations

import json
import logging
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# 让本脚本可调用 S4 的注入函数
_S4_SCRIPTS = Path(__file__).resolve().parents[2] / "s4-office-template-injector" / "scripts"
if str(_S4_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(_S4_SCRIPTS))


def generate_eval_table(
    project_id: str,
    table_type: str,
    basic_info_sheet: dict,
    template_path: str | Path,
    output_path: str | Path,
    extra_data: dict | None = None,
    table_definitions_path: str | Path | None = None,
    strict_mode: bool = False,
) -> dict:
    """
    主入口:按 table_type 生成对应的评标表格。
    """
    extra_data = extra_data or {}
    definitions = _load_definitions(table_definitions_path)

    table_def = definitions.get("tables", {}).get(table_type)
    if not table_def:
        return {
            "table_type": table_type,
            "output_path": str(output_path),
            "status": "failed",
            "supplier_count": 0,
            "missing_fields": [],
            "warnings": [f"未知的 table_type: {table_type}"],
        }

    if table_def.get("$status") == "placeholder":
        return {
            "table_type": table_type,
            "output_path": str(output_path),
            "status": "failed",
            "supplier_count": 0,
            "missing_fields": [],
            "warnings": [f"{table_def.get('name', table_type)} 在首版仍为占位定义,正式上线前需补全字段映射和模板"],
        }

    # 1) 索引字段表
    field_index = _index_sheet_items(basic_info_sheet)
    supplier_rows = _collect_supplier_rows(field_index)

    # 2) 组装 placeholder_mapping
    mapping, missing_fields = _build_mapping(table_def, field_index, supplier_rows, extra_data)

    # 3) 检查模板存在
    template_path = Path(template_path)
    if not template_path.exists():
        return {
            "table_type": table_type,
            "output_path": str(output_path),
            "status": "failed",
            "supplier_count": len(supplier_rows),
            "missing_fields": missing_fields,
            "warnings": [f"模板文件不存在: {template_path}; 请联系模板设计师按 S4 占位符规范提供"],
        }

    # 4) 调用 S4 注入
    fmt = table_def.get("template_format", "docx")
    if fmt == "docx":
        from inject_docx import inject_docx
        inject_res = inject_docx(template_path, output_path, mapping, strict_mode=strict_mode).to_dict()
    elif fmt == "xlsx":
        from inject_xlsx import inject_xlsx
        inject_res = inject_xlsx(template_path, output_path, mapping, strict_mode=strict_mode)
    else:
        return {
            "table_type": table_type,
            "output_path": str(output_path),
            "status": "failed",
            "supplier_count": len(supplier_rows),
            "missing_fields": missing_fields,
            "warnings": [f"不支持的 template_format: {fmt}"],
        }

    return {
        "table_type": table_type,
        "output_path": inject_res.get("output_path", str(output_path)),
        "status": inject_res.get("status", "success") if not missing_fields else "partial",
        "supplier_count": len(supplier_rows),
        "missing_fields": missing_fields,
        "warnings": inject_res.get("warnings", []),
    }


# ---------- 组装 mapping ----------

def _build_mapping(
    table_def: dict,
    field_index: dict[str, dict],
    supplier_rows: list[dict],
    extra_data: dict,
) -> tuple[dict, list[str]]:
    """根据 table_def 构造 S4 兼容的 placeholder_mapping"""
    mapping: dict[str, dict] = {}
    missing: list[str] = []

    # 头部占位符
    for ph, spec in table_def.get("header_placeholders", {}).items():
        value, ok = _resolve_header_value(spec, field_index, extra_data)
        if not ok:
            missing.append(ph)
        render_type = spec.get("render_type", "text")
        entry: dict[str, Any] = {"type": render_type, "value": value}
        if render_type == "date" and spec.get("format"):
            entry["format"] = spec["format"]
        mapping[ph] = entry

    # 行表格
    row_table = table_def.get("row_table")
    if row_table and supplier_rows:
        anchor_ph = row_table["anchor_placeholder"]
        rows_payload = []
        for idx, srow in enumerate(supplier_rows, start=1):
            row: dict[str, Any] = {}
            for col in row_table.get("columns", []):
                row[col["field"]] = _resolve_row_value(col, srow, idx)
            rows_payload.append(row)

        # anchor 名取占位符里的 token
        anchor_name = anchor_ph.replace("{", "").replace("}", "").replace("#", "")
        mapping[anchor_ph] = {
            "type": "table_rows",
            "anchor": anchor_name,
            "rows": rows_payload,
        }
    elif row_table and not supplier_rows:
        missing.append(row_table["anchor_placeholder"])

    return mapping, missing


def _resolve_header_value(spec: dict, field_index: dict, extra_data: dict) -> tuple[Any, bool]:
    src = spec.get("from")
    if src == "field":
        item = field_index.get(spec["item_key"])
        if not item:
            return "", False
        value = item.get("confirmed_value") or item.get("ai_value") or ""
        return value, value not in ("", None)
    if src == "extra":
        value = extra_data.get(spec["key"], "")
        return value, value not in ("", None)
    if src == "static":
        return spec.get("value", ""), True
    return "", False


def _resolve_row_value(col: dict, supplier_row: dict, auto_index: int) -> Any:
    src = col.get("source")
    if src == "auto_index":
        return auto_index
    if src == "static":
        return col.get("value", "")
    if src == "supplier_field":
        return supplier_row.get(col["item_key"], "")
    return ""


# ---------- 索引 / 聚合 ----------

def _index_sheet_items(sheet: dict) -> dict[str, dict]:
    items = sheet.get("basic_info_sheet", {}).get("items", [])
    return {it["item_key"]: it for it in items}


def _collect_supplier_rows(field_index: dict[str, dict]) -> list[dict]:
    """把 supplier_<n>.<field> 字段聚合成行"""
    rows_dict: dict[int, dict] = defaultdict(dict)
    for key, item in field_index.items():
        if not key.startswith("supplier_"):
            continue
        try:
            idx_str, sub_key = key.split(".", 1)
            idx = int(idx_str.replace("supplier_", ""))
        except (ValueError, IndexError):
            continue
        rows_dict[idx][sub_key] = item.get("confirmed_value") or item.get("ai_value") or ""
    return [rows_dict[k] for k in sorted(rows_dict)]


def _load_definitions(override_path: str | Path | None) -> dict:
    if override_path:
        return json.loads(Path(override_path).read_text(encoding="utf-8"))
    default = Path(__file__).resolve().parent.parent / "references" / "table_definitions.json"
    return json.loads(default.read_text(encoding="utf-8"))


# ---------- CLI ----------

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--sheet", required=True, help="S2 输出 JSON 路径")
    parser.add_argument("--table-type", required=True,
                        choices=["qualification_review", "compliance_review",
                                 "score_summary", "attendance", "bid_opening_record"])
    parser.add_argument("--template", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--extra", help="extra_data JSON 文件(可选)")
    parser.add_argument("--project-id", default="proj_001")
    parser.add_argument("--strict", action="store_true")
    args = parser.parse_args()

    sheet = json.loads(Path(args.sheet).read_text(encoding="utf-8-sig"))
    extra = json.loads(Path(args.extra).read_text(encoding="utf-8-sig")) if args.extra else {}

    res = generate_eval_table(
        project_id=args.project_id,
        table_type=args.table_type,
        basic_info_sheet=sheet,
        template_path=args.template,
        output_path=args.output,
        extra_data=extra,
        strict_mode=args.strict,
    )
    print(json.dumps(res, ensure_ascii=False, indent=2))
