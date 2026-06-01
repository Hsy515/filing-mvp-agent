import {
  Document,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType
} from "docx";
import type { DirectoryPlacement, DraftOutline, ExtractedField, ReviewChoice } from "@/lib/types";

export const runtime = "nodejs";

type ExportWordPayload = {
  review_id?: string;
  upload_id?: string;
  file_name?: string;
  task_type?: string;
  project?: Record<string, unknown>;
  extracted_fields?: ExtractedField[];
  directory_placement?: DirectoryPlacement[];
  draft_outline?: DraftOutline;
  edited_extracted_fields?: ExtractedField[];
  edited_directory_placement?: DirectoryPlacement[];
  edited_draft_outline?: DraftOutline;
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
  if (value === undefined || value === null || value === "" || value === "missing") return "未识别";
  return String(value);
}

function fieldValue(fields: ExtractedField[], key: string) {
  const value = fields.find((field) => field.field_key === key)?.value;
  return safeText(value);
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

function paragraph(text: string, bold = false) {
  return new Paragraph({
    spacing: { after: 160 },
    children: [new TextRun({ text, bold })]
  });
}

function cell(text: string) {
  return new TableCell({
    width: { size: 16, type: WidthType.PERCENTAGE },
    children: [new Paragraph(String(text))]
  });
}

function makeTable(rows: string[][]) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map((row) => new TableRow({ children: row.map(cell) }))
  });
}

function filenameSafe(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, "_").slice(0, 80) || "未命名项目";
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as ExportWordPayload;
    if (payload.task_type && payload.task_type !== "filing_document" && payload.task_type !== "mixed") {
      return Response.json({ success: false, error: "当前没有已保存的备案文件结果，无法导出 Word。" }, { status: 400 });
    }
    const fields = payload.edited_extracted_fields ?? payload.extracted_fields ?? [];
    const placement = payload.edited_directory_placement ?? payload.directory_placement ?? [];
    const draft = payload.edited_draft_outline ?? payload.draft_outline;
    const reviewSummary = payload.review_summary ?? [];
    const projectName = safeText(payload.project?.project_name) !== "未识别"
      ? safeText(payload.project?.project_name)
      : fieldValue(fields, "project_name");

    if (!fields.length && !placement.length && !draft?.sections?.length) {
      return Response.json(
        {
          success: false,
          error: "当前材料未生成备案文件结果，无法导出 Word。请先选择备案文件生成路径并完成识别。"
        },
        { status: 400 }
      );
    }

    const document = new Document({
      sections: [
        {
          children: [
            new Paragraph({
              spacing: { after: 260 },
              children: [new TextRun({ text: "备案文件初稿", bold: true, size: 36 })]
            }),
            paragraph("当前导出为结构化 Word 初稿，正式企业模板版式注入将在后续版本优化。"),
            paragraph("一、项目基本信息", true),
            makeTable([
              ["字段", "内容"],
              ["项目名称", projectName],
              ["项目编号", fieldValue(fields, "project_id")],
              ["采购方式", fieldValue(fields, "procurement_method")],
              ["采购人", fieldValue(fields, "purchaser")],
              ["代理机构", fieldValue(fields, "agency")],
              ["预算金额", fieldValue(fields, "budget")],
              ["最高限价", fieldValue(fields, "ceiling_price")]
            ]),
            paragraph("二、备案材料目录归位结果", true),
            makeTable([
              ["模板目录位置", "模板要求材料", "系统识别材料", "归位状态", "归位依据", "复核状态", "备注"],
              ...placement.map((item) => [
                item.template_position,
                item.required_material,
                safeText(item.recognized_material_type),
                item.placement_status,
                item.placement_basis,
                reviewLabel(item.review_status),
                item.remark || ""
              ])
            ]),
            paragraph("三、备案文件结构预览", true),
            ...(draft?.sections ?? []).flatMap((section) => [
              paragraph(section.section_title, true),
              paragraph(section.content_preview || "待补充")
            ]),
            paragraph("四、人工复核意见", true),
            makeTable([
              ["字段名称", "识别结果", "复核状态", "备注"],
              ...fields.map((field) => [
                field.field_name,
                safeText(field.value),
                reviewLabel(field.review_status),
                field.remark || ""
              ])
            ]),
            ...(reviewSummary.length
              ? [
                  paragraph("五、复核汇总", true),
                  makeTable([
                    ["关注项类型", "具体内容", "当前状态", "处理建议", "复核状态", "备注"],
                    ...reviewSummary.map((item) => [
                      safeText(item.item_type),
                      safeText(item.content),
                      safeText(item.current_status),
                      safeText(item.suggestion),
                      reviewLabel(item.review_status),
                      item.remark || ""
                    ])
                  ])
                ]
              : [])
          ]
        }
      ]
    });

    const buffer = await Packer.toBuffer(document);
    const filename = `备案文件初稿_${filenameSafe(projectName !== "未识别" ? projectName : payload.upload_id ?? "review")}.docx`;

    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`
      }
    });
  } catch (error) {
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "导出 Word 失败。"
      },
      { status: 500 }
    );
  }
}
