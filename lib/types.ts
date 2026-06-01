export type ReviewStatus = "pending" | "confirmed" | "needs_change" | "discussion";

export type AnalysisSource = "mock" | "ai";

export type ProjectSummary = {
  project_id: string;
  project_name: string;
  procurement_method: string;
  package_info: string;
};

export type BasicInfoItem = {
  id: string;
  field_category: string;
  field_name: string;
  ai_result: string;
  source_file: string;
  source_excerpt: string;
  recognition_status: string;
  confidence: number;
  review_status: ReviewStatus;
  remark: string;
};

export type DirectoryMatchStatus = "matched" | "missing" | "uncertain";

export type DirectoryMatchItem = {
  id: string;
  directory_item_name: string;
  required: boolean;
  match_status: DirectoryMatchStatus;
  matched_material: string;
  rationale: string;
  confidence: number;
  review_status: ReviewStatus;
  remark: string;
};

export type FilingAnalysisResult = {
  review_id: string;
  project: ProjectSummary;
  basic_info_sheet: {
    items: BasicInfoItem[];
  };
  directory_matches: DirectoryMatchItem[];
  draft_outline: string[];
  warnings: string[];
  source: AnalysisSource;
};

export type SaveReviewPayload = FilingAnalysisResult & {
  saved_at?: string;
};

export type OcrFileType = "pdf" | "image" | "txt";

export type OcrResult = {
  ocr_id: string;
  source_file: {
    file_name: string;
    file_type: OcrFileType;
    page_count: number;
  };
  recognized_text: string;
  detected_material_type: string;
  confidence: number;
  layout_blocks: Array<{
    block_type: string;
    text: string;
    page: number;
  }>;
  layout_result?: S1LayoutResult;
  schema_version?: 2;
  warnings: Array<{
    type: string;
    message: string;
  }>;
  source: "mock_ocr" | "ocr_api" | "ocr_pending" | "fallback_mock";
};

export type ResultSource = "file_parse" | "skill_rule" | "fallback_mock";

export type TaskType = "filing_document" | "bid_evaluation_table" | "mixed" | "unknown";

export type ReviewChoice = "pending" | "confirmed" | "needs_change" | "discussion";

export type BasicTemplateMeta = {
  template_id: string;
  template_name: string;
  template_type: "filing_document" | "bid_evaluation_table";
  output_type: "word" | "excel";
  description?: string;
  source: string;
};

export type ExtractedField = {
  field_key: string;
  field_name: string;
  value: string;
  status: "recognized" | "missing" | "uncertain";
  source_file: string;
  evidence_text: string;
  skill_basis: string;
  confidence: number;
  review_required: boolean;
  review_status: ReviewChoice;
  remark: string;
};

export type DirectoryPlacement = {
  template_position: string;
  required_material: string;
  recognized_material_type: string;
  matched_file_name: string;
  placement_status: "placed" | "missing" | "uncertain" | "manual_required";
  placement_basis: string;
  skill_basis: string;
  template_source: "enterprise_template_rules" | "fallback_rules";
  required: boolean;
  review_status: ReviewChoice;
  remark: string;
};

export type DraftSection = {
  section_title: string;
  source_fields: string[];
  content_preview: string;
};

export type DraftOutline = {
  draft_title: string;
  sections: DraftSection[];
};

export type BidEvaluationRow = {
  row_id: string;
  project_name: string;
  project_id: string;
  bid_opening_time: string;
  procurement_method: string;
  supplier_name: string;
  contact_person: string;
  contact_phone: string;
  submit_time: string;
  seal_check_result: string;
  fail_reason: string;
  supplier_signature: string;
  bid_price: string;
  qualification_status: string;
  compliance_result: string;
  responsiveness_result: string;
  score: string;
  ranking: string;
  candidate_order: string;
  source_file: string;
  evidence_text: string;
  skill_basis: string;
  template_source: "enterprise_template_rules" | "fallback_rules";
  review_required: boolean;
  review_status: ReviewChoice;
  remark: string;
};

export type BidAnalysis = {
  template_id: string;
  template_name: string;
  project_fields: Record<string, string>;
  supplier_rows: BidEvaluationRow[];
  table_modules: Array<{
    module_id: string;
    module_name: string;
    columns: string[];
  }>;
};

export type SkillAnalysisResult = {
  review_id: string;
  upload_id?: string;
  source: ResultSource;
  source_file: {
    file_name: string;
    file_type: string;
    file_size: number;
  };
  parsed_text: string;
  material_type: string;
  task_type: TaskType;
  task_basis: string;
  matched_template_type?: string;
  matched_basic_templates?: BasicTemplateMeta[];
  rule_source?: string;
  template_source: "enterprise_template_rules" | "fallback_rules";
  extracted_fields: ExtractedField[];
  directory_placement: DirectoryPlacement[];
  bid_evaluation_table: BidEvaluationRow[];
  bid_analysis?: BidAnalysis;
  draft_outline: DraftOutline;
  pipeline_result?: SkillPipelineResult;
  warnings: Array<{
    type: string;
    message: string;
  }>;
  skill_basis: string[];
  review_required: boolean;
};

