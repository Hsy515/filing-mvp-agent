---
name: s3-filing-directory-matcher
description: 备案材料目录匹配与初稿组装。当用户需要把已上传的材料(招标文件、公告、报名表、合同等)与标准备案目录逐项对应,并生成"已匹配/缺失/待替换/异常"清单和备案初稿大纲时,使用本 Skill。任何"备案目录匹配"、"材料归档"、"备案清单核对"、"哪些材料缺失"、"一键归档"、"备案初稿"的请求都应触发本 Skill。本 Skill 消费 S2 的字段抓取表 + S1 的版面块,产出目录匹配结果 + 初稿大纲,后续 S4 把它注入模板生成最终文档。
---

# S3 - 备案材料目录匹配与初稿组装

## 这个 Skill 解决什么问题

公司有一份标准的"备案材料目录"(比如:1. 项目立项申请、2. 招标文件、3. 公告原文、4. 评标报告、5. 中标通知书……)。给定一堆已上传材料和已抽好的字段表,这个 Skill 要回答三个问题:

1. **目录里每一项有没有对应材料?** — 给出 matched/missing/needs_replacement/exception
2. **匹配的依据是什么?** — 每个匹配标注来源 material_id + 关键证据 block_id
3. **初稿长什么样?** — 输出可以直接交给 S4 注入模板的初稿大纲 JSON

**不做的事**:不解析原始文件(S1)、不抽字段(S2)、不生成最终 Word/Excel(S4)、不判断合规结论(人工)。

## 触发条件

- `目录匹配`、`备案目录`、`材料归档`、`核对材料清单`、`查漏补缺`
- `备案初稿`、`初稿大纲`、`备案文档结构`
- 用户提到"哪些材料还差"、"对一下目录"、"按目录归类"
- 已经完成 S1+S2,自然进入"对照标准目录"环节

## 输入

```json
{
  "project_id": "proj_001",
  "directory_template_id": "std_filing_v3",
  "basic_info_sheet": { /* S2 输出 */ },
  "materials_meta": [
    { "material_id": "mat_001", "file_name": "招标文件.pdf", "material_type_hint": "tender_document" }
  ],
  "layout_results": [ /* S1 输出列表,可选,用作证据 */ ],
  "special_constraints": [
    { "key": "extra_archive_requirement", "value": "需归档第三方检测报告" }
  ]
}
```

## 输出

```json
{
  "directory_matches": [
    {
      "directory_item_id": "dir_001",
      "directory_item_name": "招标文件",
      "required": true,
      "match_status": "matched | missing | needs_replacement | exception",
      "matched_materials": [
        { "material_id": "mat_001", "evidence_block_ids": ["blk_0001"], "confidence": 0.92 }
      ],
      "review_required": false,
      "remark": ""
    }
  ],
  "draft_outline": [
    {
      "section_id": "sec_001",
      "section_title": "一、项目基本信息",
      "directory_item_ids": ["dir_001"],
      "content_refs": [
        { "type": "field", "item_key": "project_name" },
        { "type": "field", "item_key": "project_id" }
      ]
    }
  ],
  "missing_items": ["dir_007"],
  "needs_replacement_items": [],
  "exceptions": [],
  "constraints_applied": ["extra_archive_requirement"]
}
```

## 标准备案目录

**目录由 `references/standard_directory.json` 定义,是企业级公文规范的一部分,不能在代码里硬编码。**

目录每项关键字段:

| 字段 | 说明 |
|---|---|
| `directory_item_id` | 唯一 ID,如 dir_001 |
| `directory_item_name` | 显示名,如"项目立项申请" |
| `required` | true=必须有;false=按项目类型可选 |
| `match_rules` | 匹配规则数组,见下 |
| `applicable_purchase_methods` | 适用的采购方式,空表示通用 |

## 匹配规则

`match_rules` 数组,任一规则命中即视为该材料匹配该目录项。规则类型:

