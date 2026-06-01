import path from "path";
import mammoth from "mammoth";
import * as xlsx from "xlsx";
import type { S1LayoutResult } from "./types";

export type ParsedSheet = {
  sheet_name: string;
  rows: string[][];
};

export type ParseStatus = "success" | "partial" | "unsupported_or_failed";
export type ParserName =
  | "txt"
  | "mammoth"
  | "xlsx"
  | "pdf-parse"
  | "word-extractor"
  | "ocr-pending"
  | "unsupported";

export type ParsedUpload = {
  upload_id: string;
  file_name: string;
  file_type: string;
  file_size: number;
  parse_status: ParseStatus;
  parsed_text: string;
  sheets: ParsedSheet[];
  parser: ParserName;
  layout_result?: S1LayoutResult;
  schema_version?: 2;
  warnings: string[];
  created_at: string;
};

type XlsxModule = {
  read(data: Buffer, options: { type: "buffer" }): { SheetNames: string[]; Sheets: Record<string, unknown> };
  utils: {
    sheet_to_json(sheet: unknown, options: { header: 1; raw: false; defval: string }): unknown[][];
  };
};

type PdfParseModule = ((data: Buffer) => Promise<{ text?: string }>) | { default: (data: Buffer) => Promise<{ text?: string }> };

type WordExtractorConstructor = new () => {
  extract(buffer: Buffer): Promise<{ getBody(): string }>;
};

type WordExtractorModule = WordExtractorConstructor | { default?: WordExtractorConstructor };

function extensionOf(fileName: string) {
  return path.extname(fileName).replace(".", "").toLowerCase();
}

function textFromSheets(sheets: ParsedSheet[]) {
  return sheets
    .map((sheet) => {
      const rows = sheet.rows.map((row) => row.join("\t")).join("\n");
      return `Sheet: ${sheet.sheet_name}\n${rows}`;
    })
    .join("\n\n");
}

function baseResult(buffer: Buffer, fileName: string): ParsedUpload {
  return {
    upload_id: `upload_${Date.now()}`,
    file_name: fileName,
    file_type: extensionOf(fileName) || "unknown",
    file_size: buffer.byteLength,
    parse_status: "unsupported_or_failed",
    parsed_text: "",
    sheets: [],
    parser: "unsupported",
    warnings: [],
    created_at: new Date().toISOString()
  };
}

async function loadPdfParse() {
  const module = (await import("pdf-parse")) as PdfParseModule;
  return typeof module === "function" ? module : module.default;
}

function isImageExtension(ext: string) {
  return ["png", "jpg", "jpeg", "webp", "bmp", "tif", "tiff"].includes(ext);
}

