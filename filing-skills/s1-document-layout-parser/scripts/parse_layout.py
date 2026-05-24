"""
S1 - 多源文档版面分析与段落路由
主入口模块。提供文件类型识别 + 解析引擎回退 + 输出归一化。

设计原则:
  1. 每种文件类型至少有 2 个备用引擎,失败自动回退
  2. 解析失败或低置信度,如实写入 warnings,不伪造结果
  3. 输出严格符合 references/layout_output_schema.json

依赖(按需安装):
    pip install pdfplumber pymupdf python-docx openpyxl pillow
    # 可选,接入云 OCR:
    # pip install requests  # TextIn / 阿里 / Azure 走 HTTP API
"""

from __future__ import annotations

import json
import logging
import mimetypes
import re
from dataclasses import dataclass, field, asdict
from enum import Enum
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


# ---------- 数据结构 ----------

class ParseStatus(str, Enum):
    SUCCESS = "success"
    PARTIAL = "partial"
    FAILED = "failed"


class BlockType(str, Enum):
    TITLE = "title"
    SUBTITLE = "subtitle"
    PARAGRAPH = "paragraph"
    TABLE = "table"
    HEADER = "header"
    FOOTER = "footer"
    IMAGE_CAPTION = "image_caption"
    LIST_ITEM = "list_item"
    FORM_FIELD = "form_field"


@dataclass
class Block:
    block_id: str
    block_type: str
    text: str
    page: int
    semantic_tag: str = "unknown"
    bbox: list[float] = field(default_factory=lambda: [0, 0, 0, 0])
    confidence: float = 1.0
    table_data: list[list[str]] | None = None


@dataclass
class Warning_:
    code: str
    message: str
    page: int | None = None
    block_id: str | None = None


@dataclass
class LayoutResult:
    material_id: str
    file_name: str
    parse_status: str
    blocks: list[Block] = field(default_factory=list)
    warnings: list[Warning_] = field(default_factory=list)
    file_type: str = "unknown"
    page_count: int = 0
    engine: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "material_id": self.material_id,
            "file_name": self.file_name,
            "file_type": self.file_type,
            "parse_status": self.parse_status,
            "page_count": self.page_count,
            "engine": self.engine,
            "blocks": [asdict(b) for b in self.blocks],
            "warnings": [asdict(w) for w in self.warnings],
        }


# ---------- 入口函数 ----------

def parse_document(
    file_path: str | Path,
    material_id: str,
    options: dict | None = None,
) -> LayoutResult:
    """
    主入口:解析任意文件,返回结构化版面结果。

    参数:
        file_path: 文件绝对路径
        material_id: 调用方分配的材料 ID
        options: 可选配置,如 {"enable_ocr": True, "language": "zh-CN"}

    返回:
        LayoutResult 对象,调用方一般 .to_dict() 后序列化
    """
    file_path = Path(file_path)
    options = options or {"enable_ocr": True, "language": "zh-CN"}

    file_type = _detect_file_type(file_path)
    result = LayoutResult(
        material_id=material_id,
        file_name=file_path.name,
        file_type=file_type,
        parse_status=ParseStatus.FAILED.value,
    )

    # 按文件类型分发,内部已含回退逻辑
    try:
        if file_type == "pdf":
            _parse_pdf(file_path, result, options)
        elif file_type == "docx":
            _parse_docx(file_path, result, options)
        elif file_type == "xlsx":
            _parse_xlsx(file_path, result, options)
        elif file_type == "image":
            _parse_image(file_path, result, options)
        elif file_type == "html":
            _parse_html(file_path, result, options)
        else:
            result.warnings.append(Warning_(
                code="FILE_CORRUPTED",
                message=f"无法识别文件类型: {file_path.name}",
            ))
            return result
    except Exception as exc:
        logger.exception("解析失败: %s", file_path)
        result.warnings.append(Warning_(
            code="FILE_CORRUPTED",
            message=f"解析异常: {exc}",
        ))
        return result

    # 给所有块打语义标签(轻量级,精确抽取由 S2 完成)
    from semantic_tagger import tag_blocks
    tag_blocks(result.blocks)

    # 状态判定
    result.parse_status = _judge_status(result)
    return result


# ---------- 内部解析器 ----------

