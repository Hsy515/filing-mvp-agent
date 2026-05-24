---
name: s4-office-template-injector
description: 基于 Office/PDF DOM 的无损模板注入。当用户需要把已经准备好的结构化 JSON 数据(基础信息字段、供应商列表、目录匹配结果等)填入已有的 Word(.docx)或 Excel(.xlsx)模板,并且**不破坏模板原有的字体、字号、页边距、段落样式、表格边框、公司公文排版**时,使用本 Skill。任何"按模板生成"、"填模板"、"模板套打"、"占位符替换"、"备案文档输出"、"导出 Word/Excel"、"生成正式公文"的请求都应触发本 Skill。本 Skill 是 S3 初稿大纲和 S5 开评标表格生成的共用输出底座。
---

# S4 - Office/PDF DOM 无损模板注入

## 这个 Skill 解决什么问题

S2、S3、S5 都输出结构化 JSON,但业务侧最终要的是**可直接提交的 Word / Excel 文档**,而且必须保留原模板的公文排版(字体、字号、页边距、表格样式、徽标、页眉页脚)。

直接让大模型生成 docx 二进制完全不可行——它会破坏样式。本 Skill 用 DOM 操作把字段值精确注入到模板的占位符位置,不改任何样式属性。

**不做的事**:不抽字段(S2)、不做目录匹配(S3)、不渲染图片、不做 OCR(S1)。

## 触发条件

- `填模板`、`套打`、`占位符替换`、`模板生成`、`无损排版`
- `导出 Word`、`导出 Excel`、`生成 docx`、`生成 xlsx`
- `备案文档输出`、`公文格式`、`正式提交版本`
- 上游已经准备好 JSON 数据,只是需要"渲染成文档"

## 输入

```json
{
  "template_path": "/templates/备案文档模板.docx",
  "template_format": "docx | xlsx",
  "output_path": "/output/proj_001_备案文档.docx",
  "placeholder_mapping": {
    "{{project_name}}": { "type": "text", "value": "2025年中药饮片采购项目" },
    "{{project_id}}": { "type": "text", "value": "GCZB-2025-0117" },
    "{{budget}}": { "type": "text", "value": "1,250,000.00" },
    "{{#supplier_table}}": {
      "type": "table_rows",
      "anchor": "supplier_table",
      "rows": [
        { "name": "A 中药材有限公司", "code": "91110108MA01XXXXXX", "status": "已报名" }
      ]
    },
    "{{report_date}}": { "type": "date", "value": "2025-06-15", "format": "YYYY年M月D日" }
  },
  "strict_mode": true
}
```

## 输出

```json
{
  "output_path": "/output/proj_001_备案文档.docx",
  "status": "success | partial | failed",
  "placeholders_filled": 12,
  "placeholders_missing": [],
  "warnings": []
}
```

## 占位符约定

**强制约定**:模板里的占位符**只允许**用双花括号格式,且不得含空格:

```
{{project_name}}          单值文本
{{budget}}                数值,渲染前自动格式化
{{report_date}}           日期,按 format 渲染
{{#supplier_table}}       表格行锚点(配合"重复段"使用)
```

- 单值占位符出现位置**只能在段落 run、表格单元格 run、文本框 run** 里;不允许出现在样式定义、批注、超链接显示文本之外的地方
- 表格类占位符放在 Word 表格的第一个数据行(模板行)的任意单元格里;注入时会"复制该行,逐行填值"
- xlsx 单值占位符放单元格 value,表格类用 `<<table:supplier_list>>` 注释式锚点

## 处理流程

1. **加载模板** — 用 `python-docx` 打开 docx,或 `openpyxl` 打开 xlsx。绝对**不要**重新构造 Document,只能改局部 Run/Cell
2. **扫描占位符** — 遍历段落、表格、Header/Footer、文本框,收集所有 `{{...}}` 出现位置
3. **校验映射** — 模板里所有占位符必须在 `placeholder_mapping` 里有对应项;`strict_mode=true` 时缺一即失败
4. **逐项注入** — 见下方"注入规则"
5. **保存** — 写到 `output_path`;**绝不写回原模板**

## 注入规则(关键!)

### 单值文本(type=text/date/number)

- 找到包含占位符的 Run
- **保留 Run 的所有样式属性**(字体、字号、加粗、颜色),只替换 text
- 占位符跨多个 Run 的情况:先把跨 Run 合并成一个 Run,再替换

### 表格行(type=table_rows)

- 定位"含锚点占位符的行"为模板行
- 对每条 row 数据:复制模板行(包括所有单元格样式),把 `{{name}}` 这类子占位符替换成 row 字段
- 删除原模板行

### 日期(type=date)

- 用 `format` 参数渲染(支持 `YYYY年M月D日` / `YYYY-MM-DD`)
- 不传 format 默认 `YYYY-MM-DD`

### 数值(type=number)

- 千分位 + 两位小数(可配)
- 货币单位由模板文本里的"元"/"万元"承担,**不**在注入时再加单位

## 不允许做的事(防止破坏排版)

- 不允许调整段落/表格样式(`style`、`alignment`、`font.size`、`spacing`)
- 不允许新增/删除段落,**除非**是表格行注入逻辑里的复制行
- 不允许重新设置页边距、纸张大小、页眉页脚
- 不允许把 Run 拆碎成新 Run(会丢样式);跨 Run 合并占位符时,合并后保留**第一个 Run** 的样式
- 不允许把 `{{...}}` 留在输出文档里;未填则按 `strict_mode` 决定:
  - `strict_mode=true` → 整体失败,status=failed
  - `strict_mode=false` → 替换为空字符串,记录到 `warnings`

## 边界与人工复核

| 能做 | 不能做 |
|---|---|
| 把 JSON 注入模板占位符,保留排版 | 决定模板本身是否合规 → 由企业模板治理 |
| 报告占位符缺失/未替换 | 修复模板里的格式问题 |
| 处理表格行重复、跨 Run 占位符 | 把没有占位符的内容硬塞进文档 |
| 输出 docx / xlsx | 输出 PDF(目前不支持,后续可由 LibreOffice/Spire 转) |

## 脚本与参考

- `scripts/inject_docx.py` — Word 模板注入
- `scripts/inject_xlsx.py` — Excel 模板注入
- `scripts/placeholder_scanner.py` — 占位符扫描
- `references/placeholder_conventions.md` — 占位符书写规范(对接模板设计师)
- `assets/placeholder_mapping_example.json` — 完整 mapping 例子
- `assets/template_design_checklist.md` — 模板设计师 checklist
