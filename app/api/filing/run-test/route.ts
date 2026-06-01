import { promises as fs } from "fs";
import path from "path";
import { NextResponse } from "next/server";

const EXPECTED_FILES: Record<string, string> = {
  public_bidding: "public-bidding-expected.json",
  competitive_consultation: "competitive-consultation-expected.json",
  attachment_classification: "attachment-classification-expected.json"
};

type ExpectedResult = Record<string, unknown> & {
  file_name?: string;
  file_type?: string;
  procurement_method?: string;
  project_name?: string;
  project_no?: string;
  budget?: string;
  ceiling_price?: string;
  subject?: string;
  matched_template_type?: string;
  attachment_classification?: Array<Record<string, unknown>>;
};

function field(key: string, name: string, value: unknown) {
  return {
    field_key: key,
    field_name: name,
    value: typeof value === "string" && value ? value : "missing",
    review_status: "pending",
    remark: ""
  };
}

function buildExtractedFields(expected: ExpectedResult) {
  return [
    field("file_type", "文件类型", expected.file_type),
    field("procurement_method", "采购方式", expected.procurement_method),
    field("project_name", "项目名称", expected.project_name),
    field("project_no", "项目编号", expected.project_no),
    field("budget", "采购预算", expected.budget),
    field("ceiling_price", "最高限价", expected.ceiling_price),
    field("subject", "标的名称", expected.subject)
  ];
}

function buildGeneratedOutputs(expected: ExpectedResult) {
  return {
    should_generate_bid_table: Boolean(expected.should_generate_bid_table),
    should_match_filing_template: Boolean(expected.should_match_filing_template),
    directory_placement: expected.matched_template_type
      ? [
          {
            template_position: "企业模板匹配",
            matched_template_type: expected.matched_template_type,
            template_source: "expected_results"
          }
        ]
      : [],
    bid_table_preview: expected.should_generate_bid_table
      ? [
          {
            project_name: expected.project_name ?? "missing",
            project_no: expected.project_no ?? "missing",
            procurement_method: expected.procurement_method ?? "missing",
            supplier_name: "未识别 / 需人工补充",
            bid_price: "未识别 / 需人工补充",
            qualification_status: "未识别 / 需人工补充",
            score: "未识别 / 需人工补充"
          }
        ]
      : [],
    attachment_classification: expected.attachment_classification ?? []
  };
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const testCaseType = typeof body.test_case_type === "string" ? body.test_case_type : "";
    const expectedFile = EXPECTED_FILES[testCaseType];

    if (!expectedFile) {
      return NextResponse.json(
        {
          success: false,
          message: "unknown_test_case_type",
          error: "Unsupported test case type."
        },
        { status: 400 }
      );
    }

    const expectedPath = path.join(process.cwd(), "demo-materials", "expected-results", expectedFile);
    const expected = JSON.parse(await fs.readFile(expectedPath, "utf8")) as ExpectedResult;
    const dataDir = path.join(process.cwd(), "data");
    const testRunsPath = path.join(dataDir, "test-runs.json");
    const createdAt = new Date().toISOString();
    const testId = `test_${Date.now()}`;

    await fs.mkdir(dataDir, { recursive: true });

    let existingRuns: unknown[] = [];
    try {
      const existing = await fs.readFile(testRunsPath, "utf8");
      existingRuns = JSON.parse(existing);
      if (!Array.isArray(existingRuns)) existingRuns = [];
    } catch {
      existingRuns = [];
    }

    const record = {
      test_id: testId,
      file_name: expected.file_name ?? "",
      test_case_type: testCaseType,
      extracted_fields: buildExtractedFields(expected),
      matched_template: expected.matched_template_type ?? "",
      generated_outputs: buildGeneratedOutputs(expected),
      review_status: "pending",
      created_at: createdAt
    };

    existingRuns.push(record);
    await fs.writeFile(testRunsPath, JSON.stringify(existingRuns, null, 2), "utf8");

    return NextResponse.json({
      success: true,
      path: "data/test-runs.json",
      ...record
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: "test_run_failed",
        error: error instanceof Error ? error.message : "unknown_error"
      },
      { status: 500 }
    );
  }
}
