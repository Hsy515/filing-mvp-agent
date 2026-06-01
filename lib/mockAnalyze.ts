import type {
  BasicInfoItem,
  DirectoryMatchItem,
  DirectoryMatchStatus,
  FilingAnalysisResult
} from "./types";

const TEXT = {
  outlineProject: "\u4e00\u3001\u9879\u76ee\u57fa\u672c\u4fe1\u606f",
  outlineProcurement: "\u4e8c\u3001\u91c7\u8d2d\u8fc7\u7a0b\u6750\u6599",
  outlineSignup: "\u4e09\u3001\u62a5\u540d\u4e0e\u8d44\u683c\u6750\u6599",
  outlineOpening: "\u56db\u3001\u5f00\u8bc4\u6807\u8fc7\u7a0b\u6750\u6599",
  outlineArchive: "\u4e94\u3001\u7b7e\u5b57\u76d6\u7ae0\u4e0e\u5f52\u6863\u6750\u6599",
  unknown: "\u672a\u8bc6\u522b",
  userMaterial: "\u7528\u6237\u8f93\u5165\u6750\u6599",
  noMaterial: "\u672a\u63d0\u4f9b\u6750\u6599\u6587\u672c",
  noExcerpt: "\u672a\u5728\u6750\u6599\u4e2d\u5b9a\u4f4d\u5230\u660e\u786e\u6458\u5f55",
  notMatched: "\u672a\u5339\u914d\u5230\u6750\u6599",
  packageUnknown: "\u672a\u8bc6\u522b\u5230\u5206\u5305\u4fe1\u606f"
};

const LABELS = {
  projectName: "\u9879\u76ee\u540d\u79f0",
  projectId: "\u9879\u76ee\u7f16\u53f7",
  procurementMethod: "\u91c7\u8d2d\u65b9\u5f0f",
  purchaser: "\u91c7\u8d2d\u4eba",
  signup: "\u62a5\u540d",
  opening: "\u5f00\u6807"
};

const DRAFT_OUTLINE = [
  TEXT.outlineProject,
  TEXT.outlineProcurement,
  TEXT.outlineSignup,
  TEXT.outlineOpening,
  TEXT.outlineArchive
];

function extractValue(text: string, labels: string[]): string {
  for (const label of labels) {
    const pattern = new RegExp(`${label}[\\uFF1A:\\s]*([^\\n\\u3002\\uFF1B;]+)`);
    const matched = text.match(pattern);
    if (matched?.[1]) return matched[1].trim();
  }
  return "";
}

function hasAny(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

function excerptFor(text: string, keywords: string[]): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  const index = keywords
    .map((keyword) => normalized.indexOf(keyword))
    .filter((position) => position >= 0)
    .sort((a, b) => a - b)[0];

  if (index === undefined) return normalized.slice(0, 80) || TEXT.noMaterial;
  return normalized.slice(Math.max(0, index - 24), index + 72);
}

function makeBasicItem(
  id: string,
  fieldCategory: string,
  fieldName: string,
  value: string,
  text: string,
  keywords: string[]
): BasicInfoItem {
  const recognized = Boolean(value && value !== TEXT.unknown);

  return {
    id,
    field_category: fieldCategory,
    field_name: fieldName,
    ai_result: recognized ? value : TEXT.unknown,
    source_file: TEXT.userMaterial,
    source_excerpt: recognized ? excerptFor(text, keywords) : TEXT.noExcerpt,
    recognition_status: recognized ? "recognized" : "not_found",
    confidence: recognized ? 0.86 : 0.35,
    review_status: "pending",
    remark: ""
  };
}

function makeDirectoryItem(
  id: string,
  name: string,
  required: boolean,
  status: DirectoryMatchStatus,
  text: string,
  keywords: string[]
): DirectoryMatchItem {
  const matchedMaterial = status === "missing" ? TEXT.notMatched : TEXT.userMaterial;
  const matchedKeywords = keywords.filter((keyword) => text.includes(keyword));

  return {
    id,
    directory_item_name: name,
    required,
    match_status: status,
    matched_material: matchedMaterial,
    rationale:
      status === "matched"
        ? `\u6750\u6599\u4e2d\u51fa\u73b0\u5173\u952e\u8bcd\uff1a${matchedKeywords.join("\u3001")}`
        : status === "uncertain"
          ? "\u6750\u6599\u4e2d\u51fa\u73b0\u76f8\u5173\u7ebf\u7d22\uff0c\u4f46\u4e0d\u8db3\u4ee5\u786e\u8ba4\u5b8c\u6574\u6750\u6599\u5df2\u63d0\u4f9b"
          : "\u6750\u6599\u4e2d\u672a\u51fa\u73b0\u5fc5\u8981\u5173\u952e\u8bcd\u6216\u660e\u786e\u6750\u6599\u540d\u79f0",
    confidence: status === "matched" ? 0.88 : status === "uncertain" ? 0.56 : 0.31,
    review_status: "pending",
    remark: ""
  };
}

