import * as XLSX from "xlsx";
import type { DirectoryPlacement, ExtractedField, ReviewChoice } from "@/lib/types";

export const runtime = "nodejs";

type ExportFilingChecklistPayload = {
  review_id?: string;
  upload_id?: string;
  file_name?: string;
  task_type?: string;
  project?: Record<string, unknown>;
  edited_extracted_fields?: ExtractedField[];
  edited_directory_placement?: DirectoryPlacement[];
  review_summary?: Array<{
    item_type?: string;
    content?: string;
    current_status?: string;
    suggestion?: string;
    review_status?: ReviewChoice;
    remark?: string;
  }>;
};

function safeText(value: unknown) {
  if (value === undefined || value === null || value === "" || value === "missing") return "未识别，需人工补充";
  return String(value);
}

function reviewLabel(value?: ReviewChoice) {
  const labels: Record<string, string> = {
    pending: "待复核",
    confirmed: "已确认",
    needs_change: "需修改",
    discussion: "待讨论"
  };
  return value ? labels[value] ?? value : "待复核";
}

function filenameSafe(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, "_").slice(0, 80) || "未命名项目";
}

function fieldValue(fields: ExtractedField[], key: string) {
  return safeText(fields.find((field) => field.field_key === key)?.value);
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as ExportFilingChecklistPayload;
    if (payload.task_type && payload.task_type !== "filing_document" && payload.task_type !== "mixed") {
      return Response.json({ success: false, error: "当前没有已保存的备案目录归位结果，无法导出归档清单。" }, { status: 400 });
    }

    const fields = payload.edited_extracted_fields ?? [];
    const placement = payload.edited_directory_placement ?? [];
    const reviewSummary = payload.review_summary ?? [];

    if (!fields.length && !placement.length) {
      return Response.json({ success: false, error: "当前没有已保存的备案目录归位结果，无法导出归档清单。" }, { status: 400 });
    }

    const projectName = safeText(payload.project?.project_name) !== "未识别，需人工补充"
      ? safeText(payload.project?.project_name)
      : fieldValue(fields, "project_name");

    const workbook = XLSX.utils.book_new();
    const checklistSheet = XLSX.utils.json_to_sheet(
      placement.map((item, index) => ({
        序号: index + 1,
        匹配备案模板: safeText(payload.project?.project_type),
        原始文件名: safeText(item.matched_file_name || payload.file_name),
        识别材料类别: safeText(item.recognized_material_type),
        模板目录位置: item.template_position,
        模板要求材料: item.required_material,
        归位状态: item.placement_status,
        归位依据: item.placement_basis,
        是否必需: item.required ? "是" : "否",
        复核状态: reviewLabel(item.review_status),
        备注: item.remark || ""
      }))
    );
    const missingSheet = XLSX.utils.json_to_sheet(
      placement
        .filter((item) => item.required && item.placement_status !== "placed")
        .map((item, index) => ({
          序号: index + 1,
          缺失材料: item.required_material,
          目录位置: item.template_position,
          当前状态: item.placement_status,
          处理建议: "请补充材料或人工确认归位。",
          备注: item.remark || ""
        }))
    );
    const fieldSheet = XLSX.utils.json_to_sheet(
      fields.map((field) => ({
        字段名称: field.field_name,
        识别结果: safeText(field.value),
        来源文件: field.source_file,
        来源摘录: field.evidence_text,
        识别状态: field.status,
        置信度: field.confidence,
        复核状态: reviewLabel(field.review_status),
        备注: field.remark || ""
      }))
    );
    const reviewSheet = XLSX.utils.json_to_sheet(
      reviewSummary.map((item) => ({
        关注项类型: safeText(item.item_type),
        具体内容: safeText(item.content),
        当前状态: safeText(item.current_status),
        处理建议: safeText(item.suggestion),
        复核状态: reviewLabel(item.review_status),
        备注: item.remark || ""
      }))
    );

    XLSX.utils.book_append_sheet(workbook, checklistSheet, "备案目录归位清单");
    XLSX.utils.book_append_sheet(workbook, missingSheet, "缺失必需材料");
    XLSX.utils.book_append_sheet(workbook, fieldSheet, "基础信息识别结果");
    if (reviewSummary.length) XLSX.utils.book_append_sheet(workbook, reviewSheet, "人工复核汇总");

    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
    const filename = `备案归档清单_${filenameSafe(projectName !== "未识别，需人工补充" ? projectName : payload.upload_id ?? "review")}.xlsx`;

    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`
      }
    });
  } catch (error) {
    return Response.json(
      { success: false, error: error instanceof Error ? error.message : "导出备案归档清单失败。" },
      { status: 500 }
    );
  }
}
