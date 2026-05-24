"""
S2 - 字段校验函数集合
每个校验函数签名: (value, field_def) -> (status, message)
status ∈ {"passed", "warning", "failed"}
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any


def validate_project_id(value: str, fdef: dict) -> tuple[str, str]:
    if not value:
        return "failed", "项目编号为空"
    if not re.match(r"^[A-Za-z\u4e00-\u9fa5]{1,10}[-_]?\d{2,}", value):
        return "warning", f"项目编号格式不常见: {value}"
    return "passed", "格式正常"


def validate_amount(value: Any, fdef: dict) -> tuple[str, str]:
    try:
        num = float(value)
    except (TypeError, ValueError):
        return "failed", f"金额无法解析为数值: {value}"
    if num <= 0:
        return "failed", "金额必须大于 0"
    if num > 1e10:
        return "warning", "金额超过 100 亿,请核对单位是否正确"
    return "passed", "金额合法"


def validate_enum(value: str, fdef: dict) -> tuple[str, str]:
    enum_values = fdef.get("enum", [])
    if value in enum_values:
        return "passed", "枚举合法"
    return "failed", f"取值 '{value}' 不在允许范围: {enum_values}"


def validate_datetime(value: str, fdef: dict) -> tuple[str, str]:
    if not value:
        return "failed", "时间为空"
    # 尝试几种常见格式
    formats = [
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M",
        "%Y-%m-%d",
        "%Y/%m/%d %H:%M",
        "%Y/%m/%d",
    ]
    for fmt in formats:
        try:
            datetime.strptime(value.strip(), fmt)
            return "passed", "时间格式正常"
        except ValueError:
            continue
    return "warning", f"无法识别的时间格式: {value}"


def validate_social_credit_code(value: str, fdef: dict) -> tuple[str, str]:
    if not value:
        return "failed", "统一社会信用代码为空"
    if len(value) != 18:
        return "failed", f"长度应为 18,实际 {len(value)}"
    if not re.match(r"^[0-9A-Z]{18}$", value):
        return "failed", "包含非法字符,只能是数字和大写字母"
    # 完整算法: 校验码计算,这里仅做格式校验
    return "passed", "信用代码格式正常(未做校验码计算)"


def validate_contact(value: str, fdef: dict) -> tuple[str, str]:
    if not value:
        return "failed", "联系方式为空"
    has_phone = bool(re.search(r"1[3-9]\d{9}|\d{3,4}-?\d{7,8}", value))
    has_email = bool(re.search(r"[\w\.-]+@[\w\.-]+\.\w+", value))
    if has_phone or has_email:
        return "passed", "联系方式格式正常"
    return "warning", "未找到有效的电话或邮箱"


VALIDATORS = {
    "validate_project_id": validate_project_id,
    "validate_amount": validate_amount,
    "validate_enum": validate_enum,
    "validate_datetime": validate_datetime,
    "validate_social_credit_code": validate_social_credit_code,
    "validate_contact": validate_contact,
}
