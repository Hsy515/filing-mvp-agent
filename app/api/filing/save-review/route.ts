import { promises as fs } from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { buildPipelineResultFromAnalysis } from "@/lib/skillPipeline";
import type { ExtractedField, SkillAnalysisResult } from "@/lib/types";

function fieldValue(fields: ExtractedField[], key: string) {
  const found = fields.find((item) => item.field_key === key);
  return found?.value && found.value !== "missing" ? found.value : "";
}

function buildProject(payload: { project?: unknown; extracted_fields?: ExtractedField[] }) {
  if (payload.project && typeof payload.project === "object") return payload.project;

  const fields = Array.isArray(payload.extracted_fields) ? payload.extracted_fields : [];
  return {
    project_id: fieldValue(fields, "project_id"),
    project_name: fieldValue(fields, "project_name"),
    procurement_method: fieldValue(fields, "procurement_method"),
    purchaser: fieldValue(fields, "purchaser"),
    package_info: fieldValue(fields, "package_info")
  };
}

function normalizeReviewerEdits(value: unknown) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    return Object.entries(value).map(([target, detail]) => ({
      target,
      detail
    }));
  }
  return [];
}

function normalizeReviewStatus(value: unknown) {
  if (value === "saved") return "saved";
  if (value === "reviewed" || value === "confirmed") return "reviewed";
  return "pending";
}

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const dataDir = path.join(process.cwd(), "data");
    const reviewsPath = path.join(dataDir, "reviews.json");
    const savedAt = new Date().toISOString();
    const reviewId = payload.review_id ?? `review_${Date.now()}`;
    const taskType = payload.task_type ?? "unknown";
    const reviewStatus = normalizeReviewStatus(payload.review_status);

    await fs.mkdir(dataDir, { recursive: true });

    let reviews: unknown[] = [];
    try {
      const existing = await fs.readFile(reviewsPath, "utf8");
      reviews = JSON.parse(existing);
      if (!Array.isArray(reviews)) reviews = [];
    } catch {
      reviews = [];
    }

    const editedExtractedFields = payload.edited_extracted_fields ?? payload.extracted_fields ?? [];
    const editedDirectoryPlacement = payload.edited_directory_placement ?? payload.directory_placement ?? [];
    const editedBidEvaluationTable = payload.edited_bid_evaluation_table ?? payload.bid_evaluation_table ?? [];
    const editedDraftOutline = payload.edited_draft_outline ?? payload.draft_outline ?? { draft_title: "备案文件初稿", sections: [] };
    const reviewSummary = payload.review_summary ?? [];
    const matchedBasicTemplates = Array.isArray(payload.matched_basic_templates) ? payload.matched_basic_templates : [];
    const primaryTemplate = matchedBasicTemplates[0];

    const analysisForPipeline: SkillAnalysisResult = {
      review_id: reviewId,
      upload_id: payload.upload_id ?? "",
      source: "skill_rule",
      source_file: {
        file_name: payload.source_file?.file_name ?? payload.file_name ?? "",
        file_type: payload.source_file?.file_type ?? payload.file_type ?? "",
        file_size: typeof payload.file_size === "number" ? payload.file_size : 0
      },
      parsed_text: typeof payload.parsed_text === "string" ? payload.parsed_text : "",
      material_type: payload.material_type ?? "",
      task_type: taskType,
      task_basis: payload.task_basis ?? "review_saved",
      matched_basic_templates: matchedBasicTemplates,
      template_source: payload.template_source ?? "fallback_rules",
      extracted_fields: editedExtractedFields,
      directory_placement: editedDirectoryPlacement,
      bid_evaluation_table: editedBidEvaluationTable,
      draft_outline: Array.isArray(editedDraftOutline) ? editedDraftOutline[0] ?? { draft_title: "备案文件初稿", sections: [] } : editedDraftOutline,
      warnings: [],
      skill_basis: ["filing-skills/s1-s5 schema v2 review persistence"],
      review_required: reviewStatus !== "reviewed"
    };
    const pipelineResult = payload.pipeline_result ?? buildPipelineResultFromAnalysis(analysisForPipeline);

    const record = {
      schema_version: 2,
      review_id: reviewId,
      upload_id: payload.upload_id ?? "",
      file_name: payload.source_file?.file_name ?? payload.file_name ?? "",
      file_type: payload.source_file?.file_type ?? payload.file_type ?? "",
      task_type: taskType,
      template_id: payload.template_id ?? primaryTemplate?.template_id ?? "",
      template_name: payload.template_name ?? primaryTemplate?.template_name ?? "",
      template_type: payload.template_type ?? primaryTemplate?.template_type ?? taskType,
      output_type: payload.output_type ?? primaryTemplate?.output_type ?? "",
      matched_basic_templates: matchedBasicTemplates,
      template_source: payload.template_source ?? "fallback_rules",
      project: buildProject(payload),
      extracted_fields: editedExtractedFields,
      directory_placement: editedDirectoryPlacement,
      bid_evaluation_table: editedBidEvaluationTable,
      draft_outline: editedDraftOutline ? [editedDraftOutline].flat() : [],
      edited_extracted_fields: editedExtractedFields,
      edited_directory_placement: editedDirectoryPlacement,
      edited_draft_outline: editedDraftOutline,
      edited_bid_evaluation_table: editedBidEvaluationTable,
      pipeline_result: pipelineResult,
      review_summary: reviewSummary,
      review_status: reviewStatus,
      reviewer_edits: normalizeReviewerEdits(payload.reviewer_edits),
      saved_at: savedAt
    };

    reviews.push(record);
    await fs.writeFile(reviewsPath, JSON.stringify(reviews, null, 2), "utf8");

    return NextResponse.json({
      success: true,
      message: "saved",
      review_id: reviewId,
      saved_at: savedAt,
      path: "data/reviews.json",
      saved_review: record
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: "save_failed",
        error: error instanceof Error ? error.message : "unknown_error"
      },
      { status: 500 }
    );
  }
}
