"""
S1 - 语义打标模块
基于关键词 + 正则的轻量打标。**只做粗粒度路由提示**,不抽精确字段值。
精确字段抽取由 S2 完成。
"""

from __future__ import annotations

import re
from typing import Iterable


# 关键词词典: tag -> 触发关键词列表(任一命中即可)
KEYWORD_RULES: dict[str, list[str]] = {
    "project_name": ["项目名称", "采购项目名称", "工程名称"],
    "project_id": ["项目编号", "采购编号", "标段编号", "项目代码"],
    "purchase_method": ["采购方式", "招标方式"],
    "budget": ["预算金额", "采购预算", "最高限价", "招标控制价"],
    "package_division": ["包件划分", "标包划分", "分包情况"],
    "package_count": ["项目包数", "包数", "标包数量"],
    "purchase_content": ["采购内容", "采购需求", "标的物"],
    "purchaser": ["采购人名称", "采购人", "招标人", "采购单位"],
    "agent": ["代理机构", "招标代理", "采购代理"],
    "notice_type": ["招标公告", "竞争性谈判公告", "竞争性磋商公告", "询价公告", "更正公告", "中标公告"],
    "notice_publish_time": ["公告发布时间", "发布时间", "公告日期"],
    "registration_start": ["报名开始", "获取文件开始", "发售开始"],
    "registration_end": ["报名截止", "获取文件截止", "报名结束"],
    "bid_open_time": ["开标时间", "评标时间"],
    "bid_close_time": ["递交截止", "投标截止", "响应文件递交"],
    "question_channel": ["质疑截止", "投诉渠道", "异议期", "质疑投诉渠道"],
    "contact_info": ["联系人", "联系电话", "联系方式", "电子邮箱"],
    "winner_name": ["中标人", "中标供应商", "成交供应商", "中标单位", "成交单位", "中标（成交）单位"],
    "winning_amount": ["中标金额", "成交金额", "中标价", "成交价", "中标（成交）金额"],
    "project_manager": ["项目负责人", "项目经理"],
    "project_team_members": ["项目小组成员", "项目组成员", "小组成员"],
    "acceptance_note": ["验收情况说明", "验收情况", "履约验收说明", "验收说明"],
    "extra_archive_requirement": ["额外归档", "另需归档", "补充归档"],
    "format_requirement": ["指定格式", "格式要求", "模板要求"],
    "temporary_rule": ["临时要求", "临时性约束", "统一下浮率", "动态结算", "临时调整", "新增条款"],
    "special_requirement": ["特殊要求", "备注", "特别说明", "特别约定", "资格要求", "评审要求", "地方标准", "行业标准", "隐含条件"],
    "supplier_list_header": ["供应商名称", "投标人名称", "统一社会信用代码"],
}

# 正则规则: tag -> 正则列表
REGEX_RULES: dict[str, list[re.Pattern]] = {
    "social_credit_code": [
        re.compile(r"\b[0-9A-Z]{18}\b"),  # 统一社会信用代码 18 位
    ],
    "project_id": [
        re.compile(r"[A-Z]{2,}[-_]?\d{4,}"),  # 常见编号格式,如 GCZB-2025-001
    ],
}


def tag_blocks(blocks: Iterable) -> None:
    """
    原地修改 blocks,给每个 block.semantic_tag 赋值。
    优先级: 表格块特殊处理 > 关键词命中 > 正则命中 > unknown
    """
    in_supplier_table = False
    for blk in blocks:
        # 0) 标题通常就是项目名,即便没有显式"项目名称:"前缀。
        if blk.block_type == "title" and any(kw in blk.text for kw in ("招标文件", "采购文件", "采购项目")):
            blk.semantic_tag = "project_name"
            in_supplier_table = False
            continue

        # 1) 表格块特殊处理
        if blk.block_type == "table":
            blk.semantic_tag = _tag_table(blk)
            in_supplier_table = (blk.semantic_tag == "supplier_list_header")
            continue

        # 2) 在供应商表格上下文中的连续行
        if in_supplier_table and blk.block_type in ("paragraph", "list_item"):
            blk.semantic_tag = "supplier_list_row"
            continue

        # 3) 关键词命中
        tag = _match_keyword(blk.text)
        if tag != "unknown":
            blk.semantic_tag = tag
            continue

        # 4) 正则兜底
        tag = _match_regex(blk.text)
        blk.semantic_tag = tag


def _match_keyword(text: str) -> str:
    for tag, kws in KEYWORD_RULES.items():
        for kw in kws:
            if kw in text:
                return tag
    return "unknown"


def _match_regex(text: str) -> str:
    for tag, patterns in REGEX_RULES.items():
        for p in patterns:
            if p.search(text):
                return tag
    return "unknown"


def _tag_table(blk) -> str:
    """
    给表格块打标:检查首行(表头)是否包含 supplier_list_header 关键词。
    """
    if not blk.table_data or not blk.table_data[0]:
        return "unknown"
    header_text = " ".join(str(c) for c in blk.table_data[0])
    for kw in KEYWORD_RULES["supplier_list_header"]:
        if kw in header_text:
            return "supplier_list_header"
    return "unknown"
