import * as XLSX from "xlsx";
import type { BidEvaluationRow, ExtractedField, ReviewChoice } from "@/lib/types";

export const runtime = "nodejs";

type ExportExcelPayload = {
  review_id?: string;
  upload_id?: string;
  file_name?: string;
  task_type?: string;
  project?: Record<string, unknown>;
  extracted_fields?: ExtractedField[];
  bid_evaluation_table?: BidEvaluationRow[];
  edited_extracted_fields?: ExtractedField[];
  edited_bid_evaluation_table?: BidEvaluationRow[];
  review_summary?: ReviewSummaryItem[];
  reviewer_edits?: unknown;
};

type ReviewSummaryItem = {
  item_type?: string;
  content?: string;
  current_status?: string;
  suggestion?: string;
  review_status?: ReviewChoice;
  remark?: string;
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

const bidFormModules = [
  "响应文件递交记录表",
  "响应文件密封性检查表",
  "资格性审查表",
  "响应性审查表",
  "最后报价排序表",
  "资格审查报告",
  "询价报告"
];

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as ExportExcelPayload;
    if (payload.task_type && payload.task_type !== "bid_evaluation_table" && payload.task_type !== "mixed") {
      return Response.json({ success: false, error: "当前没有已保存的开评标表格结果，无法导出 Excel。" }, { status: 400 });
    }
    const rows = payload.edited_bid_evaluation_table ?? payload.bid_evaluation_table ?? [];
    const fields = payload.edited_extracted_fields ?? payload.extracted_fields ?? [];
    const reviewSummary = payload.review_summary ?? [];

    if (!rows.length && !fields.length) {
      return Response.json(
        {
          success: false,
          error: "当前没有已保存的开评标表格结果，无法导出 Excel。"
        },
        { status: 400 }
      );
    }

    const projectName =
      safeText(payload.project?.project_name) !== "未识别，需人工补充"
        ? safeText(payload.project?.project_name)
        : safeText(rows[0]?.project_name);

    const workbook = XLSX.utils.book_new();
    bidFormModules.forEach((moduleName) => {
      const moduleSheet = XLSX.utils.json_to_sheet(
        rows.map((row, index) => ({
          序号: index + 1,
          项目名称: safeText(row.project_name),
          项目编号: safeText(row.project_id),
          采购方式: safeText(row.procurement_method),
          开标时间: safeText(row.bid_opening_time),
          "投标单位/供应商名称": safeText(row.supplier_name),
          联系人: safeText(row.contact_person),
          联系方式: safeText(row.contact_phone),
          递交时间: safeText(row.submit_time),
          密封性检查结果: moduleName.includes("密封") ? safeText(row.seal_check_result) : "",
          不通过或不合格原因: moduleName.includes("资格") || moduleName.includes("响应") || moduleName.includes("密封") ? safeText(row.fail_reason) : "",
          供应商签字确认: moduleName.includes("密封") ? safeText(row.supplier_signature) : "",
          报价: moduleName.includes("报价") || moduleName.includes("报告") ? safeText(row.bid_price) : "",
          资格审查结果: moduleName.includes("资格") ? safeText(row.qualification_status) : "",
          符合性审查结果: moduleName.includes("响应") ? safeText(row.compliance_result) : "",
          响应性审查结果: moduleName.includes("响应") ? safeText(row.responsiveness_result) : "",
          评审得分: safeText(row.score),
          排名: safeText(row.ranking),
          "中标/成交候选顺序": safeText(row.candidate_order),
          复核状态: reviewLabel(row.review_status),
          备注: row.remark || ""
        }))
      );
      XLSX.utils.book_append_sheet(workbook, moduleSheet, moduleName.slice(0, 31));
    });
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

    XLSX.utils.book_append_sheet(workbook, fieldSheet, "基础信息识别结果");
    if (reviewSummary.length) {
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
      XLSX.utils.book_append_sheet(workbook, reviewSheet, "人工复核汇总");
    }

    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
    const filename = `开评标表格_${filenameSafe(projectName !== "未识别，需人工补充" ? projectName : payload.upload_id ?? "review")}.xlsx`;

    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`
      }
    });
  } catch (error) {
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "导出 Excel 失败。"
      },
      { status: 500 }
    );
  }
}
