"""
S2 - 备案基础信息抓取主入口
输入: S1 LayoutResult 列表
输出: 备案基础信息抓取表 JSON (符合 extraction_schema.json)

核心流程: 聚合 S1 块 -> 字段抽取 -> 归一 -> 校验 -> 置信度
"""

from __future__ import annotations

import json
import logging
from collections import defaultdict
from dataclasses import dataclass, field, asdict
from datetime import datetime
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
    validation_result: ValidationResult = field(default_factory=ValidationResult)
    review_required: bool = True

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

    # 2) 聚合: 把所有材料的块按 semantic_tag 分桶
    bucket = _bucket_blocks_by_tag(layout_results)
    supplier_rows = _collect_supplier_rows(layout_results)

    # 3) 抽取每个字段
    items: list[SheetItem] = []
    for fdef in field_dict["fields"]:
        if fdef.get("is_row_field"):
            continue  # 供应商行字段单独处理
        item = _extract_one_field(fdef, bucket)
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
    _cross_validate(items, field_dict)

    return {
        "basic_info_sheet": {
            "project_id": project_id,
            "generated_at": datetime.utcnow().isoformat() + "Z",
            "items": [it.to_dict() for it in items],
        }
    }


# ---------- 聚合 ----------

def _bucket_blocks_by_tag(layout_results: list[dict]) -> dict[str, list[dict]]:
    """按 semantic_tag 分桶,每个块附带 material_id/file_name 上下文"""
    bucket: dict[str, list[dict]] = defaultdict(list)
    for lr in layout_results:
        for blk in lr.get("blocks", []):
            tag = blk.get("semantic_tag", "unknown")
            bucket[tag].append({
                **blk,
                "_material_id": lr["material_id"],
                "_file_name": lr["file_name"],
            })
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

def _extract_one_field(fdef: dict, bucket: dict[str, list[dict]]) -> SheetItem:
    key = fdef["key"]
    item = SheetItem(
        category=fdef["category"],
        item_key=key,
        item_name=fdef["name"],
    )

    candidates = bucket.get(key, [])
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

    item.ai_value = normalized
    item.confidence = best.get("confidence", 0.5)
    item.source = Source(
        material_id=best["_material_id"],
        file_name=best["_file_name"],
        block_id=best["block_id"],
        page=best.get("page", 0),
        excerpt=raw_text[:200],
    )

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
    name_to_value = {
        "supplier_name": row.get("供应商名称", ""),
        "social_credit_code": row.get("统一社会信用代码", ""),
        "registration_time": row.get("报名时间", ""),
        "registration_status": row.get("报名状态", ""),
        "supplier_contact": row.get("联系方式", ""),
    }
    raw = name_to_value.get(fdef["key"], "")
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

    item.extract_status = "success"
    return item


# ---------- 归一化 ----------

def _normalize_value(raw: str, fdef: dict) -> Any:
    """把原始文本归一成字段类型对应的值。"""
    import re
    ftype = fdef.get("type")
    text = raw.strip()
    # 去除常见前缀,如"项目名称:" / "项目编号:"
    text = re.sub(rf"^{re.escape(fdef['name'])}[:：\s]*", "", text)

    if ftype == "decimal":
        # 抽数字 + 处理"万"
        m = re.search(r"([\d,]+\.?\d*)\s*(万|元)?", text)
        if not m:
            return text
        num = float(m.group(1).replace(",", ""))
        unit = m.group(2) or "元"
        if unit == "万":
            num *= 10000
        return num

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

def _cross_validate(items: list[SheetItem], field_dict: dict) -> None:
    by_key = {it.item_key: it for it in items}
    for fdef in field_dict["fields"]:
        cross = fdef.get("cross_check")
        if not cross:
            continue
        if cross.startswith("must_be_after:"):
            other = cross.split(":", 1)[1]
            a = by_key.get(fdef["key"])
            b = by_key.get(other)
            if a and b and a.ai_value and b.ai_value and a.ai_value < b.ai_value:
                a.validation_result = ValidationResult(
                    "failed", f"{a.item_name}必须晚于{b.item_name},当前出现倒置"
                )
                a.extract_status = "exception"
                a.review_required = True


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