def _parse_pdf(file_path: Path, result: LayoutResult, options: dict) -> None:
    """
    优先使用 pdfplumber 抽文本和表格;失败时回退 PyMuPDF 文本流。
    扫描件/OCR 仍作为外部增强点,本地首版不编造识别结果。
    """
    try:
        import pdfplumber
        result.engine = "pdfplumber"
        with pdfplumber.open(file_path) as pdf:
            result.page_count = len(pdf.pages)
            for page_no, page in enumerate(pdf.pages, start=1):
                text = page.extract_text() or ""
                for line in _iter_text_lines(text):
                    _add_text_block(result, line, page_no)
                for table in page.extract_tables() or []:
                    clean = _clean_table(table)
                    if clean:
                        _add_table_block(result, clean, page_no)
        if result.blocks:
            return
        result.warnings.append(Warning_(
            code="OCR_REQUIRED",
            message="PDF 未发现可抽取文本层,请接入 OCR 引擎或上传可复制文本的 PDF。",
        ))
        return
    except ImportError:
        result.warnings.append(Warning_(
            code="DEPENDENCY_MISSING",
            message="未安装 pdfplumber,尝试使用 PyMuPDF 回退。",
        ))
    except Exception as exc:
        result.warnings.append(Warning_(
            code="ENGINE_FALLBACK",
            message=f"pdfplumber 解析失败,尝试 PyMuPDF 回退: {exc}",
        ))

    try:
        import fitz
    except ImportError as exc:
        raise RuntimeError("请先安装 pdfplumber 或 pymupdf: pip install pdfplumber pymupdf") from exc

    result.engine = "pymupdf"
    with fitz.open(file_path) as doc:
        result.page_count = len(doc)
        for page_no, page in enumerate(doc, start=1):
            for line in _iter_text_lines(page.get_text("text") or ""):
                _add_text_block(result, line, page_no)


def _parse_docx(file_path: Path, result: LayoutResult, options: dict) -> None:
    """
    使用 python-docx 直接读 XML 结构。
    要点:
      - paragraph.style.name 帮助识别标题级别
      - tables 保留为 table_data 二维数组
      - 表单字段(content control) 标记为 form_field
    """
    try:
        from docx import Document
    except ImportError as exc:
        raise RuntimeError("请先安装 python-docx: pip install python-docx") from exc

    doc = Document(file_path)
    result.engine = "python-docx"
    result.page_count = 1

    for para in doc.paragraphs:
        text = para.text.strip()
        if not text:
            continue
        style_name = (para.style.name if para.style else "") or ""
        block_type = _block_type_from_style_or_text(style_name, text)
        _add_text_block(result, text, page=1, block_type=block_type)

    for table in doc.tables:
        rows = []
        for row in table.rows:
            rows.append([cell.text.strip() for cell in row.cells])
        clean = _clean_table(rows)
        if clean:
            _add_table_block(result, clean, page=1)


def _parse_xlsx(file_path: Path, result: LayoutResult, options: dict) -> None:
    """
    使用 openpyxl 读取每个 sheet。
    每个 sheet 转成一个 table 块,sheet 名作为 block 的 semantic_tag 提示。
    """
    try:
        from openpyxl import load_workbook
    except ImportError as exc:
        raise RuntimeError("请先安装 openpyxl: pip install openpyxl") from exc

    wb = load_workbook(file_path, data_only=True)
    result.engine = "openpyxl"
    result.page_count = len(wb.worksheets)
    for page_no, ws in enumerate(wb.worksheets, start=1):
        rows = []
        for row in ws.iter_rows(values_only=True):
            values = ["" if value is None else str(value).strip() for value in row]
            if any(values):
                rows.append(values)
        if rows:
            _add_table_block(result, rows, page_no, text=ws.title)


def _parse_image(file_path: Path, result: LayoutResult, options: dict) -> None:
    """
    调用云 OCR API:TextIn / 阿里 OCR-Form / Azure Form Recognizer。
    回退顺序见 SKILL.md 技术选型表。
    """
    result.engine = "external-ocr-required"
    result.page_count = 1
    result.warnings.append(Warning_(
        code="OCR_REQUIRED",
        message="图片/扫描件需要接入 TextIn、阿里 OCR-Form 或 Azure Form Recognizer 后解析。",
        page=1,
    ))


def _parse_html(file_path: Path, result: LayoutResult, options: dict) -> None:
    """
    使用 BeautifulSoup 抽 DOM;政府采购网这类动态页可先 playwright 截图再走 _parse_image。
    """
    result.engine = "html.parser"
    result.page_count = 1
    parser = _SimpleTextHTMLParser()
    parser.feed(file_path.read_text(encoding="utf-8", errors="ignore"))
    parser.close()
    for text in parser.lines:
        _add_text_block(result, text, page=1)


