import { promises as fs } from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { buildLayoutResultFromUpload } from "@/lib/skillPipeline";
import type { UploadRecord } from "@/lib/types";

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const dataDir = path.join(process.cwd(), "data");
    const uploadsPath = path.join(dataDir, "uploads.json");
    const createdAt = new Date().toISOString();
    const uploadId = payload.upload_id ?? `upload_${Date.now()}`;
    const parseStatus =
      payload.parse_status === "failed" || payload.read_status === "failed" || payload.read_status === "unsupported"
        ? "failed"
        : "success";

    await fs.mkdir(dataDir, { recursive: true });

    let uploads: unknown[] = [];
    try {
      const existing = await fs.readFile(uploadsPath, "utf8");
      uploads = JSON.parse(existing);
      if (!Array.isArray(uploads)) uploads = [];
    } catch {
      uploads = [];
    }

    const record: UploadRecord = {
      upload_id: uploadId,
      file_name: payload.file_name ?? "",
      file_type: payload.file_type ?? "unknown",
      file_size: typeof payload.file_size === "number" ? payload.file_size : 0,
      parsed_text: payload.parsed_text ?? "",
      parse_status: parseStatus === "success" ? "success" : "unsupported_or_failed",
      parser: payload.parser ?? "unsupported",
      sheets: Array.isArray(payload.sheets) ? payload.sheets : [],
      warnings: Array.isArray(payload.warnings) ? payload.warnings : [],
      created_at: createdAt,
      schema_version: 2,
      layout_result: payload.layout_result ?? buildLayoutResultFromUpload({
        upload_id: uploadId,
        file_name: payload.file_name ?? "",
        file_type: payload.file_type ?? "unknown",
        parse_status: parseStatus === "success" ? "success" : "unsupported_or_failed",
        parsed_text: payload.parsed_text ?? "",
        parser: payload.parser ?? "unsupported",
        sheets: Array.isArray(payload.sheets) ? payload.sheets : [],
        warnings: Array.isArray(payload.warnings) ? payload.warnings : []
      })
    };

    uploads.push(record);
    await fs.writeFile(uploadsPath, JSON.stringify(uploads, null, 2), "utf8");

    return NextResponse.json({
      success: true,
      message: "saved",
      upload_id: uploadId,
      created_at: createdAt,
      path: "data/uploads.json"
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: "upload_record_failed",
        error: error instanceof Error ? error.message : "unknown_error"
      },
      { status: 500 }
    );
  }
}
