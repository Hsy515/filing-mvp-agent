---
name: s2-filing-basic-info-extractor
description: 备案基础信息抓取,生成《备案基础信息抓取表》。当用户需要从已解析的招标/公告/报名材料中抽出项目名称、项目编号、采购方式、预算、采购人、代理机构、公告时间、开标时间、供应商报名明细、特殊备注等结构化字段时,使用本 Skill。任何"做基础信息抓取表"、"抽项目字段"、"汇总报名供应商"、"识别公告关键要素"、"生成备案表"的请求都应触发本 Skill,即便用户没有明说"基础信息抓取"。本 Skill 接收 S1 的版面解析输出,产出严格的字段表 JSON,是 S3 目录匹配和 S5 开评标表格生成的字段来源。
---

# S2 - 备案基础信息抓取

## 这个 Skill 解决什么问题

S1 把文件切成了语义块,但每个字段的**确切值**还没出来——比如开标时间到底是 "2025-06-18 09:30" 还是 "2025年6月18日 上午九点半"?预算金额到底是 125 万还是 1250000?

本 Skill 的职责是**把 S1 的块结果转换成**《备案基础信息抓取表》:每个字段标注来源、置信度、校验结果,缺失或异常项明确标记需要人工确认。

**不做的事**:解析原始文件(S1)、匹配备案目录(S3)、生成最终文档(S4/S5)。

## 触发条件

看到下列任一信号立即触发:

- `基础信息抓取`、`抓取表`、`字段抽取`、`备案表`、`项目信息汇总`
- `供应商报名明细`、`报名表汇总`、`报名情况统计`
- `公告关键要素`、`开标时间`、`项目编号`、`预算金额`
- 用户已经做完版面解析(有 S1 输出 JSON),想"下一步抽字段"

## 输入输出

### 输入

```json
{
  "project_id": "proj_001",
  "materials": [
    { "material_id": "mat_001", "layout_result": { /* S1 输出 */ } },
    { "material_id": "mat_002", "layout_result": { /* S1 输出 */ } }
  ],
  "context": {
    "known_fields": {
      "project_id": "GCZB-2025-0117"
    },
    "special_instructions": []
  }
}
```

### 输出

严格按 `references/extraction_schema.json`。骨架:

```json
{
  "basic_info_sheet": {
    "project_id": "proj_001",
    "items": [
      {
        "category": "file_core | notice_key | supplier_registration | award_result | special_remark",
        "item_key": "project_name",
        "item_name": "项目名称",
        "ai_value": "...",
        "confirmed_value": "",
        "extract_status": "success | missing | exception",
        "confidence": 0.96,
        "source": { "material_id": "...", "file_name": "...", "page": 1, "block_id": "blk_0001", "excerpt": "..." },
        "validation_result": { "status": "passed | warning | failed", "message": "..." },
        "review_required": false
      }
    ]
  }
}
```

## 五类抓取字段

抓取项必须覆盖以下 5 类字段。**字段定义见 `references/field_dictionary.json`,这是唯一权威清单**。

| category | 包含字段(关键) | 校验要点 |
|---|---|---|
| `file_core` 文件核心信息 | project_name, project_id, purchase_method, budget, package_division, package_count, purchase_content, purchaser, agent, notice_publish_time | 项目编号格式、金额数值合法、采购方式枚举值、项目包数 |
| `notice_key` 公告关键要素 | notice_type, registration_start, registration_end, bid_close_time, bid_open_time, question_channel, contact_info | 时间节点顺序校验、联系方式格式 |
| `supplier_registration` 报名信息明细 | supplier_name, social_credit_code, registration_time, registration_status, contact_info(供应商级) | 信用代码 18 位、报名状态枚举 |
| `award_result` 采购结果/备案登记 | winner_name, winning_amount, project_manager, project_team_members, acceptance_note | 中标金额数值合法;结果字段缺失时进入人工复核 |
| `special_remark` 特殊备注指令 | extra_archive_requirement, format_requirement, temporary_rule | 项目级临时/永久要求,作为 S3 的约束条件 |

**说明**:`supplier_registration` 类下每个供应商一行,`item_key` 命名为 `supplier_1.name`、`supplier_1.social_credit_code` 这样;允许动态扩展。

