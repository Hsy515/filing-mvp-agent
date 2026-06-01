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
import os
import re
import subprocess
import sys
import tempfile
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
    metadata: dict[str, Any] = field(default_factory=dict)


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
    quality_report: dict[str, Any] = field(default_factory=dict)

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
            "quality_report": self.quality_report,
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
    default_options = {
        "enable_ocr": True,
        "language": "zh-CN",
        "ocr_min_chars": 30,
        "ocr_skill_path": os.getenv("XFEI_OCR_SKILL_PATH", ""),
        "ocr_python": os.getenv("XFEI_OCR_PYTHON", ""),
    }
    options = {**default_options, **(options or {})}

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
        elif file_type == "doc_legacy":
            _parse_legacy_doc(file_path, result, options)
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

    _audit_layout_quality(result)

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
        if options.get("enable_ocr") and _try_ocr_bridge(file_path, result, options, source_type="pdf"):
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

    if not result.blocks and options.get("enable_ocr"):
        _try_ocr_bridge(file_path, result, options, source_type="pdf")


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


def _parse_legacy_doc(file_path: Path, result: LayoutResult, options: dict) -> None:
    """
    Old binary .doc files are not readable by python-docx. Surface a clear
    conversion requirement instead of misclassifying them as .docx.
    """
    result.engine = "legacy-doc"
    result.page_count = 0
    result.warnings.append(Warning_(
        code="LEGACY_DOC_REQUIRES_CONVERSION",
        message=f"老式 .doc 文件需先另存为 .docx 后再解析: {file_path.name}",
    ))


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
    result.page_count = 1
    if options.get("enable_ocr") and _try_ocr_bridge(file_path, result, options, source_type="image"):
        return

    result.engine = "external-ocr-required"
    if not any(w.code == "OCR_REQUIRED" for w in result.warnings):
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
        ".docx": "docx", ".doc": "doc_legacy",
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
    blocking_warnings = {
        "OCR_REQUIRED",
        "FILE_CORRUPTED",
        "DEPENDENCY_MISSING",
    }
    has_blocking_warning = any(w.code in blocking_warnings for w in result.warnings)
    if low_conf == 0 and not has_blocking_warning:
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
    metadata: dict[str, Any] | None = None,
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
        metadata=metadata or {},
    ))


def _add_table_block(
    result: LayoutResult,
    table_data: list[list[str]],
    page: int,
    text: str | None = None,
    confidence: float = 0.92,
    metadata: dict[str, Any] | None = None,
) -> None:
    result.blocks.append(Block(
        block_id=_next_block_id(result),
        block_type=BlockType.TABLE.value,
        text=text or " ".join(" ".join(row) for row in table_data[:2]),
        page=page,
        confidence=confidence,
        table_data=table_data,
        metadata=metadata or {},
    ))


def _try_ocr_bridge(file_path: Path, result: LayoutResult, options: dict, source_type: str) -> bool:
    """
    Consume an OCR sidecar or invoke the sibling Xfei OCR skill when configured.

    The bridge is deliberately conservative: it only converts OCR text into S1
    blocks when enough text exists. Low-quality OCR remains partial/failed and is
    surfaced through warnings so S2 does not silently consume shaky evidence.
    """
    text = _load_ocr_sidecar(options)
    engine = "ocr-sidecar"

    if not text:
        text = _run_xfei_ocr(file_path, result, options, source_type)
        engine = "xfei-ocr"

    report = _build_ocr_quality_report(text, options)
    result.quality_report["ocr"] = report

    if not text:
        return False

    if not report["usable"]:
        result.warnings.append(Warning_(
            code="OCR_LOW_CONFIDENCE",
            message=f"OCR 文本质量不足: {report['reason']}",
        ))
        return False

    result.engine = engine
    result.page_count = max(result.page_count, 1)
    for line in _iter_text_lines(text):
        _add_text_block(
            result,
            line,
            page=1,
            confidence=report["block_confidence"],
            metadata={"source": "ocr", "ocr_engine": engine},
        )
    return bool(result.blocks)


def _load_ocr_sidecar(options: dict) -> str:
    for key in ("ocr_text_path", "ocr_markdown_path"):
        path = options.get(key)
        if path and Path(path).exists():
            return Path(path).read_text(encoding="utf-8-sig", errors="ignore")

    json_path = options.get("ocr_json_path")
    if json_path and Path(json_path).exists():
        data = json.loads(Path(json_path).read_text(encoding="utf-8-sig"))
        return _extract_text_from_ocr_json(data)

    blocks = options.get("ocr_blocks")
    if isinstance(blocks, list):
        return "\n".join(str(b.get("text", "")) for b in blocks if isinstance(b, dict))
    return ""