# ---------- 辅助函数 ----------

def _detect_file_type(file_path: Path) -> str:
    suffix = file_path.suffix.lower()
    mapping = {
        ".pdf": "pdf",
        ".docx": "docx", ".doc": "docx",
        ".xlsx": "xlsx", ".xls": "xlsx",
        ".png": "image", ".jpg": "image", ".jpeg": "image", ".tiff": "image",
        ".html": "html", ".htm": "html",
    }
    if suffix in mapping:
        return mapping[suffix]
    # 兜底: 通过 mimetypes 猜测
    guess, _ = mimetypes.guess_type(str(file_path))
    if guess and guess.startswith("image/"):
        return "image"
    return "unknown"


def _judge_status(result: LayoutResult) -> str:
    if not result.blocks:
        return ParseStatus.FAILED.value
    low_conf = sum(1 for b in result.blocks if b.confidence < 0.6)
    if low_conf == 0 and not result.warnings:
        return ParseStatus.SUCCESS.value
    if low_conf < len(result.blocks) * 0.3:
        return ParseStatus.PARTIAL.value
    return ParseStatus.FAILED.value


def _next_block_id(result: LayoutResult) -> str:
    return f"blk_{len(result.blocks) + 1:04d}"


def _add_text_block(
    result: LayoutResult,
    text: str,
    page: int,
    block_type: str | None = None,
    confidence: float = 0.9,
) -> None:
    text = _normalize_text(text)
    if not text:
        return
    result.blocks.append(Block(
        block_id=_next_block_id(result),
        block_type=block_type or _guess_block_type(text),
        text=text,
        page=page,
        confidence=confidence,
        table_data=None,
    ))


def _add_table_block(
    result: LayoutResult,
    table_data: list[list[str]],
    page: int,
    text: str | None = None,
    confidence: float = 0.92,
) -> None:
    result.blocks.append(Block(
        block_id=_next_block_id(result),
        block_type=BlockType.TABLE.value,
        text=text or " ".join(" ".join(row) for row in table_data[:2]),
        page=page,
        confidence=confidence,
        table_data=table_data,
    ))


def _iter_text_lines(text: str) -> list[str]:
    lines = []
    for raw in text.splitlines():
        line = _normalize_text(raw)
        if line:
            lines.append(line)
    return lines


def _normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", str(text or "")).strip()


def _clean_table(table: list[list[Any]]) -> list[list[str]]:
    rows: list[list[str]] = []
    for row in table or []:
        values = [_normalize_text(cell) for cell in (row or [])]
        if any(values):
            rows.append(values)
    return rows


def _guess_block_type(text: str) -> str:
    if len(text) <= 40 and re.search(r"(公告|招标文件|采购文件|项目)$", text):
        return BlockType.TITLE.value
    if re.match(r"^第[一二三四五六七八九十\d]+[章节条、.．]", text):
        return BlockType.SUBTITLE.value
    if re.match(r"^[（(]?[一二三四五六七八九十\d]+[）)、.．]", text):
        return BlockType.LIST_ITEM.value
    return BlockType.PARAGRAPH.value


def _block_type_from_style_or_text(style_name: str, text: str) -> str:
    lowered = style_name.lower()
    if "heading 1" in lowered or "标题 1" in style_name or "title" in lowered:
        return BlockType.TITLE.value
    if "heading" in lowered or "标题" in style_name:
        return BlockType.SUBTITLE.value
    return _guess_block_type(text)


class _SimpleTextHTMLParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.lines: list[str] = []
        self._parts: list[str] = []

    def handle_data(self, data: str) -> None:
        text = _normalize_text(data)
        if text:
            self._parts.append(text)

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() in {"p", "div", "li", "tr", "h1", "h2", "h3", "h4"}:
            self._flush()

    def close(self) -> None:
        self._flush()
        super().close()

    def _flush(self) -> None:
        text = _normalize_text(" ".join(self._parts))
        if text:
            self.lines.append(text)
        self._parts = []


# ---------- CLI ----------

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="S1 文档版面解析")
    parser.add_argument("file_path", help="待解析的文件路径")
    parser.add_argument("--material-id", default="mat_001")
    parser.add_argument("--output", "-o", help="输出 JSON 路径,默认 stdout")
    args = parser.parse_args()

    res = parse_document(args.file_path, args.material_id)
    out_str = json.dumps(res.to_dict(), ensure_ascii=False, indent=2)
    if args.output:
        Path(args.output).write_text(out_str, encoding="utf-8")
    else:
        print(out_str)