function decodeHtml(value: string) {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function extractDocxTableText(html: string) {
  const tables = Array.from(html.matchAll(/<table[\s\S]*?<\/table>/gi)).map((match) => match[0]);
  if (!tables.length) return "";
  return tables
    .map((table, tableIndex) => {
      const rows = Array.from(table.matchAll(/<tr[\s\S]*?<\/tr>/gi)).map((rowMatch) => {
        const cells = Array.from(rowMatch[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi))
          .map((cellMatch) => decodeHtml(cellMatch[1].replace(/<[^>]+>/g, "")))
          .filter(Boolean);
        return cells.join(" | ");
      }).filter(Boolean);
      return rows.length ? [`Word 表格 ${tableIndex + 1}`, ...rows].join("\n") : "";
    })
    .filter(Boolean)
    .join("\n\n");
}

export async function parseUploadedFile(buffer: Buffer, fileName: string, mimeType?: string): Promise<ParsedUpload> {
  const result = baseResult(buffer, fileName);
  const ext = result.file_type;

  try {
    if (ext === "txt") {
      const parsedText = buffer.toString("utf8").trim();
      return {
        ...result,
        parse_status: parsedText ? "success" : "partial",
        parsed_text: parsedText,
        parser: "txt",
        warnings: parsedText ? [] : ["未解析到可分析文本，请确认文件编码或内容。"]
      };
    }

    if (ext === "docx") {
      const parsed = await mammoth.extractRawText({ buffer });
      const htmlResult = await mammoth.convertToHtml({ buffer });
      const tableText = extractDocxTableText(htmlResult.value ?? "");
      const parsedText = [(parsed.value ?? "").trim(), tableText ? `结构化表格文本：\n${tableText}` : ""]
        .filter(Boolean)
        .join("\n\n")
        .trim();
      const warnings = (parsed.messages ?? [])
        .map((message: { message?: string }) => message.message ?? "")
        .filter(Boolean);
      const htmlWarnings = (htmlResult.messages ?? [])
        .map((message: { message?: string }) => message.message ?? "")
        .filter(Boolean);
      return {
        ...result,
        parse_status: parsedText ? "success" : "partial",
        parsed_text: parsedText,
        parser: "mammoth",
        warnings: parsedText ? [...warnings, ...htmlWarnings] : [...warnings, ...htmlWarnings, "未从 docx 中解析到正文文本。"]
      };
    }

    if (ext === "doc") {
      try {
        const module = (await import("word-extractor")) as unknown as WordExtractorModule;
        const WordExtractor = ((module as { default?: WordExtractorConstructor }).default ?? module) as WordExtractorConstructor;
        const extractor = new WordExtractor();
        const document = await extractor.extract(buffer);
        const parsedText = document.getBody().trim();
        return {
          ...result,
          parse_status: parsedText ? "success" : "partial",
          parsed_text: parsedText,
          parser: "word-extractor",
          warnings: ["当前 .doc 旧版 Word 文件解析可能不稳定，建议转换为 .docx 后重新上传。"]
        };
      } catch (error) {
        return {
          ...result,
          parser: "word-extractor",
          warnings: [
            "当前 .doc 旧版 Word 文件解析可能不稳定，建议转换为 .docx 后重新上传。",
            error instanceof Error ? error.message : "doc 解析失败"
          ]
        };
      }
    }

    if (ext === "xlsx" || ext === "xls") {
      const workbook = (xlsx as XlsxModule).read(buffer, { type: "buffer" });
      const sheets = workbook.SheetNames.map((sheetName) => {
        const rows = (xlsx as XlsxModule).utils
          .sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: false, defval: "" })
          .map((row) => row.map((cell) => String(cell ?? "")));
        return { sheet_name: sheetName, rows };
      });
      const parsedText = textFromSheets(sheets).trim();
      return {
        ...result,
        parse_status: parsedText ? "success" : "partial",
        parsed_text: parsedText,
        sheets,
        parser: "xlsx",
        warnings: parsedText ? [] : ["Excel 中未解析到可分析单元格文本。"]
      };
    }

    if (ext === "pdf") {
      const pdfParse = await loadPdfParse();
      const parsed = await pdfParse(buffer);
      const parsedText = (parsed.text ?? "").trim();
      return {
        ...result,
        parse_status: parsedText ? "success" : "partial",
        parsed_text: parsedText,
        parser: "pdf-parse",
        warnings: parsedText ? [] : ["该 PDF 可能为扫描件或图片型 PDF，当前版本暂未接入真实 OCR。"]
      };
    }

    if (isImageExtension(ext)) {
      return {
        ...result,
        parser: "ocr-pending",
        warnings: [
          "图片文字识别依赖 tesseract.js、pdfjs-dist 和 @napi-rs/canvas 已写入 dependencies，真实 OCR 流程将在后续版本接入。"
        ]
      };
    }

    if (ext === "zip") {
      return {
        ...result,
        warnings: ["zip 批量材料解析将在下一阶段实现。当前请先上传解压后的单个 Word、Excel、PDF 或 txt 文件。"]
      };
    }

    return {
      ...result,
      warnings: [`当前仅支持 txt、doc、docx、xls、xlsx、pdf 文件。收到的文件类型：${ext || mimeType || "unknown"}`]
    };
  } catch (error) {
    return {
      ...result,
      warnings: [error instanceof Error ? error.message : "文件解析失败。"]
    };
  }
}
