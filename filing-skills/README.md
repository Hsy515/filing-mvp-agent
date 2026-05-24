# 备案文件智能生成 MVP — Skill 组合

5 个独立的 Claude Skill,每个负责备案文件生成流程的一个环节。
可单独触发使用,也可按 S1 → S2 → S3 → S4 / S5 顺序串联成完整链路。

## 整体架构

```
                ┌────────────────────────────────────┐
                │  原始材料 (PDF / Word / 扫描 / 截图)  │
                └────────────────┬───────────────────┘
                                 │
                                 ▼
              ┌─────────────────────────────────────┐
              │  S1  多源文档版面分析与段落路由        │
              │  → blocks[] + semantic_tag + bbox    │
              └────────────────┬────────────────────┘
                               │
                               ▼
              ┌─────────────────────────────────────┐
              │  S2  备案基础信息抓取                  │
              │  → 备案基础信息抓取表 (4 大类字段)     │
              └────────┬──────────────────┬─────────┘
                       │                  │
                       ▼                  ▼
          ┌─────────────────────┐  ┌───────────────────────┐
          │ S3  目录匹配 + 初稿  │  │ S5  开评标表格生成      │
          │ → directory_matches │  │ → 资格/符合性/得分等表  │
          │   + draft_outline   │  │                       │
          └──────────┬──────────┘  └───────────┬───────────┘
                     │                         │
                     └────────────┬────────────┘
                                  ▼
                ┌────────────────────────────────────┐
                │  S4  Office/PDF DOM 无损模板注入     │
                │  → 最终 docx / xlsx (保留排版)       │
                └────────────────────────────────────┘
```

## 5 个 Skill 一览

| 编号 | 名称 | 中文职责 | 触发时机 |
|---|---|---|---|
| S1 | `s1-document-layout-parser` | 多源文档版面分析与段落路由 | 用户上传招标文件、公告、扫描件等需要切块的材料 |
| S2 | `s2-filing-basic-info-extractor` | 备案基础信息抓取(生成抓取表) | 已有 S1 输出,需要抽字段、汇总报名供应商 |
| S3 | `s3-filing-directory-matcher` | 备案目录匹配与初稿组装 | 已有 S2 抓取表,需要对照标准目录核对材料 |
| S4 | `s4-office-template-injector` | Office/PDF DOM 无损模板注入 | 数据已结构化,需要按企业模板导出 Word/Excel |
| S5 | `s5-bid-evaluation-table-generator` | 开评标配套表格生成 | 报名汇总完成,准备进入开评标环节 |

## 调用顺序与依赖

- **典型链路**:S1 → S2 → S3 → S4(出备案文档)
- **开评标链路**:S1 → S2 → S5 → S4 复用(出资格/签到等表)
- **共用底座**:S3 / S5 都通过 S4 完成最终模板注入,**S4 不依赖任何上游 Skill**,可单独使用
- **每个 Skill 可单独触发**:用户只让 Claude "解析这份 PDF" → 只跑 S1;只让"对一下备案目录"→ 只跑 S3(需要先有 S2 输出作为输入)

## 数据流与 Schema 对照

| 上游 → 下游 | 数据载体 | Schema |
|---|---|---|
| S1 → S2 | `LayoutResult` JSON (blocks[]) | `s1-document-layout-parser/references/layout_output_schema.json` |
| S2 → S3 | `basic_info_sheet` JSON | `s2-filing-basic-info-extractor/references/extraction_schema.json` |
| S2 → S5 | 同上 | 同上 |
| S3 → S4 | `placeholder_mapping` JSON | `s4-office-template-injector/assets/placeholder_mapping_example.json` |
| S5 → S4 | 同上 | 同上 |

## 公共约束(贯穿 5 个 Skill)

1. **不编造**:任何字段抽不到 → `status=missing`,留 `review_required=true`,绝不补 default
2. **可追溯**:每个抽取值都带 source(material_id + block_id + page + excerpt)
3. **样式不动**:S4 绝不修改模板的字体、字号、页边距、表格边框
4. **边界清晰**:每个 Skill 的 SKILL.md 末尾都有"能做 / 不能做"对照,凡判断、决断类工作交人工