export type UploadRecord = {
  upload_id: string;
  file_name: string;
  file_type: string;
  file_size: number;
  parsed_text: string;
  parse_status: "success" | "partial" | "unsupported_or_failed";
  parser: "txt" | "mammoth" | "xlsx" | "pdf-parse" | "word-extractor" | "ocr-pending" | "unsupported";
  sheets: Array<{
    sheet_name: string;
    rows: string[][];
  }>;
  layout_result?: S1LayoutResult;
  schema_version?: 2;
  warnings: string[];
  created_at: string;
};

export type ReviewRecord = {
  review_id: string;
  upload_id: string;
  file_name: string;
  file_type: string;
  task_type: TaskType;
  template_id?: string;
  template_name?: string;
  template_type?: string;
  output_type?: string;
  matched_basic_templates?: BasicTemplateMeta[];
  template_source: "enterprise_template_rules" | "fallback_rules";
  project: Record<string, unknown>;
  extracted_fields: ExtractedField[];
  directory_placement: DirectoryPlacement[];
  bid_evaluation_table: BidEvaluationRow[];
  draft_outline: DraftOutline[];
  pipeline_result?: SkillPipelineResult;
  review_status: "pending" | "reviewed";
  reviewer_edits: Array<Record<string, unknown>>;
  saved_at: string;
};

export type S1LayoutBlock = {
  block_id: string;
  block_type: "title" | "subtitle" | "paragraph" | "table" | "header" | "footer" | "image_caption" | "list_item" | "form_field";
  semantic_tag: string;
  text: string;
  page: number;
  bbox?: number[];
  confidence: number;
  table_data?: string[][] | null;
  metadata?: Record<string, unknown>;
};

export type S1LayoutWarning = {
  code: string;
  message: string;
  page?: number;
  block_id?: string;
};

export type S1LayoutResult = {
  material_id: string;
  file_name: string;
  file_type: string;
  parse_status: "success" | "partial" | "failed";
  page_count: number;
  engine: string;
  blocks: S1LayoutBlock[];
  warnings: S1LayoutWarning[];
  quality_report: Record<string, unknown>;
};

export type S2BasicInfoItem = {
  category: "file_core" | "notice_key" | "supplier_registration" | "award_result" | "special_remark";
  item_key: string;
  item_name: string;
  ai_value: string | number | null;
  confirmed_value: string | number | null;
  extract_status: "success" | "missing" | "exception";
  confidence: number;
  source: null | {
    material_id: string;
    file_name: string;
    page?: number;
    block_id: string;
    excerpt: string;
  };
  candidate_sources?: Array<{
    material_id: string;
    file_name: string;
    page?: number;
    block_id: string;
    excerpt: string;
  }>;
  validation_result: {
    status: "passed" | "warning" | "failed" | "skipped";
    message?: string;
  };
  review_required: boolean;
  logic_flags?: string[];
  metadata?: Record<string, unknown>;
};

export type S2BasicInfoSheet = {
  project_id: string;
  generated_at: string;
  items: S2BasicInfoItem[];
  logic_checks: Array<Record<string, unknown>>;
  review_queue: Array<Record<string, unknown>>;
  rule_feedback: Array<Record<string, unknown>>;
};

export type S3DirectoryMatch = {
  directory_item_id: string;
  directory_item_name: string;
  required: boolean;
  match_status: "matched" | "missing" | "needs_replacement" | "exception";
  matched_materials: Array<{
    material_id: string;
    file_name?: string;
    evidence_block_ids?: string[];
    confidence?: number;
    hit_rules?: string[];
    evidence_summary?: string;
  }>;
  review_required: boolean;
  remark: string;
  diagnostics?: string[];
};

export type S3DraftOutlineSection = {
  section_id: string;
  section_title: string;
  directory_item_ids: string[];
  content_refs: Array<Record<string, unknown>>;
  status: "ready" | "partial" | "blocked";
  missing_refs?: string[];
};

export type S3DirectoryMatchResult = {
  directory_matches: S3DirectoryMatch[];
  missing_items: string[];
  needs_replacement_items: string[];
  exceptions: string[];
  constraints_applied: string[];
  dependency_checks: Array<Record<string, unknown>>;
  coverage_warnings: Array<Record<string, unknown>>;
  draft_outline: S3DraftOutlineSection[];
};

export type S4TemplateInjectionResult = {
  output_path: string;
  status: "success" | "partial" | "failed" | "pending";
  placeholders_filled: number;
  placeholders_missing: string[];
  warnings: string[];
  audit?: Record<string, unknown>;
};

export type S5BidTableGenerationResult = {
  table_type: "qualification_review" | "compliance_review" | "score_summary" | "attendance" | "bid_opening_record";
  output_path: string;
  status: "success" | "partial" | "failed" | "pending";
  supplier_count: number;
  missing_fields: string[];
  warnings: string[];
  rows?: BidEvaluationRow[];
  definition_checks?: Array<Record<string, unknown>>;
  consistency_checks?: Array<Record<string, unknown>>;
  mapping_audit?: Record<string, unknown>;
};

export type SkillPipelineResult = {
  schema_version: 2;
  pipeline_run_id: string;
  project_id: string;
  generated_at: string;
  source: "file_parse" | "ocr_pending" | "ocr_api" | "legacy_adapter";
  s1_layout_results: S1LayoutResult[];
  s2_basic_info: {
    basic_info_sheet: S2BasicInfoSheet;
  };
  s3_directory: S3DirectoryMatchResult;
  s4_template_injection?: S4TemplateInjectionResult;
  s5_bid_tables: S5BidTableGenerationResult[];
  warnings: Array<{ type: string; message: string }>;
};
