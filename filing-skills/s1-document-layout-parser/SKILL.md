---
name: s1-document-layout-parser
description: 多源文档版面分析与段落路由。当用户上传招标文件、公告、扫描件、报名表、Excel 或网页截图，且需要把它们切分成标题/正文/表格/页眉页脚等结构化块并打语义标签时，使用本 Skill。任何"解析这份招标文件"、"识别 PDF 表格"、"扫描件 OCR"、"版面分析"、"段落分块"、"切分公告材料"、"备案材料结构化"的请求都应优先触发本 Skill，即便用户没有明确说"版面分析"。这是备案文件智能生成链路的第一步,后续 S2~S5 都依赖它的结构化输出。
---

# S1 - 多源文档版面分析与段落路由

## 这个 Skill 解决什么问题

备案材料来源很乱：扫描的 PDF、Word 招标文件、报名表 Excel、政府采购网截图、邮件正文等等。下游的字段抽取、目录匹配、表格生成都需要先把这些原始文件切成可定位、可追溯的结构化块。

本 Skill 的职责是**只做版面解析**：把任意文件切成段落、表格、标题、页眉页脚，并给每个块打上语义标签和原文坐标。**不做字段抽取**（那是 S2 的事），不做目录匹配（那是 S3 的事）。

## 触发条件

当看到以下信号时立刻使用本 Skill：

- 用户上传或提到 `.pdf` / `.docx` / `.xlsx` / `.png` / `.jpg` 的招标文件、公告、报名表、合同
- 关键词：`版面解析`、`OCR`、`扫描件识别`、`表格提取`、`分段`、`段落路由`、`公告解析`
- 业务场景词：`备案材料`、`招标文件`、`采购公告`、`报名表`、`供应商资格`
- 即便用户只说"帮我看下这个文件"，只要文件是采购/备案类，也应触发

## 输入输出

### 输入

```json
{
  "file_path": "/path/to/招标文件.pdf",
  "file_type": "pdf | docx | xlsx | image | html",
  "file_name": "招标文件.pdf",
  "options": {
    "enable_ocr": true,
    "enable_table_extraction": true,
    "language": "zh-CN"
  }
}
```

### 输出

严格按照 `references/layout_output_schema.json` 定义的 schema 输出。最小骨架：

```json
{
  "material_id": "mat_001",
  "file_name": "招标文件.pdf",
  "parse_status": "success | partial | failed",
  "page_count": 38,
  "blocks": [
    {
      "block_id": "blk_0001",
      "block_type": "title | paragraph | table | header | footer | image_caption | list_item",
      "semantic_tag": "project_name | budget | bid_open_time | supplier_list | unknown",
      "text": "采购项目名称：2025年中药饮片采购项目",
      "page": 1,
      "bbox": [120, 80, 980, 110],
      "confidence": 0.96,
      "table_data": null
    }
  ],
  "warnings": []
}
```

## 处理流程

1. **识别文件类型** — 根据扩展名 + 魔术字节双重判断；扫描 PDF 走 OCR 通道，原生 PDF 直接抽文本流
2. **调用底层解析能力** — 见下方"技术选型"，按可用性优先级回退
3. **块结构化** — 把原始解析结果归一化成 `blocks[]`；表格保留 `table_data` 二维数组
4. **语义打标** — 用关键词规则 + 大模型轻量分类给每个块打 `semantic_tag`（仅是初步路由提示，**不要在本 Skill 做字段抽取**）
5. **校验与降级** — 解析失败 / 置信度过低的块写入 `warnings`，不能编造内容

## 技术选型与回退顺序

| 优先级 | 文件类型 | 推荐工具 | 备注 |
|---|---|---|---|
| 1 | 原生 PDF | `pdfplumber` + `PyMuPDF` | 自有方案,无外部依赖,速度快 |
| 2 | 扫描 PDF / 图片 | TextIn 文档解析 API | 国内首选,中文表格识别强 |
| 3 | 复杂表格 | 阿里 OCR-Form / Azure Form Recognizer | 跨页表格、合并单元格场景 |
| 4 | DOCX | `python-docx` | 直接读 XML 结构,不丢样式信息 |
| 5 | XLSX | `openpyxl` | 区分公式单元格与值单元格 |
| 6 | 网页截图 / HTML | `playwright` 截图 + 上面 OCR 通道 | 兼容政府采购网这种动态页面 |

