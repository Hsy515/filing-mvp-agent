"use client";

import { useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type {
  BidEvaluationRow,
  DirectoryPlacement,
  ExtractedField,
  OcrFileType,
  OcrResult,
  ReviewChoice,
  S1LayoutResult,
  SkillAnalysisResult,
  TaskType
} from "@/lib/types";

type ParsedSheetState = {
  sheet_name: string;
  rows: string[][];
};

type UploadState = {
  upload_id?: string;
  file_name: string;
  file_type: string;
  file_size: number;
  parse_status: "idle" | "success" | "partial" | "unsupported_or_failed" | "failed";
  parsed_text: string;
  parser?: string;
  sheets: ParsedSheetState[];
  warnings: string[];
  created_at?: string;
  layout_result?: S1LayoutResult;
};

type MaterialSourceState = {
  sourceType: "upload" | "ocr";
  upload_id?: string;
  ocr_id?: string;
  file_name: string;
  file_type: string;
  file_size: number;
  parsed_text: string;
  parser?: string;
  warnings: string[];
  status: "idle" | "parsed" | "ocr_pending" | "failed";
  layout_result?: S1LayoutResult;
};

type WorkspaceStage = "idle" | "parsed" | "ocr_pending" | "analyzed" | "saved" | "exportable" | "failed";

type ProjectState = {
  project_name: string;
  project_id: string;
  procurement_method: string;
  project_type: string;
  status: string;
  created_at: string;
};

type ParseFileResponse = {
  success: boolean;
  upload?: Omit<UploadState, "parse_status"> & { parse_status: UploadState["parse_status"] };
  error?: string;
  message?: string;
  warnings?: string[];
  path?: string;
};

type ReviewSummaryItem = {
  item_type: string;
  content: string;
  current_status: string;
  suggestion: string;
  review_status: ReviewChoice;
  remark: string;
};

type SavedReviewPayload = {
  review_id?: string;
  upload_id?: string;
  file_name: string;
  file_type: string;
  task_type: TaskType;
  matched_basic_templates: NonNullable<SkillAnalysisResult["matched_basic_templates"]>;
  project: ProjectState;
  edited_extracted_fields: ExtractedField[];
  edited_directory_placement: DirectoryPlacement[];
  edited_draft_outline: SkillAnalysisResult["draft_outline"];
  edited_bid_evaluation_table: BidEvaluationRow[];
  pipeline_result?: SkillAnalysisResult["pipeline_result"];
  review_summary: ReviewSummaryItem[];
  review_status: "saved";
};

const EMPTY_UPLOAD: UploadState = {
  file_name: "",
  file_type: "",
  file_size: 0,
  parse_status: "idle",
  parsed_text: "",
  sheets: [],
  warnings: []
};

const PROJECT_FIELD_KEYS = new Set([
  "project_name",
  "project_id",
  "material_type",
  "procurement_method",
  "purchaser",
  "agency",
  "budget",
  "ceiling_price",
  "supplier_name",
  "bid_opening_time",
  "package_info",
  "seal_status"
]);

const TASK_OPTIONS: Array<{ value: TaskType; label: string }> = [
  { value: "filing_document", label: "备案文件生成" },
  { value: "bid_evaluation_table", label: "开评标表格生成" },
  { value: "mixed", label: "同时生成" },
  { value: "unknown", label: "暂不确定" }
];

const REVIEW_OPTIONS: Array<{ value: ReviewChoice; label: string }> = [
  { value: "pending", label: "待复核" },
  { value: "confirmed", label: "已确认" },
  { value: "needs_change", label: "需修改" },
  { value: "discussion", label: "待讨论" }
];

const BID_FORM_MODULES = [
  "响应文件递交记录表",
  "响应文件密封性检查表",
  "资格性审查表",
  "符合性 / 响应性审查表",
  "评分汇总表",
  "中标候选人推荐表"
];

function formatBytes(size: number) {
  if (!size) return "-";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function displayValue(value?: string) {
  return value && value !== "missing" ? value : "未识别，需人工补充";
}

function taskTypeLabel(value?: TaskType) {
  return TASK_OPTIONS.find((option) => option.value === value)?.label ?? "暂不确定";
}

function reviewLabel(value: ReviewChoice) {
  return REVIEW_OPTIONS.find((option) => option.value === value)?.label ?? "待复核";
}

function fieldStatusLabel(status: ExtractedField["status"]) {
  const labels = {
    recognized: "已识别",
    missing: "未识别",
    uncertain: "需复核"
  };
  return labels[status];
}

function placementStatusLabel(status: DirectoryPlacement["placement_status"]) {
  const labels = {
    placed: "已归位",
    missing: "缺失",
    uncertain: "归位不确定",
    manual_required: "需人工判断"
  };
  return labels[status];
}

function parseStatusLabel(status: UploadState["parse_status"]) {
  const labels = {
    idle: "待上传",
    success: "解析成功",
    partial: "部分解析",
    unsupported_or_failed: "暂不支持或解析失败",
    failed: "解析失败"
  };
  return labels[status];
}

function parserLabel(parser?: string) {
  const labels: Record<string, string> = {
    txt: "文本解析",
    mammoth: "Word 正文解析",
    xlsx: "Excel 工作表解析",
    "pdf-parse": "PDF 可复制文字解析",
    "word-extractor": "旧版 Word 尝试解析",
    "ocr-pending": "OCR 待接入",
    unsupported: "暂不支持"
  };
  return parser ? labels[parser] ?? parser : "-";
}

function sourceLabel(source?: string) {
  const labels: Record<string, string> = {
    file_parse: "文件解析文本",
    skill_rule: "Skill 规则分析",
    fallback_mock: "失败兜底",
    mock_ocr: "OCR 兜底样例",
    ocr_api: "真实 OCR 服务",
    ocr_pending: "待接入真实 OCR",
    fallback_mock_ocr: "OCR 兜底样例"
  };
  return source ? labels[source] ?? source : "待处理";
}

function fieldValue(fields: ExtractedField[] | undefined, key: string) {
  const value = fields?.find((field) => field.field_key === key)?.value;
  return value && value !== "missing" ? value : "";
}

function reviewStatusForSave(analysis: SkillAnalysisResult | null) {
  if (!analysis) return "pending";
  const statuses = [
    ...analysis.extracted_fields.map((item) => item.review_status),
    ...analysis.directory_placement.map((item) => item.review_status),
    ...analysis.bid_evaluation_table.map((item) => item.review_status)
  ];
  return statuses.length > 0 && statuses.every((status) => status === "confirmed") ? "reviewed" : "pending";
}

function getOcrFileType(file: File): OcrFileType {
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext === "pdf") return "pdf";
  if (ext === "txt") return "txt";
  return "image";
}

function missingBidValue(value: unknown) {
  return !value || value === "missing" || String(value).includes("未识别");
}

export default function Home() {
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const ocrInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [upload, setUpload] = useState<UploadState>(EMPTY_UPLOAD);
  const [materialSource, setMaterialSource] = useState<MaterialSourceState | null>(null);
  const [analysis, setAnalysis] = useState<SkillAnalysisResult | null>(null);
  const [ocrResult, setOcrResult] = useState<OcrResult | null>(null);
  const [selectedTaskType, setSelectedTaskType] = useState<TaskType>("unknown");
  const [project, setProject] = useState<ProjectState>({
    project_name: "",
    project_id: "",
    procurement_method: "",
    project_type: "采购项目备案",
    status: "新建",
    created_at: new Date().toLocaleString("zh-CN")
  });
  const [message, setMessage] = useState("");
  const [isParsing, setIsParsing] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState<"word" | "excel" | "filingChecklist" | null>(null);
  const [saveInfo, setSaveInfo] = useState<{ review_id: string; saved_at: string; path: string } | null>(null);
  const [savedReview, setSavedReview] = useState<SavedReviewPayload | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  const activeTaskType = analysis?.task_type ?? selectedTaskType;
  const showFiling = activeTaskType === "filing_document" || activeTaskType === "mixed";
  const showBid = activeTaskType === "bid_evaluation_table" || activeTaskType === "mixed";
  const shouldShowWordExport = activeTaskType === "filing_document" || activeTaskType === "mixed";
  const shouldShowExcelExport = activeTaskType === "bid_evaluation_table" || activeTaskType === "mixed";
  const shouldShowChecklistExport = activeTaskType === "filing_document" || activeTaskType === "mixed";
  const canExportSaved = Boolean(saveInfo && savedReview && !hasUnsavedChanges);
  const reviewSummary = useMemo(
    () => buildReviewSummary(analysis, ocrResult, hasUnsavedChanges),
    [analysis, ocrResult, hasUnsavedChanges]
  );
  const projectFields = useMemo(
    () => (analysis?.extracted_fields ?? []).filter((field) => PROJECT_FIELD_KEYS.has(field.field_key)),
    [analysis]
  );
  const workspaceStage: WorkspaceStage = saveInfo && !hasUnsavedChanges
    ? "exportable"
    : analysis
      ? hasUnsavedChanges
        ? "analyzed"
        : "saved"
      : materialSource?.status === "ocr_pending"
        ? "ocr_pending"
        : materialSource?.parsed_text
          ? "parsed"
          : materialSource?.status === "failed"
            ? "failed"
            : "idle";

  const exportStatus = !analysis
    ? "不可导出：请先完成识别"
    : !saveInfo
      ? "不可导出：请先保存复核结果"
      : hasUnsavedChanges
        ? "不可导出：存在未保存修改"
        : shouldShowWordExport && shouldShowExcelExport
          ? "可导出 Word、Excel 和归档清单"
          : shouldShowWordExport
            ? "可导出 Word 和归档清单"
            : shouldShowExcelExport
              ? "可导出 Excel"
              : "当前任务类型暂无导出项";

  async function parseSelectedFile(file = selectedFile) {
    if (!file) {
      setMessage("请先选择需要上传的材料文件。");
      return;
    }

    setIsParsing(true);
    setMessage("");
    setAnalysis(null);
    setOcrResult(null);
    setSaveInfo(null);
    setSavedReview(null);
    setHasUnsavedChanges(false);

    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/filing/parse-file", {
        method: "POST",
        body: formData
      });
      const responseText = await response.text();
      let data: ParseFileResponse;
      try {
        data = JSON.parse(responseText) as ParseFileResponse;
      } catch {
        throw new Error(
          response.ok
            ? "文件解析接口返回了非 JSON 内容，请查看后端报错。"
            : `文件解析接口异常：${response.status} ${response.statusText || ""}`
        );
      }

      if (!data.upload) {
        throw new Error(data.error ?? data.message ?? "文件解析接口未返回上传记录。");
      }

      const nextUpload: UploadState = {
        upload_id: data.upload.upload_id,
        file_name: data.upload.file_name,
        file_type: data.upload.file_type,
        file_size: data.upload.file_size,
        parse_status: data.upload.parse_status,
        parsed_text: data.upload.parsed_text,
        parser: data.upload.parser,
        sheets: data.upload.sheets ?? [],
        warnings: data.upload.warnings ?? data.warnings ?? [],
        created_at: data.upload.created_at,
        layout_result: data.upload.layout_result
      };
      setUpload(nextUpload);

      setMaterialSource({
        sourceType: "upload",
        upload_id: nextUpload.upload_id,
        file_name: nextUpload.file_name,
        file_type: nextUpload.file_type,
        file_size: nextUpload.file_size,
        parsed_text: nextUpload.parsed_text,
        parser: nextUpload.parser,
        warnings: nextUpload.warnings,
        status: nextUpload.parse_status === "success" || nextUpload.parse_status === "partial" ? "parsed" : "failed",
        layout_result: nextUpload.layout_result
      });

      if (!response.ok || data.upload.parse_status === "unsupported_or_failed") {
        setMessage(data.error ?? data.message ?? nextUpload.warnings[0] ?? "当前文件类型暂不支持或解析失败。");
      } else if (!nextUpload.parsed_text.trim()) {
        setMessage("未解析到可分析文本。若是扫描件、图片型 PDF，请使用扫描文件识别入口。");
      } else {
        setMessage("材料解析完成，已保存上传记录，可继续开始识别。");
      }
    } catch (error) {
      setUpload((current) => ({
        ...current,
        file_name: file.name,
        file_type: file.name.split(".").pop()?.toLowerCase() ?? file.type,
        file_size: file.size,
        parse_status: "failed",
        warnings: [error instanceof Error ? error.message : "文件解析失败。"]
      }));
      setMaterialSource({
        sourceType: "upload",
        file_name: file.name,
        file_type: file.name.split(".").pop()?.toLowerCase() ?? file.type,
        file_size: file.size,
        parsed_text: "",
        warnings: [error instanceof Error ? error.message : "文件解析失败。"],
        status: "failed"
      });
      setMessage(error instanceof Error ? error.message : "文件解析失败。");
    } finally {
      setIsParsing(false);
    }
  }

  async function requestOcr(file: File | undefined) {
    if (!file) return;

    setIsParsing(true);
    setMessage("");
    setAnalysis(null);
    setSaveInfo(null);
    setSavedReview(null);
    setHasUnsavedChanges(false);
    setSelectedFile(file);

    const fileType = getOcrFileType(file);
    try {
      const response = await fetch("/api/filing/ocr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_name: file.name, file_type: fileType })
      });
      const data = (await response.json()) as OcrResult;
      setOcrResult(data);

      const recognizedText = data.recognized_text?.trim() ?? "";
      setMaterialSource({
        sourceType: "ocr",
        ocr_id: data.ocr_id,
        file_name: data.source_file.file_name,
        file_type: data.source_file.file_type,
        file_size: file.size,
        parsed_text: recognizedText,
        parser: data.source,
        warnings: data.warnings.map((warning) => warning.message),
        status: recognizedText ? "parsed" : "ocr_pending",
        layout_result: data.layout_result
      });

      setUpload({
        upload_id: data.ocr_id,
        file_name: data.source_file.file_name,
        file_type: data.source_file.file_type,
        file_size: file.size,
        parse_status: recognizedText ? "success" : "partial",
        parsed_text: recognizedText,
        parser: recognizedText ? "ocr-pending" : "ocr-pending",
        sheets: [],
        warnings: data.warnings.map((warning) => warning.message),
        created_at: new Date().toISOString(),
        layout_result: data.layout_result
      });

      if (recognizedText) {
        setMessage("OCR 已返回识别文本，可继续进入同一套 AI/Skill 识别流程。");
      } else {
        setMessage("OCR 入口已记录：当前接口仍为待接入状态，不会伪造扫描件识别文本。");
      }
    } catch (error) {
      setOcrResult(null);
      setMaterialSource({
        sourceType: "ocr",
        file_name: file.name,
        file_type: fileType,
        file_size: file.size,
        parsed_text: "",
        warnings: [error instanceof Error ? error.message : "OCR 调用失败。"],
        status: "failed"
      });
      setMessage(error instanceof Error ? error.message : "OCR 调用失败。");
    } finally {
      setIsParsing(false);
    }
  }

  async function analyzeMaterial() {
    const source = materialSource;
    if (!source?.parsed_text.trim()) {
      setMessage(source?.status === "ocr_pending" ? "当前 OCR 尚未返回可分析文本，请等待真实 OCR 接入或改用电子文件上传。" : "当前没有可识别文本，请先上传并解析文件。");
      return;
    }

    setIsAnalyzing(true);
    setMessage("正在识别材料内容，请稍候。");

    try {
      const response = await fetch("/api/filing/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          upload_id: source.upload_id ?? source.ocr_id,
          file_name: source.file_name,
          file_type: source.file_type,
          file_size: source.file_size,
          material_text: source.parsed_text,
          parser: source.parser,
          source: source.sourceType === "ocr" ? "ocr_api" : "file_parse",
          layout_result: source.layout_result
        })
      });
      const data = (await response.json()) as SkillAnalysisResult;
      setAnalysis(data);
      setSelectedTaskType(data.task_type ?? "unknown");
      setSaveInfo(null);
      setSavedReview(null);
      setHasUnsavedChanges(false);
      setProject((current) => ({
        ...current,
        project_name: fieldValue(data.extracted_fields, "project_name") || current.project_name,
        project_id: fieldValue(data.extracted_fields, "project_id") || current.project_id,
        procurement_method: fieldValue(data.extracted_fields, "procurement_method") || current.procurement_method,
        project_type: taskTypeLabel(data.task_type),
        status: "已识别"
      }));
      setMessage(data.extracted_fields?.length ? "识别完成，结果已进入人工复核。" : "识别接口已返回，但未生成有效字段，请检查 Skill 规则或输入文本。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "分析失败，请检查解析文本后重试。");
    } finally {
      setIsAnalyzing(false);
    }
  }

  function clearCurrentMaterial() {
    setSelectedFile(null);
    setUpload(EMPTY_UPLOAD);
    setMaterialSource(null);
    setAnalysis(null);
    setOcrResult(null);
    setSaveInfo(null);
    setSavedReview(null);
    setHasUnsavedChanges(false);
    setMessage("已清空当前材料。");
  }

  function updateTaskType(value: TaskType) {
    setSelectedTaskType(value);
    setProject((current) => ({ ...current, project_type: taskTypeLabel(value) }));
    setAnalysis((current) => (current ? { ...current, task_type: value } : current));
    setHasUnsavedChanges(Boolean(analysis));
  }

  function updateProject(key: keyof ProjectState, value: string) {
    setProject((current) => ({ ...current, [key]: value }));
    if (analysis) setHasUnsavedChanges(true);
  }

  function updateField(id: string, patch: Partial<ExtractedField>) {
    setAnalysis((current) =>
      current
        ? {
            ...current,
            extracted_fields: current.extracted_fields.map((item) =>
              item.field_key === id ? { ...item, ...patch } : item
            )
          }
        : current
    );
    setHasUnsavedChanges(true);
  }

  function updatePlacement(index: number, patch: Partial<DirectoryPlacement>) {
    setAnalysis((current) =>
      current
        ? {
            ...current,
            directory_placement: current.directory_placement.map((item, itemIndex) =>
              itemIndex === index ? { ...item, ...patch } : item
            )
          }
        : current
    );
    setHasUnsavedChanges(true);
  }

  function updateBidRow(rowId: string, patch: Partial<BidEvaluationRow>) {
    setAnalysis((current) =>
      current
        ? {
            ...current,
            bid_evaluation_table: current.bid_evaluation_table.map((item) =>
              item.row_id === rowId ? { ...item, ...patch } : item
            )
          }
        : current
    );
    setHasUnsavedChanges(true);
  }

  function addBidRow() {
    if (!analysis) return;
    const projectName = fieldValue(analysis.extracted_fields, "project_name") || project.project_name || "未识别，需人工补充";
    const projectId = fieldValue(analysis.extracted_fields, "project_id") || project.project_id || "未识别，需人工补充";
    const procurementMethod = fieldValue(analysis.extracted_fields, "procurement_method") || project.procurement_method || "未识别，需人工补充";
    const bidOpeningTime = fieldValue(analysis.extracted_fields, "bid_opening_time") || "未识别，需人工补充";
    const sourceFile = materialSource?.file_name ?? upload.file_name;
    setAnalysis((current) =>
      current
        ? {
            ...current,
            bid_evaluation_table: [
              ...current.bid_evaluation_table,
              {
                row_id: `bid_manual_${Date.now()}`,
                project_name: projectName,
                project_id: projectId,
                bid_opening_time: bidOpeningTime,
                procurement_method: procurementMethod,
                supplier_name: "未识别，需人工补充",
                contact_person: "未识别，需人工补充",
                contact_phone: "未识别，需人工补充",
                submit_time: "未识别，需人工补充",
                seal_check_result: "未识别，需人工补充",
                fail_reason: "未识别，需人工补充",
                supplier_signature: "未识别，需人工补充",
                bid_price: "未识别，需人工补充",
                qualification_status: "未识别，需人工补充",
                compliance_result: "未识别，需人工补充",
                responsiveness_result: "未识别，需人工补充",
                score: "未识别，需人工补充",
                ranking: "未识别，需人工补充",
                candidate_order: "未识别，需人工补充",
                source_file: sourceFile,
                evidence_text: "人工新增行",
                skill_basis: "人工补充",
                template_source: current.template_source,
                review_required: true,
                review_status: "pending",
                remark: ""
              }
            ]
          }
        : current
    );
    setHasUnsavedChanges(true);
  }

  function deleteBidRow(rowId: string) {
    setAnalysis((current) =>
      current
        ? {
            ...current,
            bid_evaluation_table: current.bid_evaluation_table.filter((row) => row.row_id !== rowId)
          }
        : current
    );
    setHasUnsavedChanges(true);
  }

  function updateDraftSection(index: number, content_preview: string) {
    setAnalysis((current) =>
      current
        ? {
            ...current,
            draft_outline: {
              ...current.draft_outline,
              sections: current.draft_outline.sections.map((section, sectionIndex) =>
                sectionIndex === index ? { ...section, content_preview } : section
              )
            }
          }
        : current
    );
    setHasUnsavedChanges(true);
  }

  function buildSavedReviewPayload(currentAnalysis: SkillAnalysisResult): SavedReviewPayload {
    return {
      review_id: currentAnalysis.review_id,
      upload_id: currentAnalysis.upload_id ?? materialSource?.upload_id ?? materialSource?.ocr_id ?? upload.upload_id,
      file_name: currentAnalysis.source_file.file_name,
      file_type: currentAnalysis.source_file.file_type,
      task_type: currentAnalysis.task_type,
      matched_basic_templates: currentAnalysis.matched_basic_templates ?? [],
      project,
      edited_extracted_fields: currentAnalysis.extracted_fields,
      edited_directory_placement: currentAnalysis.directory_placement,
      edited_draft_outline: currentAnalysis.draft_outline,
      edited_bid_evaluation_table: currentAnalysis.bid_evaluation_table,
      pipeline_result: currentAnalysis.pipeline_result,
      review_summary: buildReviewSummary(currentAnalysis, ocrResult, hasUnsavedChanges),
      review_status: "saved"
    };
  }

  async function saveReview() {
    if (!analysis) {
      setMessage("请先完成识别，再保存复核结果。");
      return;
    }

    setIsSaving(true);
    setMessage("");
    try {
      const payload = buildSavedReviewPayload(analysis);
      const response = await fetch("/api/filing/save-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          review_status: reviewStatusForSave(analysis)
        })
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error ?? "保存复核结果失败。");
      setSaveInfo({
        review_id: data.review_id,
        saved_at: data.saved_at,
        path: data.path
      });
      setSavedReview(data.saved_review ?? payload);
      setHasUnsavedChanges(false);
      setMessage(`复核结果已保存：${data.review_id}。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存复核结果失败。");
    } finally {
      setIsSaving(false);
    }
  }

  function exportPayload() {
    if (!savedReview) return null;
    return {
      ...savedReview,
      review_id: saveInfo?.review_id ?? savedReview.review_id,
      saved_at: saveInfo?.saved_at,
      source_file: {
        file_name: savedReview.file_name,
        file_type: savedReview.file_type,
        file_size: materialSource?.file_size ?? upload.file_size
      },
      extracted_fields: savedReview.edited_extracted_fields,
      directory_placement: savedReview.edited_directory_placement,
      draft_outline: savedReview.edited_draft_outline,
      bid_evaluation_table: savedReview.edited_bid_evaluation_table
    };
  }

  async function downloadFromResponse(response: Response, fallbackFilename: string) {
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const disposition = response.headers.get("Content-Disposition");
    const encoded = disposition?.match(/filename\*=UTF-8''([^;]+)/)?.[1];
    const fallback = disposition?.match(/filename="?([^"]+)"?/)?.[1];
    const filename = encoded ? decodeURIComponent(encoded) : fallback ?? fallbackFilename;
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function exportWord() {
    const payload = exportPayload();
    if (!payload) {
      setMessage("请先保存复核结果，再导出 Word。");
      return;
    }

    setIsExporting("word");
    setMessage("");
    try {
      const response = await fetch("/api/filing/export-word", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!response.ok) throw new Error((await response.json()).error ?? "导出 Word 失败。");
      await downloadFromResponse(response, "备案文件初稿.docx");
      setMessage("Word 已生成并开始下载。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "导出 Word 失败。");
    } finally {
      setIsExporting(null);
    }
  }

  async function exportExcel() {
    const payload = exportPayload();
    if (!payload) {
      setMessage("请先保存复核结果，再导出 Excel。");
      return;
    }

    setIsExporting("excel");
    setMessage("");
    try {
      const response = await fetch("/api/filing/export-excel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!response.ok) throw new Error((await response.json()).error ?? "导出 Excel 失败。");
      await downloadFromResponse(response, "开评标表格.xlsx");
      setMessage("Excel 已生成并开始下载。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "导出 Excel 失败。");
    } finally {
      setIsExporting(null);
    }
  }

  async function exportFilingChecklist() {
    const payload = exportPayload();
    if (!payload) {
      setMessage("请先保存复核结果，再导出归档清单。");
      return;
    }

    setIsExporting("filingChecklist");
    setMessage("");
    try {
      const response = await fetch("/api/filing/export-filing-checklist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!response.ok) throw new Error((await response.json()).error ?? "导出归档清单失败。");
      await downloadFromResponse(response, "备案归档清单.xlsx");
      setMessage("归档清单已生成并开始下载。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "导出归档清单失败。");
    } finally {
      setIsExporting(null);
    }
  }

  return (
    <main className="workspace">
      <header className="topBar">
        <div className="brandBlock">
          <p className="eyebrow">备案文件生成工具</p>
          <h1>备案生成平台</h1>
        </div>
        <div className="pageMeta">
          <StatusPill status={workspaceStage}>{stageLabel(workspaceStage)}</StatusPill>
          <StatusPill status={materialSource?.sourceType ?? "idle"}>
            {materialSource?.sourceType === "ocr" ? "扫描识别来源" : materialSource?.sourceType === "upload" ? "上传文件来源" : "待选择材料"}
          </StatusPill>
        </div>
      </header>

      <section className="panel flat">
        <div className="sectionHeader">
          <div>
            <h2>项目概览</h2>
            <p className="helperText">客户进入后直接处理材料，数据库项目列表和历史恢复入口已预留，当前先使用页面内项目状态。</p>
          </div>
          <div className="buttonRow">
            <button disabled>项目列表（数据库待接入）</button>
            <button disabled>处理记录（数据库待接入）</button>
          </div>
        </div>
        <div className="projectGrid">
          <TextInput label="项目名称" value={project.project_name} onChange={(value) => updateProject("project_name", value)} />
          <TextInput label="项目编号" value={project.project_id} onChange={(value) => updateProject("project_id", value)} />
          <TextInput label="采购方式" value={project.procurement_method} onChange={(value) => updateProject("procurement_method", value)} />
          <label>
            <span>生成任务</span>
            <select value={activeTaskType} onChange={(event) => updateTaskType(event.target.value as TaskType)}>
              {TASK_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
        </div>
      </section>

      <section className="panel">
        <div className="sectionHeader">
          <div>
            <h2>材料上传与解析</h2>
            <p className="helperText">电子文件上传和扫描文件识别是两个同级入口。OCR 成功返回文本后，会复用同一套识别、复核和导出流程。</p>
          </div>
          <StatusPill status={upload.parse_status}>{parseStatusLabel(upload.parse_status)}</StatusPill>
        </div>

        <div className="entryGrid">
          <article className={`entryCard ${materialSource?.sourceType === "upload" ? "active" : ""}`}>
            <div className="iconBox" aria-hidden="true">U</div>
            <div className="entryContent">
              <div className="entryTitle">
                <h3>上传文件</h3>
                <span className="pill strong">电子文件</span>
              </div>
              <p className="helperText">支持 txt、docx、doc、xls、xlsx、pdf 的可编辑文本解析。</p>
              <div className="buttonRow">
                <button className="primaryButton" onClick={() => uploadInputRef.current?.click()} disabled={isParsing}>
                  选择文件
                </button>
                <button onClick={() => parseSelectedFile()} disabled={!selectedFile || isParsing}>
                  {isParsing && materialSource?.sourceType !== "ocr" ? "解析中..." : "解析文件"}
                </button>
              </div>
              <input
                ref={uploadInputRef}
                type="file"
                accept=".txt,.doc,.docx,.xls,.xlsx,.pdf"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  setSelectedFile(file);
                  if (file) {
                    setMaterialSource({
                      sourceType: "upload",
                      file_name: file.name,
                      file_type: file.name.split(".").pop()?.toLowerCase() ?? file.type,
                      file_size: file.size,
                      parsed_text: "",
                      warnings: [],
                      status: "idle"
                    });
                    setMessage(`已选择文件：${file.name}，请点击解析文件。`);
                  }
                }}
              />
            </div>
          </article>

          <article className={`entryCard ${materialSource?.sourceType === "ocr" ? "active" : ""}`}>
            <div className="iconBox scanIcon" aria-hidden="true">O</div>
            <div className="entryContent">
              <div className="entryTitle">
                <h3>扫描文件识别</h3>
                <StatusPill status={ocrResult?.source ?? "ocr_pending"}>
                  {ocrResult ? sourceLabel(ocrResult.source) : "OCR 待接入"}
                </StatusPill>
              </div>
              <p className="helperText">用于扫描件、图片、图片型 PDF。当前接口返回真实文本时，会直接进入同一分析流程。</p>
              <div className="buttonRow">
                <button className="primaryButton" onClick={() => ocrInputRef.current?.click()} disabled={isParsing}>
                  扫描识别
                </button>
                <button disabled>OCR 队列（数据库待接入）</button>
              </div>
              <input
                ref={ocrInputRef}
                type="file"
                accept=".pdf,image/*,.txt"
                hidden
                onChange={(event) => requestOcr(event.target.files?.[0])}
              />
            </div>
          </article>
        </div>

        <div className="operationRail">
          <div className="selectedFile">
            <span>当前材料</span>
            <strong>{materialSource?.file_name || "尚未选择材料"}</strong>
          </div>
          <div className="selectedFile">
            <span>来源 / 解析器</span>
            <strong>{materialSource ? `${materialSource.sourceType === "ocr" ? "扫描识别" : "文件上传"} / ${parserLabel(materialSource.parser)}` : "-"}</strong>
          </div>
          <button className="primaryButton" onClick={analyzeMaterial} disabled={!materialSource?.parsed_text || isAnalyzing}>
            {isAnalyzing ? "识别中..." : "开始识别"}
          </button>
        </div>

        {message ? <p className="message">{message}</p> : null}
        {materialSource?.warnings.length ? <WarningList warnings={materialSource.warnings} /> : null}
        {upload.sheets.length ? <SheetPreview sheets={upload.sheets} /> : null}
      </section>

      <section className="panel">
        <div className="sectionHeader">
          <div>
            <h2>AI / Skill 识别结果</h2>
            <p className="helperText">结果区展示字段、目录、开评标表格和来源证据。没有识别结果时保持空状态。</p>
          </div>
          <StatusPill status={analysis ? "success" : "idle"}>{analysis ? "已识别" : "待识别"}</StatusPill>
        </div>

        <div className="summaryGrid">
          <SummaryCard label="已识别字段" value={`${analysis?.extracted_fields.length ?? 0} 项`} />
          <SummaryCard label="待人工确认" value={`${reviewSummary.length} 项`} />
          <SummaryCard label="目录已归位" value={`${analysis?.directory_placement.filter((item) => item.placement_status === "placed").length ?? 0} / ${analysis?.directory_placement.length ?? 0}`} />
          <SummaryCard label="导出状态" value={exportStatus} />
        </div>

        {analysis ? (
          <>
            <TemplateInfoPanel analysis={analysis} />
            <FieldTable fields={analysis.extracted_fields} updateField={updateField} />
          </>
        ) : (
          <p className="emptyState">请先上传或扫描材料，并开始识别。</p>
        )}
      </section>

      {analysis && showFiling ? (
        <FilingPath
          projectFields={projectFields}
          placement={analysis.directory_placement}
          draft={analysis.draft_outline}
          updatePlacement={updatePlacement}
          updateDraftSection={updateDraftSection}
        />
      ) : null}

      {analysis && showBid ? (
        <BidPath
          rows={analysis.bid_evaluation_table}
          fields={analysis.extracted_fields}
          updateBidRow={updateBidRow}
          addBidRow={addBidRow}
          deleteBidRow={deleteBidRow}
        />
      ) : null}

      <ReviewSummaryPanel items={reviewSummary} />

      <section className="panel">
        <div className="sectionHeader">
          <div>
            <h2>保存与导出</h2>
            <p className="helperText">保存复核结果后，导出按钮才会启用；如果保存后继续修改，必须再次保存。</p>
          </div>
          <StatusPill status={canExportSaved ? "success" : hasUnsavedChanges ? "warn" : "idle"}>
            {canExportSaved ? "可导出" : hasUnsavedChanges ? "有未保存修改" : "待保存"}
          </StatusPill>
        </div>

        <div className="exportGrid">
          <div className="exportStatus">
            <SummaryCard label="保存状态" value={saveInfo ? `已保存 ${saveInfo.review_id}` : "未保存"} />
            <SummaryCard label="保存位置" value={saveInfo?.path ?? "数据库 / JSON 待写入"} />
            <SummaryCard label="保存时间" value={saveInfo ? new Date(saveInfo.saved_at).toLocaleString("zh-CN") : "-"} />
          </div>
          <div className="exportBox">
            <button className="primaryButton" onClick={saveReview} disabled={!analysis || isSaving}>
              {isSaving ? "保存中..." : "保存复核结果"}
            </button>
            <div className="buttonRow">
              <button onClick={exportWord} disabled={!canExportSaved || !shouldShowWordExport || isExporting !== null}>
                {isExporting === "word" ? "导出中..." : "导出 Word"}
              </button>
              <button onClick={exportFilingChecklist} disabled={!canExportSaved || !shouldShowChecklistExport || isExporting !== null}>
                {isExporting === "filingChecklist" ? "导出中..." : "导出归档清单"}
              </button>
              <button onClick={exportExcel} disabled={!canExportSaved || !shouldShowExcelExport || isExporting !== null}>
                {isExporting === "excel" ? "导出中..." : "导出 Excel"}
              </button>
            </div>
            <button className="dangerButton" onClick={clearCurrentMaterial}>清空当前材料</button>
          </div>
        </div>
      </section>
    </main>
  );
}

function stageLabel(stage: WorkspaceStage) {
  const labels: Record<WorkspaceStage, string> = {
    idle: "待选择材料",
    parsed: "已解析",
    ocr_pending: "OCR 待接入",
    analyzed: "待保存复核",
    saved: "已保存",
    exportable: "可导出",
    failed: "处理失败"
  };
  return labels[stage];
}

function TextInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label>
      <span>{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={`请输入${label}`} />
    </label>
  );
}

function TemplateInfoPanel({ analysis }: { analysis: SkillAnalysisResult }) {
  return (
    <div className="templateGrid">
      {(analysis.matched_basic_templates ?? []).map((template) => (
        <div className="decisionBox" key={template.template_id}>
          <span>{template.output_type.toUpperCase()} 模板</span>
          <strong>{template.template_name}</strong>
          <p className="helperText">{template.description ?? template.source}</p>
        </div>
      ))}
      <div className="decisionBox">
        <span>任务判断</span>
        <strong>{taskTypeLabel(analysis.task_type)}</strong>
        <p className="helperText">{analysis.task_basis}</p>
      </div>
      <div className="decisionBox">
        <span>规则来源</span>
        <strong>{analysis.rule_source ?? analysis.template_source}</strong>
        <p className="helperText">{analysis.skill_basis.join("；")}</p>
      </div>
    </div>
  );
}

function FieldTable({ fields, updateField }: { fields: ExtractedField[]; updateField: (id: string, patch: Partial<ExtractedField>) => void }) {
  return (
    <section className="subPanel">
      <div className="sectionHeader">
        <div>
          <h3>字段复核表</h3>
          <p className="helperText">支持表格内直接编辑识别值、复核状态和备注。</p>
        </div>
      </div>
      <div className="tableWrap">
        <table>
          <thead>
            <tr>
              <th>字段</th>
              <th>识别值</th>
              <th>状态</th>
              <th>置信度</th>
              <th>来源证据</th>
              <th>复核</th>
              <th>备注</th>
            </tr>
          </thead>
          <tbody>
            {fields.map((field) => (
              <tr key={field.field_key}>
                <td>{field.field_name}</td>
                <td><input value={displayValue(field.value)} onChange={(event) => updateField(field.field_key, { value: event.target.value, review_status: "confirmed" })} /></td>
                <td><StatusPill status={field.status}>{fieldStatusLabel(field.status)}</StatusPill></td>
                <td>{Math.round(field.confidence * 100)}%</td>
                <td>{field.source_file}<br />{field.evidence_text}</td>
                <td><ReviewSelect value={field.review_status} onChange={(value) => updateField(field.field_key, { review_status: value })} /></td>
                <td><input value={field.remark} onChange={(event) => updateField(field.field_key, { remark: event.target.value })} /></td>
              </tr>
            ))}
            {!fields.length ? <EmptyRow colSpan={7} /> : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function FilingPath({
  projectFields,
  placement,
  draft,
  updatePlacement,
  updateDraftSection
}: {
  projectFields: ExtractedField[];
  placement: DirectoryPlacement[];
  draft: SkillAnalysisResult["draft_outline"];
  updatePlacement: (index: number, patch: Partial<DirectoryPlacement>) => void;
  updateDraftSection: (index: number, content_preview: string) => void;
}) {
  return (
    <>
      <section className="panel">
        <div className="sectionHeader">
          <div>
            <h2>目录清单预览</h2>
            <p className="helperText">目录清单优先展示材料归位、缺件和待补充项，方便客户先判断能否备案。</p>
          </div>
          <StatusPill status={placement.some((item) => item.placement_status !== "placed") ? "warn" : "success"}>
            {placement.filter((item) => item.placement_status !== "placed").length} 项待处理
          </StatusPill>
        </div>
        <div className="directoryGrid">
          <div className="directoryNav">
            {placement.map((item, index) => (
              <div className="navRow" key={`${item.template_position}-${index}`}>
                <strong>{item.template_position}</strong>
                <StatusPill status={item.placement_status}>{placementStatusLabel(item.placement_status)}</StatusPill>
              </div>
            ))}
            {!placement.length ? <p className="emptyState">暂无目录归位结果。</p> : null}
          </div>
          <div className="directoryList">
            {placement.map((item, index) => (
              <div className="materialRow" key={`${item.required_material}-${index}`}>
                <strong>{item.required_material}</strong>
                <div>
                  <p>识别材料：{displayValue(item.recognized_material_type)}</p>
                  <p>归位依据：{item.placement_basis || item.skill_basis}</p>
                </div>
                <StatusPill status={item.placement_status}>{placementStatusLabel(item.placement_status)}</StatusPill>
                <div className="materialActions">
                  <input value={item.matched_file_name || ""} onChange={(event) => updatePlacement(index, { matched_file_name: event.target.value })} placeholder="匹配文件名" />
                  <select value={item.placement_status} onChange={(event) => updatePlacement(index, { placement_status: event.target.value as DirectoryPlacement["placement_status"] })}>
                    <option value="placed">已归位</option>
                    <option value="missing">缺失</option>
                    <option value="uncertain">归位不确定</option>
                    <option value="manual_required">需人工判断</option>
                  </select>
                  <input value={item.remark} onChange={(event) => updatePlacement(index, { remark: event.target.value })} placeholder="备注" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="sectionHeader">
          <div>
            <h2>备案文件初稿结构预览</h2>
            <p className="helperText">保留原版结构化初稿能力，可在保存后导出 Word。</p>
          </div>
        </div>
        <div className="summaryGrid compact">
          {projectFields.slice(0, 6).map((field) => <SummaryCard key={field.field_key} label={field.field_name} value={displayValue(field.value)} />)}
        </div>
        {(draft?.sections ?? []).map((section, index) => (
          <div className="draftSection" key={section.section_title}>
            <strong>{section.section_title}</strong>
            <textarea
              value={section.content_preview || "待补充"}
              onChange={(event) => updateDraftSection(index, event.target.value)}
              rows={3}
            />
            <p>来源字段：{section.source_fields.join("、") || "待补充"}</p>
          </div>
        ))}
      </section>
    </>
  );
}

function bidModuleColumns(moduleName: string) {
  if (moduleName.includes("递交")) return ["序号", "供应商名称", "递交时间", "联系人", "联系方式", "备注", "操作"];
  if (moduleName.includes("密封")) return ["序号", "供应商名称", "密封性检查结果", "不合格原因", "供应商签字确认", "备注", "操作"];
  if (moduleName.includes("资格")) return ["序号", "供应商名称", "资格审查结果", "不通过原因", "备注", "操作"];
  if (moduleName.includes("符合性")) return ["序号", "供应商名称", "符合性审查结果", "响应性审查结果", "不通过原因", "备注", "操作"];
  if (moduleName.includes("候选")) return ["序号", "供应商名称", "报价", "排名", "中标/成交候选顺序", "备注", "操作"];
  return ["序号", "供应商名称", "报价", "评审得分", "排名", "备注", "操作"];
}

function BidPath({
  rows,
  fields,
  updateBidRow,
  addBidRow,
  deleteBidRow
}: {
  rows: BidEvaluationRow[];
  fields: ExtractedField[];
  updateBidRow: (id: string, patch: Partial<BidEvaluationRow>) => void;
  addBidRow: () => void;
  deleteBidRow: (id: string) => void;
}) {
  return (
    <section className="panel">
      <div className="sectionHeader">
        <div>
          <h2>开评标表格预览与复核</h2>
          <p className="helperText">保留供应商行编辑、新增和删除能力，保存后可导出 Excel。</p>
        </div>
        <button onClick={addBidRow}>新增供应商行</button>
      </div>
      <div className="summaryGrid compact">
        <SummaryCard label="已识别供应商" value={`${rows.filter((row) => !missingBidValue(row.supplier_name)).length}`} />
        <SummaryCard label="待补充字段" value={`${countMissingBidFields(rows)}`} />
        <SummaryCard label="采购人" value={displayValue(fieldValue(fields, "purchaser"))} />
      </div>
      <div className="excelPreviewShell">
        {BID_FORM_MODULES.map((moduleName) => (
          <div className="excelSheet" key={moduleName}>
            <h3>{moduleName}</h3>
            <div className="sheetHeaderFields">
              <span>采购人：{displayValue(fieldValue(fields, "purchaser"))}</span>
              <span>采购编号：{displayValue(fieldValue(fields, "project_id"))}</span>
              <span>项目名称：{displayValue(fieldValue(fields, "project_name"))}</span>
              <span>开标时间：{displayValue(fieldValue(fields, "bid_opening_time"))}</span>
            </div>
            <div className="tableWrap">
              <table className="excelTable">
                <thead>
                  <tr>{bidModuleColumns(moduleName).map((column) => <th key={column}>{column}</th>)}</tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr key={`${moduleName}-${row.row_id}`}>
                      <td>{index + 1}</td>
                      <td><input value={displayValue(row.supplier_name)} onChange={(event) => updateBidRow(row.row_id, { supplier_name: event.target.value })} /></td>
                      {moduleName.includes("递交") ? (
                        <>
                          <td><input value={displayValue(row.submit_time)} onChange={(event) => updateBidRow(row.row_id, { submit_time: event.target.value })} /></td>
                          <td><input value={displayValue(row.contact_person)} onChange={(event) => updateBidRow(row.row_id, { contact_person: event.target.value })} /></td>
                          <td><input value={displayValue(row.contact_phone)} onChange={(event) => updateBidRow(row.row_id, { contact_phone: event.target.value })} /></td>
                        </>
                      ) : moduleName.includes("密封") ? (
                        <>
                          <td><input value={displayValue(row.seal_check_result)} onChange={(event) => updateBidRow(row.row_id, { seal_check_result: event.target.value })} /></td>
                          <td><input value={displayValue(row.fail_reason)} onChange={(event) => updateBidRow(row.row_id, { fail_reason: event.target.value })} /></td>
                          <td><input value={displayValue(row.supplier_signature)} onChange={(event) => updateBidRow(row.row_id, { supplier_signature: event.target.value })} /></td>
                        </>
                      ) : moduleName.includes("资格") ? (
                        <>
                          <td><input value={displayValue(row.qualification_status)} onChange={(event) => updateBidRow(row.row_id, { qualification_status: event.target.value })} /></td>
                          <td><input value={displayValue(row.fail_reason)} onChange={(event) => updateBidRow(row.row_id, { fail_reason: event.target.value })} /></td>
                        </>
                      ) : moduleName.includes("符合性") ? (
                        <>
                          <td><input value={displayValue(row.compliance_result)} onChange={(event) => updateBidRow(row.row_id, { compliance_result: event.target.value })} /></td>
                          <td><input value={displayValue(row.responsiveness_result)} onChange={(event) => updateBidRow(row.row_id, { responsiveness_result: event.target.value })} /></td>
                          <td><input value={displayValue(row.fail_reason)} onChange={(event) => updateBidRow(row.row_id, { fail_reason: event.target.value })} /></td>
                        </>
                      ) : moduleName.includes("候选") ? (
                        <>
                          <td><input value={displayValue(row.bid_price)} onChange={(event) => updateBidRow(row.row_id, { bid_price: event.target.value })} /></td>
                          <td><input value={displayValue(row.ranking)} onChange={(event) => updateBidRow(row.row_id, { ranking: event.target.value })} /></td>
                          <td><input value={displayValue(row.candidate_order)} onChange={(event) => updateBidRow(row.row_id, { candidate_order: event.target.value })} /></td>
                        </>
                      ) : (
                        <>
                          <td><input value={displayValue(row.bid_price)} onChange={(event) => updateBidRow(row.row_id, { bid_price: event.target.value })} /></td>
                          <td><input value={displayValue(row.score)} onChange={(event) => updateBidRow(row.row_id, { score: event.target.value })} /></td>
                          <td><input value={displayValue(row.ranking)} onChange={(event) => updateBidRow(row.row_id, { ranking: event.target.value })} /></td>
                        </>
                      )}
                      <td><input value={row.remark} onChange={(event) => updateBidRow(row.row_id, { remark: event.target.value })} /></td>
                      <td><button onClick={() => deleteBidRow(row.row_id)}>删除</button></td>
                    </tr>
                  ))}
                  {!rows.length ? <EmptyRow colSpan={8} /> : null}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function SheetPreview({ sheets }: { sheets: ParsedSheetState[] }) {
  return (
    <div className="sheetPreview">
      <h3>Excel 工作表预览</h3>
      {sheets.slice(0, 3).map((sheet) => (
        <div className="draftSection" key={sheet.sheet_name}>
          <strong>{sheet.sheet_name}</strong>
          <pre className="textPreview">
            {sheet.rows.slice(0, 6).map((row) => row.join(" | ")).join("\n") || "空工作表"}
          </pre>
        </div>
      ))}
    </div>
  );
}

function WarningList({ warnings }: { warnings: string[] }) {
  return (
    <div className="warningList">
      {warnings.map((warning, index) => (
        <p key={`${warning}-${index}`}>{warning}</p>
      ))}
    </div>
  );
}

function ReviewSummaryPanel({ items }: { items: ReviewSummaryItem[] }) {
  return (
    <section className="panel">
      <div className="sectionHeader">
        <div>
          <h2>人工复核汇总</h2>
          <p className="helperText">汇总未识别字段、低置信度字段、缺失目录项、OCR 来源内容、开评标未识别项和未保存修改。</p>
        </div>
        <span className="pill warn">{items.length} 项待关注</span>
      </div>
      <div className="tableWrap">
        <table>
          <thead>
            <tr>
              <th>类型</th>
              <th>内容</th>
              <th>当前状态</th>
              <th>处理建议</th>
              <th>复核状态</th>
              <th>备注</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => (
              <tr key={`${item.item_type}-${index}`}>
                <td>{item.item_type}</td>
                <td>{item.content}</td>
                <td>{item.current_status}</td>
                <td>{item.suggestion}</td>
                <td>{reviewLabel(item.review_status)}</td>
                <td>{item.remark || "-"}</td>
              </tr>
            ))}
            {!items.length ? <EmptyRow colSpan={6} /> : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function countMissingBidFields(rows: BidEvaluationRow[]) {
  const keys: Array<keyof BidEvaluationRow> = [
    "supplier_name",
    "contact_person",
    "contact_phone",
    "submit_time",
    "seal_check_result",
    "fail_reason",
    "supplier_signature",
    "bid_price",
    "qualification_status",
    "compliance_result",
    "responsiveness_result",
    "score",
    "ranking",
    "candidate_order"
  ];
  return rows.reduce((total, row) => total + keys.filter((key) => missingBidValue(row[key])).length, 0);
}

function ReviewSelect({ value, onChange }: { value: ReviewChoice; onChange: (value: ReviewChoice) => void }) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value as ReviewChoice)}>
      {REVIEW_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  );
}

function StatusPill({ status, children }: { status: string; children: ReactNode }) {
  const tone =
    status === "success" || status === "recognized" || status === "placed" || status === "exportable" || status === "saved" || status === "upload"
      ? "ok"
      : status === "missing" || status === "unsupported_or_failed" || status === "failed"
        ? "bad"
        : status === "idle"
          ? ""
          : "warn";
  return <span className={`pill ${tone}`}>{children}</span>;
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="summaryCard">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function EmptyRow({ colSpan }: { colSpan: number }) {
  return (
    <tr>
      <td className="emptyCell" colSpan={colSpan}>暂无结果。请先上传或扫描材料并开始识别。</td>
    </tr>
  );
}

function buildReviewSummary(
  analysis: SkillAnalysisResult | null,
  ocrResult: OcrResult | null,
  hasUnsavedChanges: boolean
): ReviewSummaryItem[] {
  const items: ReviewSummaryItem[] = [];
  if (!analysis) {
    if (ocrResult) {
      items.push({
        item_type: "OCR 来源内容",
        content: ocrResult.source_file.file_name,
        current_status: sourceLabel(ocrResult.source),
        suggestion: ocrResult.recognized_text ? "OCR 已返回文本，可继续识别。" : "真实 OCR 待接入或未返回文本，请勿伪造扫描件内容。",
        review_status: "pending",
        remark: ocrResult.warnings.map((warning) => warning.message).join("；")
      });
    }
    return items;
  }

  analysis.extracted_fields.forEach((field) => {
    if (field.status !== "recognized" || field.review_required) {
      items.push({
        item_type: field.status === "missing" ? "未识别字段" : "低置信度字段",
        content: `${field.field_name}：${displayValue(field.value)}`,
        current_status: fieldStatusLabel(field.status),
        suggestion: field.status === "missing" ? "请人工补充识别结果并保存。" : "请核对来源摘录后确认或修改。",
        review_status: field.review_status,
        remark: field.remark
      });
    }
  });

  analysis.directory_placement.forEach((item) => {
    if (item.placement_status !== "placed") {
      items.push({
        item_type: item.placement_status === "missing" ? "缺失目录项" : "归位不确定项",
        content: `${item.template_position}：${item.required_material}`,
        current_status: placementStatusLabel(item.placement_status),
        suggestion: "请确认是否补充材料、调整归位状态或填写备注。",
        review_status: item.review_status,
        remark: item.remark
      });
    }
  });

  analysis.bid_evaluation_table.forEach((row) => {
    const labels: Record<keyof Pick<BidEvaluationRow, "supplier_name" | "contact_person" | "contact_phone" | "submit_time" | "seal_check_result" | "fail_reason" | "supplier_signature" | "bid_price" | "qualification_status" | "compliance_result" | "responsiveness_result" | "score" | "ranking" | "candidate_order">, string> = {
      supplier_name: "供应商名称",
      contact_person: "联系人",
      contact_phone: "联系方式",
      submit_time: "递交时间",
      seal_check_result: "密封性检查结果",
      fail_reason: "不通过/不合格原因",
      supplier_signature: "供应商签字确认",
      bid_price: "报价",
      qualification_status: "资格审查结果",
      compliance_result: "符合性审查结果",
      responsiveness_result: "响应性审查结果",
      score: "评审得分",
      ranking: "排名",
      candidate_order: "中标/成交候选顺序"
    };
    Object.entries(labels).forEach(([key, label]) => {
      const value = row[key as keyof BidEvaluationRow];
      if (missingBidValue(value)) {
        items.push({
          item_type: "开评标表格未识别项",
          content: label,
          current_status: "未识别，需人工补充",
          suggestion: "请根据原始材料人工填写，不要编造。",
          review_status: row.review_status,
          remark: row.remark
        });
      }
    });
  });

  if (ocrResult) {
    items.push({
      item_type: "OCR 来源内容",
      content: ocrResult.source_file.file_name,
      current_status: sourceLabel(ocrResult.source),
      suggestion: ocrResult.recognized_text ? "OCR 已返回文本，请核对扫描件识别结果。" : "真实 OCR 待接入，扫描件内容需人工确认。",
      review_status: "pending",
      remark: ocrResult.warnings.map((warning) => warning.message).join("；")
    });
  }

  if (hasUnsavedChanges) {
    items.push({
      item_type: "用户已修改内容",
      content: "页面存在人工修改但尚未保存。",
      current_status: "存在未保存修改",
      suggestion: "请点击保存复核结果，保存后再导出 Word、Excel 或归档清单。",
      review_status: "needs_change",
      remark: ""
    });
  }

  return items;
}
