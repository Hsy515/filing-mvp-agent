---
name: s5-bid-evaluation-table-generator
description: 开评标配套表格生成。当用户需要基于已抓取的项目字段和供应商报名信息,生成资格审查表、符合性审查表、得分汇总表、签到表、开标记录表等开评标配套表格时,使用本 Skill。任何"生成资格审查表"、"做符合性审查"、"评标得分汇总"、"开评标表格"、"评审表生成"、"签到表"的请求都应触发本 Skill。本 Skill 复用 S2 的字段抓取结果,通过 S4 的模板注入能力输出 Word/Excel,首版作为演示和扩展入口。
---

# S5 - 开评标表格生成

## 这个 Skill 解决什么问题

S3 处理"备案归档"——把材料归到目录里;但开评标过程还需要一套**操作类表格**:资格审查打勾、符合性审查打勾、技术分商务分汇总、签到、开标记录等。这些表格的特点是:

- **格式高度固定**(企业模板),不允许 AI 自由发挥
- **数据来源结构化**(基本来自 S2 的字段表 + 供应商列表)
- **不是合规结论**,只是把数据按模板摆好,真实评审仍由专家完成

首版 MVP 的定位是**演示入口 + 样例输出**,证明产品能扩展到开评标环节,正式上线前需要补全模板和评分规则。

**不做的事**:不抽字段(S2)、不做评审结论(专家)、不破坏模板排版(具体注入交给 S4)。

## 触发条件

- `资格审查表`、`符合性审查表`、`得分汇总表`、`评分表`、`评标报告附件`
- `开标记录`、`签到表`、`唱标表`
- `开评标表格`、`评审表生成`、`评标配套材料`
- 用户已完成报名汇总,准备进入开评标环节

## 支持的表格类型(首版)

| table_type | 中文名 | 来源数据 | 模板 |
|---|---|---|---|
| `qualification_review` | 资格审查表 | 供应商列表 + 项目基本字段 | `assets/templates/资格审查表.docx`(待补) |
| `compliance_review` | 符合性审查表 | 供应商列表 + 项目基本字段 | `assets/templates/符合性审查表.docx`(待补) |
| `score_summary` | 得分汇总表 | 供应商列表 + 评分规则(外部) | `assets/templates/得分汇总表.xlsx`(待补) |
| `attendance` | 签到表 | 供应商列表 | `assets/templates/签到表.docx`(待补) |
| `bid_opening_record` | 开标记录表 | 项目字段 + 供应商列表 + 唱标价(外部) | `assets/templates/开标记录表.xlsx`(待补) |

每种表格的字段映射定义在 `references/table_definitions.json`。**模板文件由模板设计师按 S4 占位符规范提供**,本 Skill 不内嵌二进制模板。

## 输入

```json
{
  "project_id": "proj_001",
  "table_type": "qualification_review",
  "basic_info_sheet": { /* S2 输出 */ },
  "template_path": "/templates/资格审查表.docx",
  "output_path": "/output/proj_001_资格审查表.docx",
  "extra_data": {
    "review_panel": ["专家A", "专家B", "专家C"],
    "review_date": "2025-06-18"
  }
}
```

## 输出

```json
{
  "table_type": "qualification_review",
  "output_path": "/output/proj_001_资格审查表.docx",
  "status": "success | partial | failed",
  "supplier_count": 3,
  "missing_fields": [],
  "warnings": []
}
```

## 处理流程

1. **加载表格定义** — 从 `references/table_definitions.json` 取出 `table_type` 对应的 placeholder mapping 模板
2. **拼装数据**:
   - 项目基本字段:从 S2 抓取表 items 里按 `item_key` 取 `confirmed_value` 或 `ai_value`
   - 供应商表格:聚合 `supplier_<n>.*` 字段为 rows
   - 评分项 / 评审项:从外部 `extra_data` 取(首版可为空)
3. **生成 placeholder_mapping** — 按 S4 规范的 JSON 结构组装
4. **调用 S4 模板注入** — 直接复用 `scripts/inject_docx.py` 或 `scripts/inject_xlsx.py`
5. **报告缺失** — 字段缺失或供应商列表为空时,`status` 标记为 partial,在 `warnings` 里列出

## 字段映射示例(资格审查表)

```jsonc
{
  "qualification_review": {
    "template_format": "docx",
    "header_placeholders": {
      "{{project_name}}": { "from": "field", "item_key": "project_name" },
      "{{project_id}}":   { "from": "field", "item_key": "project_id" },
      "{{review_date}}":  { "from": "extra", "key": "review_date", "type": "date", "format": "YYYY年M月D日" }
    },
    "table_anchor": "{{#supplier_table}}",
    "row_source": "supplier_list",
    "row_columns": [
      { "field": "index",              "source": "auto_index" },
      { "field": "name",               "source": "supplier_name" },
      { "field": "code",               "source": "social_credit_code" },
      { "field": "qualification_pass", "source": "static", "value": "待审查" }
    ]
  }
}
```

**注意**:`qualification_pass` 的值是"待审查"占位,首版**不给出审查结论**,等专家填。这是 S5 与"合规结论"的边界。

## 边界与人工复核

| 能做 | 不能做 |
|---|---|
| 把字段填进固定格式的表格 | 给出"通过/不通过"结论(由专家) |
| 自动生成供应商行 | 自动给打分(由专家) |
| 引用 S4 输出 docx/xlsx | 输出最终评标报告全文 |
| 首版作为演示入口 | 正式使用前需补全所有模板和评分规则配置 |

## 首版与后续

**首版只做最小可行**:
- 提供 `qualification_review` 和 `attendance` 两个表的完整字段定义和样例 mapping
- 其他表格类型在 `table_definitions.json` 里占位,实际模板和字段补全留给下一版
- 演示场景下,如果模板缺失,返回 `status=failed`,`warnings` 里写"模板待补"

**后续扩展**:
- 支持评分规则注入(技术分 / 商务分公式)
- 支持开标价格唱标自动写入
- 支持评标专家签字位的处理
- 支持多包件项目按包件拆分表格

## 脚本与参考

- `scripts/generate_eval_tables.py` — 主入口,根据 table_type 分发
- `references/table_definitions.json` — 各表格字段映射(权威)
- `assets/sample_qualification_review_mapping.json` — 资格审查表 mapping 样例
- `assets/extension_roadmap.md` — 后续扩展路线
