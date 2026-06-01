import { NextResponse } from "next/server";
import { mockOcr } from "@/lib/mockOcr";
import { buildLayoutResultFromUpload } from "@/lib/skillPipeline";
import type { OcrFileType } from "@/lib/types";

const SUPPORTED_FILE_TYPES: OcrFileType[] = ["pdf", "image", "txt"];

function pendingLayout(ocrId: string, fileName: string, fileType: OcrFileType, warning: string) {
  return buildLayoutResultFromUpload({
    upload_id: ocrId,
    file_name: fileName,
    file_type: fileType,
    parse_status: "unsupported_or_failed",
    parsed_text: "",
    parser: "ocr-pending",
    sheets: [],
    warnings: [warning]
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const fileName = typeof body.file_name === "string" ? body.file_name : "采购公告扫描件.pdf";
    const requestedFileType = body.file_type;
    const fileType = SUPPORTED_FILE_TYPES.includes(requestedFileType) ? requestedFileType : "pdf";

    const result = mockOcr(fileName, fileType);
    return NextResponse.json({
      ...result,
      schema_version: 2,
      recognized_text: "",
      detected_material_type: "待接入真实 OCR 服务",
      confidence: 0,
      layout_blocks: [],
      layout_result: pendingLayout(result.ocr_id, result.source_file.file_name, result.source_file.file_type, "真实 OCR API 尚未接入，当前仅返回 OCR 待接入状态。"),
      warnings: [
        {
          type: "ocr_pending",
          message: "当前暂不调用真实 OCR。扫描件、图片、图片型 PDF 的文字识别将在密钥和外部 API 配置完成后接入。"
        }
      ],
      source: "ocr_pending"
    });
  } catch {
    const result = mockOcr("采购公告扫描件.pdf", "pdf");
    return NextResponse.json({
      ...result,
      schema_version: 2,
      layout_result: pendingLayout(result.ocr_id, result.source_file.file_name, result.source_file.file_type, "OCR 接口异常，返回兜底待接入结构。"),
      source: "fallback_mock"
    });
  }
}