**回退策略**：高优先级失败或置信度 < 0.6，自动回退下一级；全部失败则 `parse_status = failed`，把原始报错写入 `warnings`，**不要伪造解析结果**。

## 语义标签词典

`semantic_tag` 字段只能取下列值，未命中归 `unknown`，留给 S2 进一步抽取：

```
project_name, project_id, purchase_method, budget, purchase_content,
purchaser, agent, package_count, notice_publish_time, bid_open_time,
bid_close_time, deadline_for_questions, supplier_name, social_credit_code,
contact_info, winner_name, winning_amount, project_manager,
project_team_members, acceptance_note, special_requirement,
supplier_list_header, supplier_list_row, unknown
```

打标依据是块的文本特征（关键词、正则、上下文位置），**不做跨块推理**。

## 边界与人工复核

| 能做 | 不能做（属于其他 Skill） |
|---|---|
| 切块、打基础语义标签、给出原文坐标 | 字段抽取生成《基础信息抓取表》→ 走 S2 |
| 标识"这是表格"、"这是供应商名单标题行" | 把表格行拆成结构化供应商记录 → 走 S2 |
| 报告解析失败 / 低置信度 | 决定材料是否需要重新上传 → 人工 |
| 给出每块的页码和 bbox | 把这些块匹配到备案目录 → 走 S3 |

任何 `parse_status != success` 或 block 级 `confidence < 0.7`，必须在 `warnings` 里高亮，提示业务侧重新上传更清晰版本或人工录入,**不要把低质量结果直接传给 S2**。

## 脚本与参考

- `scripts/parse_layout.py` — 主入口函数,提供回退框架和归一化逻辑
- `scripts/semantic_tagger.py` — 语义标签词典 + 规则匹配
- `references/layout_output_schema.json` — 输出 JSON Schema (权威定义)
- `assets/sample_output.json` — 真实文件的样例输出,可用作回归测试基线

## 反馈修订后的质量闸门

- 扫描 PDF / 图片优先读取 `ocr_text_path`、`ocr_markdown_path`、`ocr_json_path` 或 `ocr_blocks`;未提供时,可通过 `XFEI_OCR_SKILL_PATH` 或同级 `ocr-skill-pdf-image` 调用讯飞 OCR skill。
- CLI 也支持 `--ocr-text-path`、`--ocr-markdown-path`、`--ocr-json-path`、`--ocr-skill-path`、`--ocr-python`、`--disable-ocr`,可直接把 OCR sidecar 或讯飞 OCR skill 目录传给 S1。
- 自动调用讯飞 OCR skill 时优先使用 `XFEI_OCR_PYTHON` / `--ocr-python`;未指定时会选择可 `import requests` 的 Python,避免 Codex bundled Python 缺依赖导致 API 调用失败。
- OCR 结果必须通过 `quality_report.ocr.usable=true` 才能转成 blocks;字符数过少、疑似乱码或低置信结果只写入 `warnings`,不得进入 S2 自动抽取。
- 不规则表格会标记 `TABLE_COMPLEX_LAYOUT`,并在 block.metadata 写入 `complex_table=true`;下游看到该标记必须进入人工复核或专用表格解析。
- 动态结算、统一下浮率、地方/行业标准、资格/评审要求等反馈中提到的高风险语义,只作为 `temporary_rule` / `special_requirement` 路由提示,不在 S1 做结论。
- 已按公开招标备案模板补充 `package_count`、`winner_name`、`winning_amount`、`project_manager`、`project_team_members`、`acceptance_note` 等备案登记字段的路由标签。
- 老式 `.doc` 会输出 `LEGACY_DOC_REQUIRES_CONVERSION`,要求先另存为 `.docx`;不要把 `.doc` 误走 `python-docx`。