## 处理流程

1. **聚合 S1 块** — 把所有材料的 blocks 按 `semantic_tag` 分桶,作为字段候选池
2. **字段抽取** — 对每个目标字段:
   - 优先看候选池里有没有命中 `semantic_tag` 的块
   - 命中多个 → 选 page 最小、confidence 最高的;冲突值进 `warnings`
   - 没命中 → 全局回退,用大模型在 paragraph 文本里做问答式抽取
3. **格式归一** — 时间统一 `YYYY-MM-DD HH:MM`、金额统一阿拉伯数字(单位转元)、采购方式映射到枚举
4. **校验** — 调用 `validators.py` 里的规则;按字段类型走对应校验函数
5. **置信度计算** — 综合候选块的 `confidence` + 校验结果 + 跨材料一致性
6. **缺失/异常标记** — `extract_status` 为 `missing` 或 `exception` 时 `review_required = true`,**不要伪造值**

## 关键校验规则

| 字段 | 规则 |
|---|---|
| `project_id` | 非空;符合常见编号正则 `[A-Z]{2,}[-_]?\d{4,}` |
| `budget` | 数值 > 0;统一转换成"元"为单位的整数或两位小数 |
| `purchase_method` | 必须 ∈ {`公开招标`, `邀请招标`, `竞争性谈判`, `竞争性磋商`, `单一来源`, `询价`, `其他`} |
| `bid_open_time` | ISO 时间;晚于 `registration_end`;晚于 `notice_publish_time` |
| `social_credit_code` | 长度 18,字符集 `[0-9A-Z]`,通过校验码算法 |
| `contact_info` | 至少有一个有效电话或邮箱;邮箱走 RFC 5322 子集 |
| `registration_status` | ∈ {`已报名`, `资格审查通过`, `资格审查未通过`, `已撤回`, `未知`} |

所有校验函数在 `scripts/validators.py`,失败时 `validation_result.status = failed/warning`,并把可读 message 写出。

## 输出原则:不编造

- 抽不到 → `ai_value=""`,`extract_status="missing"`,`source=null`,`review_required=true`
- 多处冲突 → `extract_status="exception"`,在 `validation_result.message` 里列出冲突来源
- 低置信度(< 0.7)→ `review_required=true`,等待人工在 `confirmed_value` 填正确值
- **绝不**根据"常识"补 default,绝不"猜"项目编号

## 边界与人工复核

| 能做 | 不能做 |
|---|---|
| 抽字段、归一格式、跨材料一致性校验 | 决定字段最终值(等人工填 `confirmed_value`) |
| 标记 missing / exception / low_confidence | 决定材料是否合规(那是合规审查) |
| 自动汇总供应商列表 | 判断报名有效性、是否进入评审 |
| 识别疑似特殊要求并入库 | 决定是否作为项目约束(等人工确认) |

## 脚本与参考

- `scripts/extract_basic_info.py` — 主入口,负责聚合 + 抽取 + 校验
- `scripts/validators.py` — 单字段校验函数集合
- `references/extraction_schema.json` — 输出 Schema
- `references/field_dictionary.json` — 字段权威清单 (key/name/category/type/required)
- `references/domain_rules.json` — 字段别名、领域词和跨字段动态约束
- `assets/sample_extraction.json` — 完整样例输出

## 反馈修订后的抽取策略

- 字段抽取不再只依赖 `semantic_tag`;先看标签命中,再用 `references/domain_rules.json` 的字段别名和领域词进行全局回退。
- 同一字段出现多个不同候选值时,输出 `extract_status=exception`,填充 `candidate_sources` 和 `logic_flags=candidate_conflict`,不自动拍板。
- 动态定价/统一下浮率/据实结算等表达不得被当作静态预算金额;此类结果必须进入人工复核。
- 输出新增 `logic_checks`、`review_queue`、`rule_feedback`;用户修正或缺失/异常字段应沉淀到 `domain_rules.json` 或 `field_dictionary.json`,形成后续迭代闭环。
- 统一社会信用代码执行校验码算法,不是只做长度格式检查。
- 已按用户提供的公开招标备案模板补充 `award_result` 类字段和 `package_count`;S3/S4/S5 可直接复用这些字段生成备案登记表和开标记录。
