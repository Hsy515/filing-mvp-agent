import type {
  BidEvaluationRow,
  DirectoryPlacement,
  DraftOutline,
  ExtractedField,
  S1LayoutBlock,
  S1LayoutResult,
  S2BasicInfoItem,
  S3DirectoryMatch,
  SkillAnalysisResult,
  SkillPipelineResult,
  UploadRecord
} from "./types";

type ParsedUploadLike = Pick<UploadRecord, "upload_id" | "file_name" | "file_type" | "parse_status" | "parsed_text" | "parser" | "sheets" | "warnings">;

const MISSING_VALUES = new Set(["", "missing", "未识别", "未识别，需人工补充", "上传材料中未找到对应信息"]);

function nowId(prefix: string) {
  return `${prefix}_${Date.now()}`;
}

function normalizeText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function isMissingValue(value: unknown) {
  return MISSING_VALUES.has(normalizeText(value));
}

function semanticTag(text: string) {
  const rules: Array<[string, RegExp]> = [
    ["project_name", /项目名称|采购项目名称/],
    ["project_id", /项目编号|招标编号|采购编号/],
    ["purchase_method", /采购方式|招标方式/],
    ["budget", /预算|最高限价|控制价/],
    ["purchaser", /采购人|采购单位/],
    ["agent", /代理机构|采购代理/],
    ["bid_open_time", /开标时间|响应文件提交|投标截止/],
    ["registration_end", /报名截止|获取文件时间|登记截止/],
    ["supplier_name", /供应商|投标人|投标单位/],
    ["winner_name", /中标人|成交供应商|成交人/],
    ["winning_amount", /中标金额|成交金额|报价/],
    ["supplier_list_header", /供应商|投标人|社会信用代码|报价|排名/],
    ["extra_archive_requirement", /归档|备案|目录|材料/],
    ["format_requirement", /签字|盖章|密封/]
  ];
  return rules.find(([, pattern]) => pattern.test(text))?.[0] ?? "unknown";
}

function blockType(text: string, index: number): S1LayoutBlock["block_type"] {
  if (index === 0 && text.length <= 80) return "title";
  if (/^[一二三四五六七八九十]+[、.．]|^\d+[、.．]/.test(text)) return "list_item";
  if (text.length <= 40 && /公告|文件|记录|清单|报告/.test(text)) return "subtitle";
  return "paragraph";
}

function makeBlock(text: string, index: number, page = 1): S1LayoutBlock {
  return {
    block_id: `blk_${String(index + 1).padStart(4, "0")}`,
    block_type: blockType(text, index),
    semantic_tag: semanticTag(text),
    text,
    page,
    bbox: [0, 0, 0, 0],
    confidence: 0.86,
    table_data: null,
    metadata: { source: "typescript_adapter" }
  };
}

function textBlocks(text: string) {
  return text
    .split(/\r?\n/)
    .map(normalizeText)
    .filter(Boolean)
    .slice(0, 300)
    .map((line, index) => makeBlock(line, index));
}

function sheetBlocks(upload: ParsedUploadLike, offset: number): S1LayoutBlock[] {
  return (upload.sheets ?? []).flatMap((sheet, sheetIndex) => {
    if (!sheet.rows.length) return [];
    const text = `Sheet: ${sheet.sheet_name}`;
    return [{
      block_id: `blk_${String(offset + sheetIndex + 1).padStart(4, "0")}`,
      block_type: "table" as const,
      semantic_tag: semanticTag(sheet.rows.slice(0, 3).flat().join(" ")),
      text,
      page: sheetIndex + 1,
      bbox: [0, 0, 0, 0],
      confidence: 0.9,
      table_data: sheet.rows,
      metadata: { sheet_name: sheet.sheet_name, source: "xlsx_adapter" }
    }];
  });
}

export function buildLayoutResultFromUpload(upload: ParsedUploadLike): S1LayoutResult {
  const blocks = [...textBlocks(upload.parsed_text), ...sheetBlocks(upload, textBlocks(upload.parsed_text).length)];
  const parseStatus = upload.parse_status === "success" ? "success" : upload.parse_status === "partial" ? "partial" : "failed";
  const tableCount = blocks.filter((block) => block.block_type === "table").length;

  return {
    material_id: upload.upload_id.replace(/^upload_/, "mat_"),
    file_name: upload.file_name,
    file_type: upload.file_type || "unknown",
    parse_status: blocks.length ? parseStatus : "failed",
    page_count: Math.max(1, ...blocks.map((block) => block.page)),
    engine: `next-file-parser/${upload.parser}`,
    blocks,
    warnings: upload.warnings.map((message) => ({
      code: parseStatus === "failed" ? "FILE_CORRUPTED" : "ENGINE_FALLBACK",
      message
    })),
    quality_report: {
      block_count: blocks.length,
      table_count: tableCount,
      complex_table_count: 0,
      low_confidence_block_count: 0,
      adapter_note: "S1-compatible layout generated from current Next.js parser output."
    }
  };
}