```jsonc
// 类型 1: 文件名关键词
{ "type": "filename_keyword", "keywords": ["招标文件", "采购需求"] }

// 类型 2: 材料类型枚举(由调用方提供 material_type_hint)
{ "type": "material_type", "values": ["tender_document"] }

// 类型 3: 内容特征(S1 块的 semantic_tag 出现)
{ "type": "content_tag", "tags": ["project_name", "purchase_method"], "min_hits": 2 }

// 类型 4: 字段非空(基础信息抓取表里某字段已成功抽取)
{ "type": "field_present", "item_keys": ["bid_open_time", "purchaser"] }
```

## 处理流程

1. **加载目录模板** — 按 `directory_template_id` 取出 directory items 列表
2. **逐项匹配** — 对每个目录项,遍历 `materials_meta`,任一 `match_rules` 命中则该材料进入 `matched_materials`
3. **状态判定**:
   - 至少一个材料匹配 → `matched`
   - 必需项无任何匹配 → `missing`
   - 多个材料都声称匹配,内容互相矛盾 → `needs_replacement`
   - 命中但置信度全 < 0.6 → `exception` + `review_required=true`
4. **特殊约束注入** — 把 `special_constraints` 里的指令转化为额外目录项(如新增 dir_999 "第三方检测报告"),`required=true`
5. **初稿大纲组装** — 按 `references/draft_outline_template.json` 把目录项映射到章节;每章节引用对应字段和材料

## 初稿大纲约定

- 章节固定从 `references/draft_outline_template.json` 取顺序,不允许 AI 自主调整
- 每章节的 `content_refs` 可以是:
  - `{ "type": "field", "item_key": "..." }` — 从 S2 抓取表取值
  - `{ "type": "material", "material_id": "...", "block_ids": [...] }` — 引用 S1 块原文
  - `{ "type": "table", "source": "supplier_list" }` — 自动生成表格(报名供应商列表等)
- **不要在大纲里写正文文本**,正文由 S4 注入模板时再渲染

## 边界与人工复核

| 能做 | 不能做 |
|---|---|
| 给出匹配建议和置信度 | 决定低置信度匹配是否成立 → 人工 |
| 标记缺失/异常/待替换 | 决定是否退回业务侧重新提交 → 人工 |
| 把特殊约束转化为额外目录项 | 决定这些约束是否合规 → 合规经理 |
| 输出大纲结构 | 生成正文文本(由 S4 模板注入完成) |
| 给所有判断附证据 | 替代合规审查结论 |

**任何 `match_status != matched` 或 `confidence < 0.7`,`review_required` 必须为 true。**

## 脚本与参考

- `scripts/match_directory.py` — 主匹配引擎
- `scripts/assemble_draft.py` — 初稿大纲组装
- `references/standard_directory.json` — 企业标准备案目录
- `references/draft_outline_template.json` — 初稿章节模板
- `references/match_output_schema.json` — 输出 schema
- `assets/sample_match_result.json` — 完整样例

## 反馈修订后的匹配策略

- 自动从 S2 的 `extra_archive_requirement`、`temporary_rule`、`format_requirement` 生成临时目录约束,并写入 `constraints_applied`。
- 支持 `content_keyword` 和 `field_value_contains` 规则,便于把冷门地方标准、临时条款、行业惯例等动态要求放进目录匹配,不用改代码。
- 多份材料同时高置信匹配时,输出 `needs_replacement`、`diagnostics` 和 `evidence_summary`,交人工确认保留哪份。
- 输出新增 `dependency_checks` 与 `coverage_warnings`;如果资格审查表、评标报告、临时规则之间存在链路缺口,只提示风险,不做合规结论。
- 初稿模板已接入公开招标备案 MVP 字段:项目包数、中标人、中标金额、项目负责人、项目小组成员、验收情况说明。结果/验收类字段按可选引用处理,避免 MVP 因未进入履约阶段而整体阻塞。