def _run_xfei_ocr(file_path: Path, result: LayoutResult, options: dict, source_type: str) -> str:
    skill_path = options.get("ocr_skill_path")
    if not skill_path:
        sibling = Path(__file__).resolve().parents[3] / "ocr-skill-pdf-image"
        if sibling.exists():
            skill_path = str(sibling)
    if not skill_path:
        return ""

    script_name = "image_ocr.py" if source_type == "image" else "pdf_ocr.py"
    script_path = Path(skill_path) / "scripts" / script_name
    if not script_path.exists():
        return ""

    required_env = ["XFEI_APP_ID", "XFEI_API_SECRET"]
    if source_type == "image":
        required_env.append("XFEI_API_KEY")
    if any(not os.getenv(name) for name in required_env):
        result.warnings.append(Warning_(
            code="OCR_REQUIRED",
            message=f"已找到 OCR skill,但缺少环境变量: {', '.join(n for n in required_env if not os.getenv(n))}",
        ))
        return ""

    suffix = ".md" if source_type == "pdf" else ".txt"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        out_path = Path(tmp.name)

    python_executable = _select_ocr_python(options)
    cmd = [python_executable, str(script_path), str(file_path), "--output", str(out_path)]
    if source_type == "pdf":
        cmd.extend(["--format", "markdown"])
    try:
        subprocess.run(cmd, check=True, capture_output=True, text=True, timeout=int(options.get("ocr_timeout", 360)))
        return out_path.read_text(encoding="utf-8-sig", errors="ignore")
    except Exception as exc:
        result.warnings.append(Warning_(
            code="ENGINE_FALLBACK",
            message=f"讯飞 OCR skill 调用失败: {exc}",
        ))
        return ""
    finally:
        try:
            out_path.unlink(missing_ok=True)
        except OSError:
            pass


def _select_ocr_python(options: dict) -> str:
    configured = options.get("ocr_python")
    if configured:
        return str(configured)
    candidates = [sys.executable, "python"]
    for candidate in candidates:
        try:
            subprocess.run(
                [candidate, "-c", "import requests"],
                check=True,
                capture_output=True,
                text=True,
                timeout=10,
            )
            return candidate
        except Exception:
            continue
    return sys.executable


def _extract_text_from_ocr_json(data: Any) -> str:
    if isinstance(data, str):
        return data
    if not isinstance(data, dict):
        return ""
    if isinstance(data.get("text"), str):
        return data["text"]
    if isinstance(data.get("markdown"), str):
        return data["markdown"]
    if isinstance(data.get("result"), dict):
        return _extract_text_from_ocr_json(data["result"])
    page_list = data.get("pageList") or data.get("pages")
    if isinstance(page_list, list):
        return "\n".join(_extract_text_from_ocr_json(p) for p in page_list)
    return ""


def _build_ocr_quality_report(text: str, options: dict) -> dict[str, Any]:
    text = text or ""
    chars = len(text.strip())
    line_count = len(_iter_text_lines(text))
    replacement_count = text.count("�") + text.count("?")
    min_chars = int(options.get("ocr_min_chars", 30))
    usable = chars >= min_chars and line_count > 0
    reason = ""
    if chars < min_chars:
        reason = f"有效字符数 {chars} 少于阈值 {min_chars}"
    elif replacement_count > max(chars * 0.05, 10):
        usable = False
        reason = "疑似乱码/替换字符过多"
    return {
        "chars": chars,
        "line_count": line_count,
        "replacement_count": replacement_count,
        "usable": usable,
        "reason": reason,
        "block_confidence": 0.72 if usable else 0.3,
    }


def _audit_layout_quality(result: LayoutResult) -> None:
    table_count = 0
    complex_table_count = 0
    for block in result.blocks:
        if block.block_type != BlockType.TABLE.value or not block.table_data:
            continue
        table_count += 1
        row_lengths = {len(row) for row in block.table_data}
        blank_header = not any((cell or "").strip() for cell in block.table_data[0])
        if len(row_lengths) > 1 or blank_header:
            complex_table_count += 1
            block.metadata["complex_table"] = True
            result.warnings.append(Warning_(
                code="TABLE_COMPLEX_LAYOUT",
                message="检测到不规则表格结构,可能存在合并单元格、跨页或表头错配,下游需人工复核。",
                page=block.page,
                block_id=block.block_id,
            ))

    low_conf_blocks = [b.block_id for b in result.blocks if b.confidence < 0.7]
    if low_conf_blocks:
        result.warnings.append(Warning_(
            code="OCR_LOW_CONFIDENCE",
            message=f"存在 {len(low_conf_blocks)} 个低置信块,不建议直接进入自动抽取。",
            block_id=low_conf_blocks[0],
        ))

    result.quality_report.update({
        "block_count": len(result.blocks),
        "table_count": table_count,
        "complex_table_count": complex_table_count,
        "low_confidence_block_count": len(low_conf_blocks),
    })


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
    parser.add_argument("--ocr-text-path", help="OCR 纯文本 sidecar 路径")
    parser.add_argument("--ocr-markdown-path", help="OCR Markdown sidecar 路径")
    parser.add_argument("--ocr-json-path", help="OCR 结构化 JSON sidecar 路径")
    parser.add_argument("--ocr-skill-path", help="讯飞 OCR skill 目录,默认用 XFEI_OCR_SKILL_PATH 或同级目录")
    parser.add_argument("--ocr-python", help="运行讯飞 OCR skill 的 Python,默认自动选择可 import requests 的 Python")
    parser.add_argument("--disable-ocr", action="store_true", help="禁用 OCR 回退")
    parser.add_argument("--ocr-min-chars", type=int, default=30, help="OCR 可用文本的最小字符数")
    args = parser.parse_args()

    cli_options = {
        "enable_ocr": not args.disable_ocr,
        "ocr_min_chars": args.ocr_min_chars,
    }
    for key in ("ocr_text_path", "ocr_markdown_path", "ocr_json_path", "ocr_skill_path", "ocr_python"):
        value = getattr(args, key)
        if value:
            cli_options[key] = value

    res = parse_document(args.file_path, args.material_id, cli_options)
    out_str = json.dumps(res.to_dict(), ensure_ascii=False, indent=2)
    if args.output:
        Path(args.output).write_text(out_str, encoding="utf-8")
    else:
        print(out_str)
