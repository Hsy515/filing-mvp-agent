import { NextResponse } from "next/server";
import { analyzeWithSkills } from "@/lib/skillEngine";
import { buildLayoutResultFromAnalysis, buildPipelineResultFromAnalysis } from "@/lib/skillPipeline";
import type { S1LayoutResult } from "@/lib/types";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const materialText = typeof body.material_text === "string" ? body.material_text : "";
    const fileName = typeof body.file_name === "string" ? body.file_name : "manual-input.txt";
    const fileType = typeof body.file_type === "string" ? body.file_type : "txt";
    const fileSize = typeof body.file_size === "number" ? body.file_size : materialText.length;
    const uploadId = typeof body.upload_id === "string" ? body.upload_id : undefined;

    const result = analyzeWithSkills({
      text: materialText,
      fileName,
      fileType,
      fileSize,
      uploadId
    });
    const suppliedLayout = body.layout_result && typeof body.layout_result === "object"
      ? body.layout_result as S1LayoutResult
      : undefined;
    const layoutResult = suppliedLayout ?? buildLayoutResultFromAnalysis(result);
    const pipelineResult = buildPipelineResultFromAnalysis(
      result,
      layoutResult,
      body.source === "ocr_api" ? "ocr_api" : "file_parse"
    );

    return NextResponse.json({
      ...result,
      pipeline_result: pipelineResult,
      schema_version: 2
    });
  } catch {
    const fallback = analyzeWithSkills({
      text: "",
      fileName: "fallback.txt",
      fileType: "txt",
      fileSize: 0
    });
    const pipelineResult = buildPipelineResultFromAnalysis(fallback);
    return NextResponse.json({
      ...fallback,
      pipeline_result: pipelineResult,
      schema_version: 2,
      source: "fallback_mock",
      warnings: [
        {
          type: "fallback_mock",
          message: "File parsing or Skill analysis failed. Returned fallback mock result."
        }
      ]
    });
  }
}