export function buildLayoutResultFromAnalysis(analysis: SkillAnalysisResult): S1LayoutResult {
  return buildLayoutResultFromUpload({
    upload_id: analysis.upload_id ?? analysis.review_id.replace(/^review_/, "upload_"),
    file_name: analysis.source_file.file_name,
    file_type: analysis.source_file.file_type,
    parse_status: analysis.parsed_text ? "success" : "unsupported_or_failed",
    parsed_text: analysis.parsed_text,
    parser: "txt",
    sheets: [],
    warnings: analysis.warnings.map((warning) => warning.message)
  });
}

function fieldCategory(fieldKey: string): S2BasicInfoItem["category"] {
  if (fieldKey.startsWith("supplier_") || fieldKey === "supplier_name") return "supplier_registration";
  if (["winner_name", "winning_amount", "bid_price", "score", "ranking", "candidate_order"].includes(fieldKey)) return "award_result";
  if (["signup_deadline", "bid_opening_time", "seal_status"].includes(fieldKey)) return "notice_key";
  if (["source_file", "package_info"].includes(fieldKey)) return "special_remark";
  return "file_core";
}

function fieldToBasicInfoItem(field: ExtractedField, fallbackMaterialId: string): S2BasicInfoItem {
  const sourceBlock = field.evidence_text ? "blk_0001" : "";
  const value = isMissingValue(field.value) ? "" : field.value;
  const extractStatus: S2BasicInfoItem["extract_status"] =
    field.status === "recognized" && value ? "success" : field.status === "missing" ? "missing" : "exception";

  return {
    category: fieldCategory(field.field_key),
    item_key: field.field_key,
    item_name: field.field_name,
    ai_value: value,
    confirmed_value: field.review_status === "confirmed" ? value : "",
    extract_status: extractStatus,
    confidence: field.confidence,
    source: sourceBlock
      ? {
          material_id: fallbackMaterialId,
          file_name: field.source_file,
          page: 1,
          block_id: sourceBlock,
          excerpt: field.evidence_text.slice(0, 200)
        }
      : null,
    candidate_sources: [],
    validation_result: {
      status: extractStatus === "success" ? "passed" : extractStatus === "missing" ? "warning" : "failed",
      message: extractStatus === "success" ? "" : "需要人工复核或补充"
    },
    review_required: field.review_required || extractStatus !== "success",
    logic_flags: field.review_required ? ["manual_review_required"] : [],
    metadata: {
      legacy_field_key: field.field_key,
      review_status: field.review_status,
      remark: field.remark
    }
  };
}

function placementStatus(status: DirectoryPlacement["placement_status"]): S3DirectoryMatch["match_status"] {
  if (status === "placed") return "matched";
  if (status === "manual_required") return "needs_replacement";
  if (status === "uncertain") return "exception";
  return "missing";
}

function placementToDirectoryMatch(item: DirectoryPlacement, index: number, fallbackMaterialId: string): S3DirectoryMatch {
  const status = placementStatus(item.placement_status);
  return {
    directory_item_id: `dir_${String(index + 1).padStart(3, "0")}`,
    directory_item_name: item.required_material,
    required: item.required,
    match_status: status,
    matched_materials: status === "matched"
      ? [{
          material_id: fallbackMaterialId,
          file_name: item.matched_file_name,
          evidence_block_ids: ["blk_0001"],
          confidence: 0.86,
          hit_rules: [item.skill_basis],
          evidence_summary: item.placement_basis
        }]
      : [],
    review_required: item.review_status !== "confirmed" || status !== "matched",
    remark: item.remark,
    diagnostics: status === "matched" ? [] : [item.placement_basis]
  };
}

