import { promises as fs } from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { parseUploadedFile, type ParsedUpload } from "@/lib/fileParser";
import { buildLayoutResultFromUpload } from "@/lib/skillPipeline";

export const runtime = "nodejs";

function extensionOf(fileName: string) {
  return path.extname(fileName).replace(".", "").toLowerCase() || "unknown";
}

function failedUpload(fileName: string, fileType: string, fileSize: number, warnings: string[]): ParsedUpload {
  return {
    upload_id: `upload_${Date.now()}`,
    file_name: fileName,
    file_type: fileType,
    file_size: fileSize,
    parse_status: "unsupported_or_failed",
    parsed_text: "",
    sheets: [],
    parser: "unsupported",
    warnings,
    created_at: new Date().toISOString()
  };
}

async function appendUploadRecord(upload: ParsedUpload) {
  const dataDir = path.join(process.cwd(), "data");
  const uploadsPath = path.join(dataDir, "uploads.json");
  await fs.mkdir(dataDir, { recursive: true });

  let uploads: unknown[] = [];
  try {
    const existing = await fs.readFile(uploadsPath, "utf8");
    uploads = JSON.parse(existing);
    if (!Array.isArray(uploads)) uploads = [];
  } catch {
    uploads = [];
  }

  uploads.push(upload);
  await fs.writeFile(uploadsPath, JSON.stringify(uploads, null, 2), "utf8");
}

function jsonResponse(payload: Record<string, unknown>, status = 200) {
  return NextResponse.json(payload, { status });
}

export async function POST(req: Request) {
  let upload: ParsedUpload | null = null;

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file || typeof file !== "object" || !("arrayBuffer" in file)) {
      upload = failedUpload("", "unknown", 0, ["未接收到上传文件，请重新选择文件。"]);
      return jsonResponse({
        success: false,
        error: "未接收到上传文件，请重新选择文件。",
        upload
      });
    }

    const fileName = file.name || "未命名文件";
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    try {
      upload = await parseUploadedFile(buffer, fileName, file.type);
    } catch (error) {
      upload = failedUpload(fileName, extensionOf(fileName), buffer.byteLength, [
        error instanceof Error ? error.message : "文件解析失败，请检查文件格式后重试。"
      ]);
    }
    upload = {
      ...upload,
      schema_version: 2,
      layout_result: buildLayoutResultFromUpload(upload)
    };

    const saveWarnings: string[] = [];
    try {
      await appendUploadRecord(upload);
    } catch (error) {
      saveWarnings.push(error instanceof Error ? `上传记录保存失败：${error.message}` : "上传记录保存失败。");
    }

    const warnings = [...upload.warnings, ...saveWarnings];
    const responseUpload = {
      ...upload,
      warnings
    };

    return jsonResponse({
      success: upload.parse_status !== "unsupported_or_failed",
      upload: responseUpload,
      warnings,
      path: saveWarnings.length ? undefined : "data/uploads.json",
      error: upload.parse_status === "unsupported_or_failed" ? warnings[0] ?? "文件解析失败。" : undefined
    });
  } catch (error) {
    const fallbackUpload =
      upload ??
      failedUpload("", "unknown", 0, [
        error instanceof Error ? error.message : "文件解析接口异常，请查看 PowerShell 后端报错。"
      ]);

    return jsonResponse({
      success: false,
      error: fallbackUpload.warnings[0] ?? "文件解析接口异常，请查看 PowerShell 后端报错。",
      upload: fallbackUpload,
      warnings: fallbackUpload.warnings
    });
  }
}