export function mockAnalyze(materialText: string): FilingAnalysisResult {
  const text = materialText.trim();
  const projectName =
    extractValue(text, [LABELS.projectName]) || "\u0032\u0030\u0032\u0035\u5e74\u4e2d\u836f\u996e\u7247\u91c7\u8d2d\u9879\u76ee";
  const projectId = extractValue(text, [LABELS.projectId]) || "proj_demo_001";
  const procurementMethod = extractValue(text, [LABELS.procurementMethod]) || "\u516c\u5f00\u62db\u6807";
  const purchaser = extractValue(text, [LABELS.purchaser]) || TEXT.unknown;
  const signupDeadline =
    text.match(/(\d{4}\u5e74\d{1,2}\u6708\d{1,2}\u65e5)\u524d\u5b8c\u6210\u62a5\u540d/)?.[1] ||
    TEXT.unknown;
  const bidOpeningTime =
    text.match(/\u5f00\u6807\u65f6\u95f4\u4e3a?(\d{4}\u5e74\d{1,2}\u6708\d{1,2}\u65e5)/)?.[1] ||
    TEXT.unknown;
  const signedFileStatus: DirectoryMatchStatus =
    hasAny(text, [
      "\u6682\u672a\u53d1\u73b0\u5b8c\u6574\u7b7e\u5b57\u76d6\u7ae0\u9875",
      "\u672a\u53d1\u73b0\u5b8c\u6574\u7b7e\u5b57\u76d6\u7ae0",
      "\u672a\u51fa\u73b0\u7b7e\u5b57",
      "\u672a\u51fa\u73b0\u76d6\u7ae0"
    ])
      ? "missing"
      : hasAny(text, ["\u7b7e\u5b57", "\u76d6\u7ae0", "\u516c\u7ae0"])
        ? "matched"
        : "missing";

  const basicItems: BasicInfoItem[] = [
    makeBasicItem("basic_project_name", "\u9879\u76ee\u57fa\u7840\u4fe1\u606f", LABELS.projectName, projectName, text, [LABELS.projectName]),
    makeBasicItem("basic_project_id", "\u9879\u76ee\u57fa\u7840\u4fe1\u606f", LABELS.projectId, projectId, text, [LABELS.projectId]),
    makeBasicItem("basic_procurement_method", "\u91c7\u8d2d\u4fe1\u606f", LABELS.procurementMethod, procurementMethod, text, [LABELS.procurementMethod]),
    makeBasicItem("basic_purchaser", "\u91c7\u8d2d\u4e3b\u4f53", LABELS.purchaser, purchaser, text, [LABELS.purchaser]),
    makeBasicItem("basic_signup_deadline", "\u65f6\u95f4\u8282\u70b9", "\u62a5\u540d\u622a\u6b62\u65f6\u95f4", signupDeadline, text, [LABELS.signup]),
    makeBasicItem("basic_bid_opening_time", "\u65f6\u95f4\u8282\u70b9", "\u5f00\u6807\u65f6\u95f4", bidOpeningTime, text, [LABELS.opening])
  ];

  const directoryMatches: DirectoryMatchItem[] = [
    makeDirectoryItem("dir_procurement_file", "\u91c7\u8d2d\u6587\u4ef6", true, hasAny(text, ["\u91c7\u8d2d\u6587\u4ef6", "\u62db\u6807\u6587\u4ef6"]) ? "matched" : "missing", text, ["\u91c7\u8d2d\u6587\u4ef6", "\u62db\u6807\u6587\u4ef6"]),
    makeDirectoryItem("dir_procurement_notice", "\u91c7\u8d2d\u516c\u544a", true, hasAny(text, ["\u91c7\u8d2d\u516c\u544a", "\u516c\u544a"]) ? "matched" : "missing", text, ["\u91c7\u8d2d\u516c\u544a", "\u516c\u544a"]),
    makeDirectoryItem("dir_signup_form", "\u62a5\u540d\u8868", true, hasAny(text, ["\u62a5\u540d\u8868"]) ? "matched" : hasAny(text, [LABELS.signup]) ? "uncertain" : "missing", text, ["\u62a5\u540d\u8868", LABELS.signup]),
    makeDirectoryItem("dir_bidder_list", "\u6295\u6807\u5355\u4f4d\u540d\u5355", true, hasAny(text, ["\u6295\u6807\u5355\u4f4d\u540d\u5355", "\u4f9b\u5e94\u5546\u540d\u5355", "\u6295\u6807\u4eba\u540d\u5355"]) ? "matched" : "uncertain", text, ["\u6295\u6807\u5355\u4f4d\u540d\u5355", "\u4f9b\u5e94\u5546\u540d\u5355", "\u6295\u6807\u4eba\u540d\u5355"]),
    makeDirectoryItem("dir_opening_record", "\u5f00\u6807\u8bb0\u5f55\u8868", true, hasAny(text, ["\u5f00\u6807\u8bb0\u5f55\u8868", LABELS.opening]) ? "matched" : "missing", text, ["\u5f00\u6807\u8bb0\u5f55\u8868", LABELS.opening]),
    makeDirectoryItem("dir_evaluation_report", "\u8bc4\u6807\u62a5\u544a", true, hasAny(text, ["\u8bc4\u6807\u62a5\u544a", "\u8bc4\u6807"]) ? "matched" : "missing", text, ["\u8bc4\u6807\u62a5\u544a", "\u8bc4\u6807"]),
    makeDirectoryItem("dir_award_notice", "\u4e2d\u6807\u901a\u77e5\u4e66", true, hasAny(text, ["\u4e2d\u6807\u901a\u77e5\u4e66", "\u4e2d\u6807"]) ? "matched" : "missing", text, ["\u4e2d\u6807\u901a\u77e5\u4e66", "\u4e2d\u6807"]),
    makeDirectoryItem("dir_signed_files", "\u7b7e\u5b57\u76d6\u7ae0\u6587\u4ef6", true, signedFileStatus, text, ["\u7b7e\u5b57", "\u76d6\u7ae0", "\u516c\u7ae0"])
  ];

  return {
    review_id: `review_${Date.now()}`,
    project: {
      project_id: projectId === TEXT.unknown ? "proj_demo_001" : projectId,
      project_name: projectName,
      procurement_method: procurementMethod,
      package_info: TEXT.packageUnknown
    },
    basic_info_sheet: { items: basicItems },
    directory_matches: directoryMatches,
    draft_outline: DRAFT_OUTLINE,
    warnings: [],
    source: "mock"
  };
}