function draftSections(draft: DraftOutline) {
  return draft.sections.map((section, index) => ({
    section_id: `sec_${String(index + 1).padStart(3, "0")}`,
    section_title: section.section_title,
    directory_item_ids: [],
    content_refs: section.source_fields.map((field) => ({
      type: "field",
      item_key: field,
      preview: section.content_preview
    })),
    status: section.content_preview.includes("待补充") ? "partial" as const : "ready" as const,
    missing_refs: section.content_preview.includes("待补充") ? section.source_fields : []
  }));
}

function missingBidFields(rows: BidEvaluationRow[]) {
  const keys: Array<keyof Pick<BidEvaluationRow, "supplier_name" | "bid_price" | "qualification_status" | "score" | "ranking">> = [
    "supplier_name",
    "bid_price",
    "qualification_status",
    "score",
    "ranking"
  ];
  return Array.from(new Set(rows.flatMap((row) => keys.filter((key) => isMissingValue(row[key])).map(String))));
}

export function buildPipelineResultFromAnalysis(
  analysis: SkillAnalysisResult,
  layoutResult?: S1LayoutResult,
  source: SkillPipelineResult["source"] = "legacy_adapter"
): SkillPipelineResult {
  const generatedAt = new Date().toISOString();
  const layout = layoutResult ?? buildLayoutResultFromAnalysis(analysis);
  const materialId = layout.material_id;
  const projectId =
    analysis.extracted_fields.find((field) => field.field_key === "project_id" && !isMissingValue(field.value))?.value ||
    analysis.review_id.replace(/^review_/, "proj_");
  const basicItems = analysis.extracted_fields.map((field) => fieldToBasicInfoItem(field, materialId));
  const directoryMatches = analysis.directory_placement.map((item, index) => placementToDirectoryMatch(item, index, materialId));
  const missingItems = directoryMatches.filter((item) => item.match_status === "missing").map((item) => item.directory_item_id);
  const needsReplacement = directoryMatches.filter((item) => item.match_status === "needs_replacement").map((item) => item.directory_item_id);
  const exceptions = directoryMatches.filter((item) => item.match_status === "exception").map((item) => item.directory_item_id);
  const bidMissingFields = missingBidFields(analysis.bid_evaluation_table);

  return {
    schema_version: 2,
    pipeline_run_id: nowId("pipeline"),
    project_id: String(projectId),
    generated_at: generatedAt,
    source,
    s1_layout_results: [layout],
    s2_basic_info: {
      basic_info_sheet: {
        project_id: String(projectId),
        generated_at: generatedAt,
        items: basicItems,
        logic_checks: [],
        review_queue: basicItems
          .filter((item) => item.review_required)
          .map((item) => ({
            item_key: item.item_key,
            item_name: item.item_name,
            extract_status: item.extract_status,
            reason: item.validation_result.message || "需要人工复核"
          })),
        rule_feedback: basicItems
          .filter((item) => item.extract_status !== "success")
          .map((item) => ({
            item_key: item.item_key,
            event: item.extract_status,
            suggested_action: "补充字段别名、来源材料或人工确认值"
          }))
      }
    },
    s3_directory: {
      directory_matches: directoryMatches,
      missing_items: missingItems,
      needs_replacement_items: needsReplacement,
      exceptions,
      constraints_applied: [],
      dependency_checks: [],
      coverage_warnings: missingItems.map((directory_item_id) => ({
        directory_item_id,
        message: "必需目录项未匹配到材料"
      })),
      draft_outline: draftSections(analysis.draft_outline)
    },
    s4_template_injection: {
      output_path: "",
      status: "pending",
      placeholders_filled: basicItems.filter((item) => item.ai_value || item.confirmed_value).length,
      placeholders_missing: basicItems.filter((item) => item.extract_status !== "success").map((item) => item.item_key),
      warnings: ["当前前端已按新版 S4 结构预留模板注入审计；真实模板注入在导出服务中继续接入。"],
      audit: {
        strict_mode_ready: false,
        source: "typescript_adapter"
      }
    },
    s5_bid_tables: analysis.bid_evaluation_table.length
      ? [{
          table_type: "bid_opening_record",
          output_path: "",
          status: bidMissingFields.length ? "partial" : "success",
          supplier_count: analysis.bid_evaluation_table.length,
          missing_fields: bidMissingFields,
          warnings: bidMissingFields.length ? ["部分开评标表字段需要人工补充"] : [],
          rows: analysis.bid_evaluation_table,
          definition_checks: [],
          consistency_checks: [],
          mapping_audit: { source: "legacy_bid_rows_adapter" }
        }]
      : [],
    warnings: analysis.warnings
  };
}