## 目录结构

```
filing-skills/
├── README.md  (本文件)
├── s1-document-layout-parser/
│   ├── SKILL.md
│   ├── scripts/
│   │   ├── parse_layout.py       # 主入口 + 本地 PDF/DOCX/XLSX/HTML 解析
│   │   └── semantic_tagger.py    # 语义标签词典 + 规则匹配
│   ├── references/
│   │   └── layout_output_schema.json
│   └── assets/
│       └── sample_output.json
├── s2-filing-basic-info-extractor/
│   ├── SKILL.md
│   ├── scripts/
│   │   ├── extract_basic_info.py
│   │   └── validators.py
│   ├── references/
│   │   ├── field_dictionary.json     # 字段权威清单 (24 项)
│   │   └── extraction_schema.json
│   └── assets/
│       └── sample_extraction.json
├── s3-filing-directory-matcher/
│   ├── SKILL.md
│   ├── scripts/
│   │   ├── match_directory.py
│   │   └── assemble_draft.py
│   ├── references/
│   │   ├── standard_directory.json   # 标准备案目录 (10 项)
│   │   ├── draft_outline_template.json
│   │   └── match_output_schema.json
│   └── assets/
│       └── sample_match_result.json
├── s4-office-template-injector/
│   ├── SKILL.md
│   ├── scripts/
│   │   ├── inject_docx.py
│   │   └── inject_xlsx.py
│   ├── references/
│   │   └── placeholder_conventions.md
│   └── assets/
│       ├── placeholder_mapping_example.json
│       └── template_design_checklist.md
└── s5-bid-evaluation-table-generator/
    ├── SKILL.md
    ├── scripts/
    │   └── generate_eval_tables.py
    ├── references/
    │   └── table_definitions.json    # 支持 5 种表格(qualification/compliance/score/attendance/bid_opening)
    └── assets/
        ├── sample_qualification_review_mapping.json
        └── extension_roadmap.md
```

## 部署与使用

### 作为 Claude Skill 接入

把每个 Skill 子目录直接复制到 Skill 注册目录,Claude 会按 SKILL.md 里的 `description` 字段自动匹配触发。

### 作为 Python 脚本本地跑

每个 `scripts/*.py` 都带 CLI,可独立运行,例:

```bash
# S1: 解析 PDF
python s1-document-layout-parser/scripts/parse_layout.py \
    /path/to/招标文件.pdf --material-id mat_001 -o s1_output.json

# S2: 抽字段
python s2-filing-basic-info-extractor/scripts/extract_basic_info.py \
    s1_output.json --project-id proj_001 -o s2_output.json

# S3: 目录匹配
python s3-filing-directory-matcher/scripts/match_directory.py \
    --sheet s2_output.json --materials materials_meta.json -o s3_output.json

# S4: 注入模板
python s4-office-template-injector/scripts/inject_docx.py \
    --template templates/备案文档模板.docx \
    --output output/备案文档.docx \
    --mapping placeholder_mapping.json

# S5: 生成资格审查表
python s5-bid-evaluation-table-generator/scripts/generate_eval_tables.py \
    --sheet s2_output.json \
    --table-type qualification_review \
    --template templates/资格审查表.docx \
    --output output/资格审查表.docx
```

### 依赖

```
# 基础(S1/S2/S4)
pip install pdfplumber pymupdf python-docx openpyxl pillow

# 可选(S1 云 OCR 接入)
pip install requests
```

## 下一步

- 接入 S1 的云 OCR 引擎(TextIn / 阿里 OCR-Form / Azure Form Recognizer),增强扫描件和图片材料解析
- 补全 S5 模板文件 + 评分规则(见 `s5-bid-evaluation-table-generator/assets/extension_roadmap.md`)
- 把 S2 字段字典与公司实际公文规范对齐
- S3 标准目录由合规经理评审定版
