import type {
  BasicTemplateMeta,
  BidAnalysis,
  BidEvaluationRow,
  DirectoryPlacement,
  DraftOutline,
  ExtractedField,
  SkillAnalysisResult,
  TaskType
} from "./types";
import fs from "fs";
import path from "path";
import {
  bidEvaluationKeywords,
  filingKeywords,
  filingTemplateDirectory
} from "./skillRules";

type AnalyzeInput = {
  text: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  uploadId?: string;
};

type FieldStatus = "recognized" | "missing" | "uncertain";
type TemplateSource = "enterprise_template_rules" | "fallback_rules";

type EnterpriseDirectoryItem = {
  position: string;
  required_material: string;
  accepted_keywords: string[];
  required: boolean;
  match_weight?: number;
};

type EnterpriseFilingRule = {
  rule_id: string;
  template_type: "filing_document";
  procurement_method: string;
  directory_items: EnterpriseDirectoryItem[];
  source_template_hint: string;
};

type EnterpriseBidField = {
  field_key: string;
  field_name: string;
  accepted_keywords: string[];
  required: boolean;
  match_weight?: number;
};

type EnterpriseBidRule = {
  rule_id: string;
  template_type: "bid_evaluation_table";
  procurement_method: string;
  table_fields: EnterpriseBidField[];
  source_template_hint: string;
};

type TemplateRuleSet = {
  templateSource: TemplateSource;
  filingRule: EnterpriseFilingRule;
  bidRule: EnterpriseBidRule;
  fieldAliasRules: FieldAliasRule[];
  materialClassificationRules: MaterialClassificationRule[];
  templateIndex: TemplateIndexItem[];
  basicTemplates: BasicTemplateMeta[];
};

type FieldAliasRule = {
  field_key: string;
  field_name: string;
  aliases: string[];
  match_weight?: number;
};

type MaterialClassificationRule = {
  material_type: string;
  task_type: TaskType;
  priority?: number;
  title_priority?: boolean;
  keywords: string[];
  match_weight?: number;
};

type TemplateIndexItem = {
  template_id: string;
  template_name: string;
  template_type: "filing_document" | "bid_evaluation_table";
  procurement_method: string;
  output_type: "word" | "excel";
  source_template_hint: string;
  usage: string;
};

type ClassificationResult = {
  materialType: string;
  taskType: TaskType;
  filingScore: number;
  bidScore: number;
  filingHits: string[];
  bidHits: string[];
  matchedRuleNames: string[];
  titlePriorityHit: string;
};

const TEXT_NOT_FOUND = "\u4e0a\u4f20\u6750\u6599\u4e2d\u672a\u627e\u5230\u5bf9\u5e94\u4fe1\u606f";
const UNRECOGNIZED = "\u672a\u8bc6\u522b";
const TO_BE_COMPLETED = "\u5f85\u8865\u5145";
const MANUAL_FILL = "未识别，需人工补充";

const fallbackFilingRule: EnterpriseFilingRule = {
  rule_id: "fallback_common_filing_directory",
  template_type: "filing_document",
  procurement_method: "\u901a\u7528",
  directory_items: filingTemplateDirectory.map((item) => ({
    position: item.template_position,
    required_material: item.required_material,
    accepted_keywords: item.keywords,
    required: true
  })),
  source_template_hint: "lib/skillRules.ts fallback filingTemplateDirectory"
};

const fallbackBidRule: EnterpriseBidRule = {
  rule_id: "fallback_bid_table_common",
  template_type: "bid_evaluation_table",
  procurement_method: "\u901a\u7528",
  table_fields: [
    { field_key: "project_name", field_name: "\u9879\u76ee\u540d\u79f0", accepted_keywords: ["\u9879\u76ee\u540d\u79f0"], required: true },
    { field_key: "project_id", field_name: "\u9879\u76ee\u7f16\u53f7", accepted_keywords: ["\u9879\u76ee\u7f16\u53f7", "\u7f16\u53f7"], required: true },
    { field_key: "procurement_method", field_name: "\u91c7\u8d2d\u65b9\u5f0f", accepted_keywords: ["\u91c7\u8d2d\u65b9\u5f0f"], required: true },
    { field_key: "bid_opening_time", field_name: "\u5f00\u6807\u65f6\u95f4", accepted_keywords: ["\u5f00\u6807\u65f6\u95f4", "\u5f00\u6807"], required: true },
    { field_key: "supplier_name", field_name: "\u4f9b\u5e94\u5546\u540d\u79f0", accepted_keywords: ["\u4f9b\u5e94\u5546", "\u6295\u6807\u5355\u4f4d", "\u6295\u6807\u4eba"], required: true },
    { field_key: "bid_price", field_name: "\u62a5\u4ef7", accepted_keywords: ["\u62a5\u4ef7", "\u6295\u6807\u62a5\u4ef7"], required: true },
    { field_key: "qualification_status", field_name: "\u8d44\u683c\u5ba1\u67e5\u7ed3\u679c", accepted_keywords: ["\u8d44\u683c\u5ba1\u67e5"], required: true },
    { field_key: "score", field_name: "\u8bc4\u5ba1\u5f97\u5206", accepted_keywords: ["\u8bc4\u5ba1\u5f97\u5206", "\u5f97\u5206", "\u8bc4\u5206"], required: true },
    { field_key: "ranking", field_name: "\u6392\u540d", accepted_keywords: ["\u6392\u540d", "\u540d\u6b21"], required: false },
    { field_key: "remark", field_name: "\u5907\u6ce8", accepted_keywords: ["\u5907\u6ce8"], required: false }
  ],
  source_template_hint: "lib/skillRules.ts fallback bid table fields"
};

const fallbackFieldAliasRules: FieldAliasRule[] = [
  { field_key: "project_name", field_name: "项目名称", aliases: ["项目名称", "采购项目名称"], match_weight: 10 },
  { field_key: "project_id", field_name: "项目编号", aliases: ["项目编号", "采购项目编号", "招标编号", "项目编码"], match_weight: 10 },
  { field_key: "procurement_method", field_name: "采购方式", aliases: ["采购方式", "招标方式", "采购形式"], match_weight: 8 },
  { field_key: "purchaser", field_name: "采购人", aliases: ["采购人", "采购单位", "采购人名称"], match_weight: 8 },
  { field_key: "agency", field_name: "代理机构", aliases: ["代理机构", "采购代理机构", "招标代理机构", "代理公司"], match_weight: 8 },
  { field_key: "budget", field_name: "预算金额", aliases: ["预算金额", "采购预算", "采购包预算金额"], match_weight: 8 },
  { field_key: "ceiling_price", field_name: "最高限价", aliases: ["最高限价", "采购包最高限价", "限价"], match_weight: 8 },
  { field_key: "bid_opening_time", field_name: "开标时间", aliases: ["开标时间", "开标日期"], match_weight: 7 },
  { field_key: "package_info", field_name: "包件信息", aliases: ["包件", "分包", "采购包", "包号"], match_weight: 6 },
  { field_key: "supplier_name", field_name: "供应商名称", aliases: ["供应商名称", "供应商", "投标单位", "投标人"], match_weight: 8 }
];

const fallbackMaterialClassificationRules: MaterialClassificationRule[] = [
  {
    material_type: "招标文件/采购文件",
    task_type: "filing_document",
    priority: 100,
    title_priority: true,
    keywords: ["招标文件", "采购文件", "投标人须知", "评标办法", "合同文本"],
    match_weight: 16
  },
  {
    material_type: "开标记录/开评标表格",
    task_type: "bid_evaluation_table",
    priority: 90,
    keywords: ["开标记录", "开标一览表", "供应商", "投标单位", "报价", "资格审查", "评审得分", "排名"],
    match_weight: 10
  }
];

const fallbackBasicTemplates: BasicTemplateMeta[] = [
  {
    template_id: "filing_basic_template",
    template_name: "备案文件基础模板",
    template_type: "filing_document",
    output_type: "word",
    description: "用于根据识别结果生成简易版备案文件 Word 初稿",
    source: "企业备案文件模板抽象规则"
  },
  {
    template_id: "bid_evaluation_basic_template",
    template_name: "开评标表格基础模板",
    template_type: "bid_evaluation_table",
    output_type: "excel",
    description: "用于根据识别结果生成简易版开评标 Excel 表格",
    source: "企业开评标表格模板抽象规则"
  }
];

function includesAny(text: string, keywords: string[]) {
  return keywords.some((keyword) => text.includes(keyword));
}

function readJsonFile<T>(relativePath: string): T | null {
  try {
    const fullPath = path.join(process.cwd(), relativePath);
    if (!fs.existsSync(fullPath)) return null;
    return JSON.parse(fs.readFileSync(fullPath, "utf8")) as T;
  } catch {
    return null;
  }
}

function loadTemplateRules(): TemplateRuleSet {
  const filingRulesFile = readJsonFile<{ rules?: EnterpriseFilingRule[] }>(
    "references/enterprise-templates/filing-template-rules.json"
  );
  const bidRulesFile = readJsonFile<{ rules?: EnterpriseBidRule[] }>(
    "references/enterprise-templates/bid-table-template-rules.json"
  );
  const fieldAliasFile = readJsonFile<{ fields?: FieldAliasRule[] }>(
    "references/enterprise-templates/field-alias-rules.json"
  );
  const materialClassificationFile = readJsonFile<{ rules?: MaterialClassificationRule[] }>(
    "references/enterprise-templates/material-classification-rules.json"
  );
  const templateIndex = readJsonFile<TemplateIndexItem[]>(
    "references/enterprise-templates/template-index.json"
  );
  const basicTemplateIndex = readJsonFile<{ templates?: BasicTemplateMeta[] }>(
    "references/enterprise-templates/basic-template-index.json"
  );
  const filingRule = filingRulesFile?.rules?.[0];
  const bidRule = bidRulesFile?.rules?.[0];
  const fieldAliasRules = fieldAliasFile?.fields?.length ? fieldAliasFile.fields : fallbackFieldAliasRules;
  const materialClassificationRules = materialClassificationFile?.rules?.length
    ? materialClassificationFile.rules
    : fallbackMaterialClassificationRules;

  if (filingRule && bidRule && fieldAliasFile?.fields && materialClassificationFile?.rules && templateIndex) {
    return {
      templateSource: "enterprise_template_rules",
      filingRule,
      bidRule,
      fieldAliasRules,
      materialClassificationRules,
      templateIndex,
      basicTemplates: basicTemplateIndex?.templates ?? fallbackBasicTemplates
    };
  }

  return {
    templateSource: "fallback_rules",
    filingRule: filingRule ?? fallbackFilingRule,
    bidRule: bidRule ?? fallbackBidRule,
    fieldAliasRules,
    materialClassificationRules,
    templateIndex: templateIndex ?? [],
    basicTemplates: basicTemplateIndex?.templates ?? fallbackBasicTemplates
  };
}

function excerpt(text: string, keyword: string) {
  const compact = text.replace(/\s+/g, " ").trim();
  const index = compact.indexOf(keyword);
  if (index < 0) return "";
  return compact.slice(Math.max(0, index - 32), index + 96);
}

function extractByPatterns(text: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return "";
}

function pick(patterns: RegExp[], text: string) {
  return extractByPatterns(text, patterns) || MANUAL_FILL;
}

function cleanSupplierName(value: string) {
  const cleaned = value
    .replace(/^(?:供应商名称|投标单位|投标人|响应供应商|递交响应文件供应商|成交候选供应商|中标候选人)[：:\s]*/, "")
    .replace(/[，,。；;].*$/, "")
    .trim();
  if (!cleaned) return "";
  if (/递交时间|送达时间|开标时间|评审时间|询价时间|磋商时间|谈判时间/.test(cleaned)) return "";
  if (!/(公司|有限公司|有限责任公司|股份有限公司|科技有限公司|信息技术有限公司|研究院|中心|事务所)$/.test(cleaned)) return "";
  return cleaned;
}

function extractNearby(text: string, supplierName: string, patterns: RegExp[]) {
  const index = text.indexOf(supplierName);
  const scope = index >= 0 ? text.slice(index, index + 280) : text;
  return extractByPatterns(scope, patterns);
}

function extractBlockValue(block: string, labels: string[]) {
  const labelPattern = labels.map(escapeRegExp).join("|");
  return extractByPatterns(block, [new RegExp(`(?:${labelPattern})[：:\\s]*([^\\n。；;]+)`)]);
}

function hasBidRowSignal(scope: string) {
  return /投标报价|最后报价|响应报价|成交金额|中标金额|资格审查|符合性审查|响应性审查|评审得分|综合得分|排名|候选/.test(scope);
}

function hasExcludedSupplierContext(text: string, supplierName: string) {
  const index = text.indexOf(supplierName);
  if (index < 0) return false;
  const before = text.slice(Math.max(0, index - 60), index);
  const after = text.slice(index, index + supplierName.length + 80);
  if (/采购代理机构|代理机构|采购人|采购单位|招标人|监督代表|记录人|评标委员会/.test(before)) return true;
  if (/评标委员会一致推荐|一致推荐|推荐$/.test(before.trim())) return true;
  if (/为采购人|为采购代理机构|为代理机构/.test(after)) return true;
  return false;
}

function mergeTextValue(current: string, next: string) {
  if (!next || next === MANUAL_FILL || next === "missing") return current || MANUAL_FILL;
  if (!current || current === MANUAL_FILL || current === "missing") return next;
  return current;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractByAliases(text: string, aliases: string[]) {
  for (const alias of aliases) {
    const normalizedAlias = alias.replace(/[：:]\s*$/, "");
    const pattern = new RegExp(`${escapeRegExp(normalizedAlias)}[：:\\s]*([^\\n。；;]+)`);
    const match = text.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return "";
}

function aliasRule(aliasRules: FieldAliasRule[], key: string, fallbackName: string, fallbackAliases: string[]) {
  return aliasRules.find((rule) => rule.field_key === key) ?? {
    field_key: key,
    field_name: fallbackName,
    aliases: fallbackAliases
  };
}

function detectProcurementMethod(text: string) {
  if (text.includes("公开招标") || text.includes("招标文件")) return "公开招标";
  if (text.includes("竞争性磋商") || text.includes("磋商文件")) return "竞争性磋商";
  if (text.includes("比选")) return "比选";
  if (text.includes("单一来源")) return "单一来源";
  if (text.includes("竞争性谈判") || text.includes("谈判文件")) return "竞争性谈判";
  if (text.includes("询价") || text.includes("询价文件")) return "询价";
  return "";
}

function matchedTemplateType(
  taskType: TaskType,
  procurementMethod: string,
  templateIndex: TemplateIndexItem[]
) {
  const templateType = taskType === "bid_evaluation_table" ? "bid_evaluation_table" : "filing_document";
  const matched = templateIndex.find((item) =>
    item.template_type === templateType && item.procurement_method === procurementMethod
  );
  if (matched) return matched.template_name;
  if (templateType === "filing_document") {
    return procurementMethod ? `${procurementMethod}类备案模板` : "通用备案模板";
  }
  return procurementMethod ? `${procurementMethod}类开评标表格模板` : "通用开评标表格模板";
}

function matchedBasicTemplates(taskType: TaskType, templates: BasicTemplateMeta[]) {
  if (taskType === "filing_document") {
    return templates.filter((item) => item.template_id === "filing_basic_template");
  }
  if (taskType === "bid_evaluation_table") {
    return templates.filter((item) => item.template_id === "bid_evaluation_basic_template");
  }
  if (taskType === "mixed") {
    return templates.filter((item) =>
      item.template_id === "filing_basic_template" || item.template_id === "bid_evaluation_basic_template"
    );
  }
  return [];
}

function classifyMaterial(
  text: string,
  fileType: string,
  classificationRules: MaterialClassificationRule[],
  bidRule: EnterpriseBidRule
): ClassificationResult {
  const isSpreadsheet = fileType === "xls" || fileType === "xlsx";
  const head = text.slice(0, 1000);
  const filingHits: string[] = [];
  const bidHits: string[] = [];
  const matchedRuleNames: string[] = [];
  let filingScore = 0;
  let bidScore = isSpreadsheet ? 8 : 0;
  let titlePriorityHit = "";
  let materialType = "未知材料";

  classificationRules.forEach((rule) => {
    const hits = rule.keywords.filter((keyword) => text.includes(keyword));
    if (!hits.length) return;
    const score = hits.length * (rule.match_weight ?? 5) + (rule.priority ?? 0) / 10;
    matchedRuleNames.push(`${rule.material_type}(${hits.join("、")})`);
    if (materialType === "未知材料" || (rule.priority ?? 0) > 80) materialType = rule.material_type;
    if (rule.title_priority && hits.some((keyword) => head.includes(keyword))) {
      titlePriorityHit = rule.material_type;
      filingScore += 50;
      materialType = rule.material_type;
    }
    if (rule.task_type === "filing_document") {
      filingScore += score;
      filingHits.push(...hits);
    } else if (rule.task_type === "bid_evaluation_table") {
      bidScore += score;
      bidHits.push(...hits);
    }
  });

  bidRule.table_fields.forEach((field) => {
    const hits = field.accepted_keywords.filter((keyword) => text.includes(keyword));
    if (!hits.length) return;
    bidScore += hits.length * (field.match_weight ?? 4);
    bidHits.push(...hits);
  });

  filingKeywords.forEach((keyword) => {
    if (text.includes(keyword) && !filingHits.includes(keyword)) {
      filingScore += 4;
      filingHits.push(keyword);
    }
  });
  bidEvaluationKeywords.forEach((keyword) => {
    if (text.includes(keyword) && !bidHits.includes(keyword)) {
      bidScore += 3;
      bidHits.push(keyword);
    }
  });

  let taskType: TaskType = "unknown";
  const hasBidResultSignal = ["报价", "投标报价", "响应报价", "资格审查", "评审得分", "排名", "开标记录", "开标一览表"]
    .some((keyword) => text.includes(keyword));

  if (titlePriorityHit) {
    taskType = hasBidResultSignal && bidScore > filingScore + 20 ? "mixed" : "filing_document";
  } else if (filingScore >= 18 && bidScore >= 18 && Math.abs(filingScore - bidScore) <= 18) {
    taskType = "mixed";
  } else if (bidScore > filingScore + 12 && (isSpreadsheet || hasBidResultSignal)) {
    taskType = "bid_evaluation_table";
  } else if (filingScore >= 10) {
    taskType = "filing_document";
  } else if (bidScore >= 10) {
    taskType = "bid_evaluation_table";
  }

  return {
    materialType,
    taskType,
    filingScore,
    bidScore,
    filingHits: Array.from(new Set(filingHits)),
    bidHits: Array.from(new Set(bidHits)),
    matchedRuleNames,
    titlePriorityHit
  };
}

function buildTaskBasis(classification: ClassificationResult, matchedTemplateType: string) {
  const filingPart = classification.filingHits.length ? `备案规则命中：${classification.filingHits.join("、")}` : "备案规则命中：无";
  const bidPart = classification.bidHits.length ? `开评标规则命中：${classification.bidHits.join("、")}` : "开评标规则命中：无";
  const scorePart = `备案分 ${classification.filingScore.toFixed(1)} / 开评标分 ${classification.bidScore.toFixed(1)}`;
  const priorityPart = classification.titlePriorityHit ? `标题优先规则：${classification.titlePriorityHit}` : "标题优先规则：无";
  return `${scorePart}；${priorityPart}；${filingPart}；${bidPart}；匹配模板类型：${matchedTemplateType}`;
}

function makeField(
  fieldKey: string,
  fieldName: string,
  value: string,
  sourceFile: string,
  text: string,
  evidenceKeyword: string,
  skillBasis: string,
  options?: {
    confidence?: number;
    status?: FieldStatus;
    reviewRequired?: boolean;
  }
): ExtractedField {
  const recognized = Boolean(value);
  const status = recognized ? options?.status ?? "recognized" : "missing";
  const confidence = recognized ? options?.confidence ?? 0.86 : 0.2;

  return {
    field_key: fieldKey,
    field_name: fieldName,
    value: recognized ? value : "missing",
    status,
    source_file: sourceFile,
    evidence_text: recognized ? excerpt(text, evidenceKeyword) || value : TEXT_NOT_FOUND,
    skill_basis: skillBasis,
    confidence,
    review_required: options?.reviewRequired ?? (!recognized || status === "uncertain" || confidence < 0.6),
    review_status: "pending",
    remark: ""
  };
}

function extractFields(text: string, fileName: string, aliasRules: FieldAliasRule[], materialType: string): ExtractedField[] {
  const projectNameRule = aliasRule(aliasRules, "project_name", "项目名称", ["项目名称", "采购项目名称"]);
  const projectIdRule = aliasRule(aliasRules, "project_id", "项目编号", ["项目编号", "采购项目编号", "招标编号", "项目编码"]);
  const procurementMethodRule = aliasRule(aliasRules, "procurement_method", "采购方式", ["采购方式", "招标方式", "采购形式"]);
  const purchaserRule = aliasRule(aliasRules, "purchaser", "采购人", ["采购人", "采购单位", "采购人名称"]);
  const agencyRule = aliasRule(aliasRules, "agency", "代理机构", ["代理机构", "采购代理机构", "招标代理机构", "代理公司"]);
  const budgetRule = aliasRule(aliasRules, "budget", "预算金额", ["预算金额", "采购预算", "采购包预算金额"]);
  const ceilingRule = aliasRule(aliasRules, "ceiling_price", "最高限价", ["最高限价", "采购包最高限价", "限价"]);
  const supplierRule = aliasRule(aliasRules, "supplier_name", "供应商名称", ["供应商名称", "供应商", "投标单位", "投标人"]);
  const openingRule = aliasRule(aliasRules, "bid_opening_time", "开标时间", ["开标时间", "开标日期"]);
  const packageRule = aliasRule(aliasRules, "package_info", "包件信息", ["包件", "分包", "采购包", "包号"]);

  const projectName = extractByAliases(text, projectNameRule.aliases) || extractByPatterns(text, [
    /\u9879\u76ee\u540d\u79f0[\uFF1A:\s]*([^\n\u3002\uFF1B;]+)/,
    /([^\u3002\n]{4,80}\u9879\u76ee)/
  ]);
  const projectId = extractByAliases(text, projectIdRule.aliases) || extractByPatterns(text, [
    /\u9879\u76ee\u7f16\u53f7[\uFF1A:\s]*([A-Za-z0-9\-_]+)/,
    /\u7f16\u53f7[\uFF1A:\s]*([A-Za-z0-9\-_]+)/
  ]);
  const procurementMethod = extractByAliases(text, procurementMethodRule.aliases) || detectProcurementMethod(text) || extractByPatterns(text, [
    /\u91c7\u8d2d\u65b9\u5f0f[\uFF1A:\s]*([^\n\u3002\uFF1B;]+)/
  ]);
  const purchaser = extractByAliases(text, purchaserRule.aliases) || extractByPatterns(text, [
    /\u91c7\u8d2d\u4eba[\uFF1A:\s]*([^\n\u3002\uFF1B;]+)/
  ]);
  const agency = extractByAliases(text, agencyRule.aliases) || extractByPatterns(text, [
    /(?:\u91c7\u8d2d\u4ee3\u7406\u673a\u6784|\u4ee3\u7406\u673a\u6784)[\uFF1A:\s]*([^\n\u3002\uFF1B;]+)/
  ]);
  const budget = extractByAliases(text, budgetRule.aliases) || extractByPatterns(text, [
    /(?:\u91c7\u8d2d\u9884\u7b97|\u9884\u7b97\u91d1\u989d|\u9884\u7b97)[\uFF1A:\s]*([0-9,，.]+(?:\u5143|\u4e07\u5143)?)/,
    /([0-9,，.]+(?:\u5143|\u4e07\u5143)?)\s*(?:\u91c7\u8d2d\u9884\u7b97|\u9884\u7b97\u91d1\u989d|\u9884\u7b97)/
  ]);
  const ceilingPrice = extractByAliases(text, ceilingRule.aliases) || extractByPatterns(text, [
    /(?:\u6700\u9ad8\u9650\u4ef7|\u6700\u9ad8\u9650\u4ef7\u91d1\u989d)[\uFF1A:\s]*([0-9,，.]+(?:\u5143|\u4e07\u5143)?)/,
    /([0-9,，.]+(?:\u5143|\u4e07\u5143)?)\s*(?:\u6700\u9ad8\u9650\u4ef7|\u6700\u9ad8\u9650\u4ef7\u91d1\u989d)/
  ]);
  const supplier = extractByAliases(text, supplierRule.aliases) || extractByPatterns(text, [
    /(?:\u4f9b\u5e94\u5546\u540d\u79f0|\u4f9b\u5e94\u5546|\u6295\u6807\u5355\u4f4d|\u6295\u6807\u4eba)[\uFF1A:\s]*([^\n\uff0c,\u3002\uFF1B;]+)/
  ]);
  const signupDeadline = extractByPatterns(text, [
    /(\d{4}\u5e74\d{1,2}\u6708\d{1,2}\u65e5)\u524d\u5b8c\u6210\u62a5\u540d/,
    /\u62a5\u540d\u622a\u6b62(?:\u65f6\u95f4)?[\uFF1A:\s]*([^\n\u3002\uFF1B;]+)/
  ]);
  const openingTime = extractByAliases(text, openingRule.aliases) || extractByPatterns(text, [
    /\u5f00\u6807\u65f6\u95f4\u4e3a?[\uFF1A:\s]*(\d{4}\u5e74\d{1,2}\u6708\d{1,2}\u65e5)/,
    /\u5f00\u6807\u65f6\u95f4[\uFF1A:\s]*([^\n\u3002\uFF1B;]+)/
  ]);
  const packageInfo = extractByAliases(text, packageRule.aliases) || extractByPatterns(text, [
    /(?:\u5305\u4ef6|\u5206\u5305)[\uFF1A:\s]*([^\n\u3002\uFF1B;]+)/
  ]);
  const sealStatus = includesAny(text, [
    "\u6682\u672a\u53d1\u73b0\u5b8c\u6574\u7b7e\u5b57\u76d6\u7ae0",
    "\u672a\u53d1\u73b0\u5b8c\u6574\u7b7e\u5b57\u76d6\u7ae0"
  ])
    ? "\u672a\u53d1\u73b0\u5b8c\u6574\u7b7e\u5b57\u76d6\u7ae0\u9875"
    : includesAny(text, ["\u7b7e\u5b57", "\u76d6\u7ae0", "\u516c\u7ae0"])
      ? "\u53d1\u73b0\u7b7e\u5b57/\u76d6\u7ae0\u76f8\u5173\u63cf\u8ff0"
      : "";

  return [
    makeField("project_name", "\u9879\u76ee\u540d\u79f0", projectName, fileName, text, "\u9879\u76ee\u540d\u79f0", "filing-skills/s2 basic info extraction: project name label or title pattern"),
    makeField("project_id", "\u9879\u76ee\u7f16\u53f7", projectId, fileName, text, "\u9879\u76ee\u7f16\u53f7", "filing-skills/s2 basic info extraction: project id label pattern"),
    makeField("material_type", "文件类型", materialType, fileName, text, materialType, "references/enterprise-templates/material-classification-rules.json: material type classification"),
    makeField("procurement_method", "\u91c7\u8d2d\u65b9\u5f0f", procurementMethod, fileName, text, "\u91c7\u8d2d\u65b9\u5f0f", "filing-skills/s2 basic info extraction: procurement method label pattern"),
    makeField("purchaser", "\u91c7\u8d2d\u4eba", purchaser, fileName, text, "\u91c7\u8d2d\u4eba", "filing-skills/s2 basic info extraction: purchaser label pattern"),
    makeField("agency", "\u4ee3\u7406\u673a\u6784", agency, fileName, text, "\u4ee3\u7406\u673a\u6784", "filing-skills/s2 basic info extraction: agency label pattern"),
    makeField("budget", "\u9884\u7b97\u91d1\u989d", budget, fileName, text, "\u9884\u7b97", "filing-skills/s2 basic info extraction: budget amount pattern"),
    makeField("ceiling_price", "\u6700\u9ad8\u9650\u4ef7", ceilingPrice, fileName, text, "\u6700\u9ad8\u9650\u4ef7", "filing-skills/s2 basic info extraction: ceiling price pattern"),
    makeField("supplier_name", "\u4f9b\u5e94\u5546\u540d\u79f0", supplier, fileName, text, supplier || "\u4f9b\u5e94\u5546", "filing-skills/s5 bid table generation: supplier/bidder keyword pattern"),
    makeField("signup_deadline", "\u62a5\u540d\u622a\u6b62\u65f6\u95f4", signupDeadline, fileName, text, "\u62a5\u540d", "filing-skills/s2 basic info extraction: signup deadline pattern"),
    makeField("bid_opening_time", "\u5f00\u6807\u65f6\u95f4", openingTime, fileName, text, "\u5f00\u6807", "filing-skills/s2 and s5: bid opening time pattern"),
    makeField("package_info", "\u5305\u4ef6\u4fe1\u606f", packageInfo, fileName, text, "\u5305\u4ef6", "filing-skills/s2 basic info extraction: package/subpackage pattern"),
    makeField("seal_status", "\u7b7e\u5b57\u76d6\u7ae0\u60c5\u51b5", sealStatus, fileName, text, "\u7b7e\u5b57", "filing-skills/s4 office template injector boundary: seal/signature requires manual review", {
      confidence: sealStatus ? 0.58 : undefined,
      status: sealStatus ? "uncertain" : undefined,
      reviewRequired: true
    }),
    makeField("source_file", "\u6750\u6599\u6765\u6e90\u6587\u4ef6", fileName, fileName, text, fileName, "system upload record: source file metadata")
  ];
}

function getField(fields: ExtractedField[], key: string) {
  const value = fields.find((field) => field.field_key === key)?.value;
  return value && value !== "missing" ? value : UNRECOGNIZED;
}

function getDraftField(fields: ExtractedField[], key: string) {
  const value = fields.find((field) => field.field_key === key)?.value;
  return value && value !== "missing" ? value : TO_BE_COMPLETED;
}

function buildDirectoryPlacement(
  text: string,
  fileName: string,
  filingRule: EnterpriseFilingRule,
  templateSource: TemplateSource
): DirectoryPlacement[] {
  return filingRule.directory_items.map((item) => {
    const matchedKeyword = item.accepted_keywords.find((keyword) => text.includes(keyword));
    const isSealItem = item.position.includes("\u7b7e\u5b57\u76d6\u7ae0") || item.required_material.includes("\u7b7e\u5b57");
    const sealExplicitlyMissing = isSealItem && includesAny(text, [
      "\u6682\u672a\u53d1\u73b0\u5b8c\u6574\u7b7e\u5b57\u76d6\u7ae0",
      "\u672a\u53d1\u73b0\u5b8c\u6574\u7b7e\u5b57\u76d6\u7ae0"
    ]);
    const placementStatus = sealExplicitlyMissing ? "manual_required" : matchedKeyword ? "placed" : "missing";

    return {
      template_position: item.position,
      required_material: item.required_material,
      recognized_material_type: matchedKeyword && !sealExplicitlyMissing ? item.required_material : UNRECOGNIZED,
      matched_file_name: matchedKeyword && !sealExplicitlyMissing ? fileName : "",
      placement_status: placementStatus,
      placement_basis: sealExplicitlyMissing
        ? "\u6587\u672c\u63d0\u793a\u6682\u672a\u53d1\u73b0\u5b8c\u6574\u7b7e\u5b57\u76d6\u7ae0\u9875\uff0c\u9700\u4eba\u5de5\u590d\u6838"
        : matchedKeyword
          ? `命中企业备案模板关键词：${matchedKeyword}；规则权重：${item.match_weight ?? 5}`
          : "\u672a\u5728\u4e0a\u4f20\u6587\u672c\u4e2d\u8bc6\u522b\u5230\u5bf9\u5e94\u6750\u6599\u7ebf\u7d22",
      skill_basis: `enterprise template filing rule: ${filingRule.rule_id}; source hint: ${filingRule.source_template_hint}`,
      template_source: templateSource,
      required: item.required,
      review_status: "pending",
      remark: ""
    };
  });
}

function buildDraftOutline(fields: ExtractedField[]): DraftOutline {
  return {
    draft_title: "\u5907\u6848\u6587\u4ef6\u521d\u7a3f",
    sections: [
      {
        section_title: "\u4e00\u3001\u9879\u76ee\u57fa\u672c\u4fe1\u606f",
        source_fields: ["project_name", "project_id", "procurement_method"],
        content_preview: `\u9879\u76ee\u540d\u79f0\uff1a${getDraftField(fields, "project_name")}\uff1b\u9879\u76ee\u7f16\u53f7\uff1a${getDraftField(fields, "project_id")}\uff1b\u91c7\u8d2d\u65b9\u5f0f\uff1a${getDraftField(fields, "procurement_method")}\u3002`
      },
      {
        section_title: "\u4e8c\u3001\u91c7\u8d2d\u8fc7\u7a0b\u6750\u6599",
        source_fields: ["purchaser", "signup_deadline"],
        content_preview: `\u91c7\u8d2d\u4eba\uff1a${getDraftField(fields, "purchaser")}\uff1b\u62a5\u540d\u622a\u6b62\u65f6\u95f4\uff1a${getDraftField(fields, "signup_deadline")}\u3002`
      },
      {
        section_title: "\u4e09\u3001\u62a5\u540d\u4e0e\u8d44\u683c\u6750\u6599",
        source_fields: ["supplier_name"],
        content_preview: `\u4f9b\u5e94\u5546/\u6295\u6807\u5355\u4f4d\uff1a${getDraftField(fields, "supplier_name")}\u3002`
      },
      {
        section_title: "\u56db\u3001\u5f00\u8bc4\u6807\u8fc7\u7a0b\u6750\u6599",
        source_fields: ["bid_opening_time"],
        content_preview: `\u5f00\u6807\u65f6\u95f4\uff1a${getDraftField(fields, "bid_opening_time")}\u3002`
      },
      {
        section_title: "\u4e94\u3001\u4e2d\u6807/\u6210\u4ea4\u7ed3\u679c\u6750\u6599",
        source_fields: ["supplier_name"],
        content_preview: `\u4e2d\u6807/\u6210\u4ea4\u5355\u4f4d\u6216\u4f9b\u5e94\u5546\uff1a${getDraftField(fields, "supplier_name")}\u3002`
      },
      {
        section_title: "\u516d\u3001\u7b7e\u5b57\u76d6\u7ae0\u4e0e\u5f52\u6863\u6750\u6599",
        source_fields: ["seal_status", "source_file"],
        content_preview: `\u7b7e\u5b57\u76d6\u7ae0\u60c5\u51b5\uff1a${getDraftField(fields, "seal_status")}\uff1b\u6765\u6e90\u6587\u4ef6\uff1a${getDraftField(fields, "source_file")}\u3002`
      }
    ]
  };
}

function extractSupplierRows(
  text: string,
  fileName: string,
  fields: ExtractedField[],
  templateSource: TemplateSource
): BidEvaluationRow[] {
  const rowsBySupplier = new Map<string, BidEvaluationRow>();
  const labeledSupplierPattern = /(?:供应商名称|投标单位|投标人|响应供应商|递交响应文件供应商|成交候选供应商|中标候选人)[：:\s]*([^\n，,。；;]+)/g;
  const companyPattern = /[\u4e00-\u9fa5A-Za-z0-9（）()·]{2,40}(?:有限责任公司|股份有限公司|信息技术有限公司|科技有限公司|有限公司|研究院|事务所|中心|公司)/g;
  const base = {
    project_name: getField(fields, "project_name") || MANUAL_FILL,
    project_id: getField(fields, "project_id") || MANUAL_FILL,
    bid_opening_time: pick([
      /(?:开标时间|询价时间|磋商时间|谈判时间|评审时间)[：:\s]*([^\n。；;]+)/,
      /(\d{4}年\d{1,2}月\d{1,2}日(?:\d{1,2}[时:：]\d{1,2}分?)?)/
    ], text),
    procurement_method: getField(fields, "procurement_method") || MANUAL_FILL
  };

  const buildRow = (supplierName: string, sourceText: string, index: number): BidEvaluationRow => {
    const supplier = supplierName || MANUAL_FILL;
    const sourceScope = supplierName ? (sourceText.trim() || excerpt(text, supplierName)) : TEXT_NOT_FOUND;
    const bidPrice = supplierName
      ? extractByPatterns(sourceText, [
          /(?:投标报价|最后报价|响应报价|报价|成交金额|中标金额)[：:\s人民币]*([0-9,，.]+(?:元|万元)?)/,
          /人民币\s*([0-9,，.]+(?:元|万元)?)/,
          /([0-9,，.]+(?:元|万元))/
        ])
      : "";
    const qualification = supplierName
      ? extractByPatterns(sourceText, [
          /(?:资格审查结果|资格性审查结果|资格审查|资格性审查)[：:\s]*(通过|不通过|合格|不合格)/
        ])
      : "";
    const compliance = supplierName
      ? extractByPatterns(sourceText, [
          /(?:符合性审查结果|符合性审查)[：:\s]*(通过|不通过|合格|不合格)/
        ])
      : "";
    const responsiveness = supplierName
      ? extractByPatterns(sourceText, [
          /(?:响应性审查结果|响应性审查)[：:\s]*(通过|不通过|合格|不合格)/
        ])
      : "";
    const score = supplierName
      ? extractByPatterns(sourceText, [
          /(?:评审得分|综合得分|最终得分|总分|得分)[：:\s]*([0-9.]+分?)/
        ])
      : "";
    const ranking = supplierName
      ? extractByPatterns(sourceText, [
          /(?:排名|名次|排序)[：:\s]*([0-9一二三四五六七八九十第名]+)/,
          /(第[一二三四五六七八九十0-9]+名)/
        ])
      : "";
    const candidateOrder = supplierName
      ? extractByPatterns(sourceText, [
          /((?:第一|第二|第三|第[0-9]+)(?:中标|成交)候选人)/
        ]) || extractNearby(text, supplierName, [/((?:第一|第二|第三|第[0-9]+)(?:中标|成交)候选人)/])
      : "";
    const submitTime = supplierName
      ? extractByPatterns(sourceText, [
          /(?:递交时间|送达时间)[：:\s]*(\d{4}年\d{1,2}月\d{1,2}日[0-9:：时分\s]*)/,
          /(\d{4}年\d{1,2}月\d{1,2}日[0-9:：时分\s]*)/
        ])
      : "";
    const contactPhone = supplierName
      ? extractByPatterns(sourceText, [
          /(?:联系方式|联系电话|手机)[：:\s]*(1[3-9]\d{9}|0\d{2,3}-?\d{7,8})/,
          /(1[3-9]\d{9})/
        ])
      : "";
    const contactPerson = supplierName
      ? extractByPatterns(sourceText, [
          /(?:联系人|递交人)[：:\s]*([\u4e00-\u9fa5]{2,4})/
        ])
      : "";
    return {
      row_id: `bid_${String(index + 1).padStart(3, "0")}`,
      project_name: base.project_name,
      project_id: base.project_id,
      bid_opening_time: base.bid_opening_time,
      procurement_method: base.procurement_method,
      supplier_name: supplier,
      contact_person: contactPerson || MANUAL_FILL,
      contact_phone: contactPhone || MANUAL_FILL,
      submit_time: submitTime || MANUAL_FILL,
      seal_check_result: MANUAL_FILL,
      fail_reason: MANUAL_FILL,
      supplier_signature: MANUAL_FILL,
      bid_price: bidPrice || MANUAL_FILL,
      qualification_status: qualification || MANUAL_FILL,
      compliance_result: compliance || MANUAL_FILL,
      responsiveness_result: responsiveness || MANUAL_FILL,
      score: score || MANUAL_FILL,
      ranking: ranking || MANUAL_FILL,
      candidate_order: candidateOrder || MANUAL_FILL,
      source_file: fileName,
      evidence_text: sourceScope,
      skill_basis: "供应商名称锚点 + 开评标字段正则抽取",
      template_source: templateSource,
      review_required: [contactPerson, contactPhone, bidPrice, qualification, score, ranking].some((value) => !value),
      review_status: "pending",
      remark: ""
    };
  };

  const upsertRow = (supplierName: string, sourceText: string) => {
    const name = cleanSupplierName(supplierName);
    if (!name || hasExcludedSupplierContext(text, name)) return;
    const next = buildRow(name, sourceText, rowsBySupplier.size);
    const current = rowsBySupplier.get(name);
    if (!current) {
      rowsBySupplier.set(name, next);
      return;
    }
    rowsBySupplier.set(name, {
      ...current,
      contact_person: mergeTextValue(current.contact_person, next.contact_person),
      contact_phone: mergeTextValue(current.contact_phone, next.contact_phone),
      submit_time: mergeTextValue(current.submit_time, next.submit_time),
      bid_price: mergeTextValue(current.bid_price, next.bid_price),
      qualification_status: mergeTextValue(current.qualification_status, next.qualification_status),
      compliance_result: mergeTextValue(current.compliance_result, next.compliance_result),
      responsiveness_result: mergeTextValue(current.responsiveness_result, next.responsiveness_result),
      score: mergeTextValue(current.score, next.score),
      ranking: mergeTextValue(current.ranking, next.ranking),
      candidate_order: mergeTextValue(current.candidate_order, next.candidate_order),
      evidence_text: current.evidence_text.includes(sourceText.trim()) ? current.evidence_text : `${current.evidence_text}\n${sourceText.trim()}`.trim(),
      review_required: current.review_required || next.review_required
    });
  };

  const structuredBlockPattern = /供应商记录开始[：:\s]*([^\n\r]+)[\s\S]*?供应商记录结束[：:\s]*\1/g;
  let blockMatch: RegExpExecArray | null;
  while ((blockMatch = structuredBlockPattern.exec(text)) !== null) {
    const block = blockMatch[0];
    const name = extractBlockValue(block, ["供应商名称", "投标单位/供应商名称", "投标单位", "投标人", "响应供应商", "成交候选供应商", "中标候选人"]);
    upsertRow(name, block);
  }

  if (!rowsBySupplier.size) {
    let match: RegExpExecArray | null;
    while ((match = labeledSupplierPattern.exec(text)) !== null) {
      const rawName = match[1] ?? "";
      const start = Math.max(0, match.index - 40);
      const sourceText = text.slice(start, match.index + rawName.length + 280);
      if (hasBidRowSignal(sourceText)) upsertRow(rawName, sourceText);
    }

    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    lines.forEach((line) => {
      if (!hasBidRowSignal(line)) return;
      const names = Array.from(line.matchAll(companyPattern)).map((item) => item[0]);
      names.forEach((name) => upsertRow(name, line));
    });
  }

  if (!rowsBySupplier.size) {
    let match: RegExpExecArray | null;
    while ((match = companyPattern.exec(text)) !== null) {
      const name = match[0] ?? "";
      const scope = text.slice(Math.max(0, match.index - 80), match.index + name.length + 240);
      if (hasBidRowSignal(scope) && !/评标委员会一致推荐|采购代理机构|采购人|监督代表|记录人/.test(scope)) {
        upsertRow(name, scope);
      }
    }
  }

  const rows = Array.from(rowsBySupplier.values()).map((row, index) => ({
    ...row,
    row_id: `bid_${String(index + 1).padStart(3, "0")}`
  }));
  return rows.length ? rows : [buildRow("", TEXT_NOT_FOUND, 0)];
}

function bidTableModules() {
  return [
    { module_id: "delivery_record", module_name: "投标文件递交记录表", columns: ["序号", "投标单位/供应商名称", "递交时间", "联系人", "联系方式", "备注"] },
    { module_id: "seal_check", module_name: "投标文件密封性检查表", columns: ["序号", "投标单位/供应商名称", "密封性检查结果", "不合格原因", "供应商签字确认", "备注"] },
    { module_id: "qualification_review", module_name: "资格审查表", columns: ["序号", "投标单位/供应商名称", "资格审查结果", "不通过原因", "备注"] },
    { module_id: "responsiveness_review", module_name: "符合性 / 响应性审查表", columns: ["序号", "投标单位/供应商名称", "符合性审查结果", "响应性审查结果", "不通过原因", "备注"] },
    { module_id: "score_summary", module_name: "评分汇总表", columns: ["序号", "投标单位/供应商名称", "投标报价", "评审得分", "排名", "备注"] },
    { module_id: "candidate_recommendation", module_name: "中标候选人推荐表", columns: ["序号", "投标单位/供应商名称", "投标报价", "排名", "中标/成交候选顺序", "备注"] }
  ];
}

export function analyzeWithSkills(input: AnalyzeInput): SkillAnalysisResult {
  const templateRules = loadTemplateRules();
  const text = input.text.trim();
  const classification = classifyMaterial(
    text,
    input.fileType,
    templateRules.materialClassificationRules,
    templateRules.bidRule
  );
  const fields = extractFields(text, input.fileName, templateRules.fieldAliasRules, classification.materialType);
  const procurementMethod = getField(fields, "procurement_method") === UNRECOGNIZED
    ? detectProcurementMethod(text)
    : getField(fields, "procurement_method");
  const taskType = classification.taskType;
  const templateType = matchedTemplateType(taskType, procurementMethod, templateRules.templateIndex);
  const basicTemplates = matchedBasicTemplates(taskType, templateRules.basicTemplates);
  const shouldBuildFiling = taskType === "filing_document" || taskType === "mixed" || taskType === "unknown";
  const shouldBuildBid = taskType === "bid_evaluation_table" || taskType === "mixed" || taskType === "unknown";
  const bidRows = shouldBuildBid
    ? extractSupplierRows(
        text,
        input.fileName,
        fields,
        templateRules.templateSource
      )
    : [];
  const bidAnalysis: BidAnalysis | undefined = shouldBuildBid
    ? {
        template_id: "bid_open_tender_form",
        template_name: "公开招标开评标表格模板",
        project_fields: {
          project_name: getField(fields, "project_name") || MANUAL_FILL,
          project_id: getField(fields, "project_id") || MANUAL_FILL,
          procurement_method: getField(fields, "procurement_method") || MANUAL_FILL,
          purchaser: getField(fields, "purchaser") || MANUAL_FILL,
          agency: getField(fields, "agency") || MANUAL_FILL,
          bid_opening_time: getField(fields, "bid_opening_time") || MANUAL_FILL,
          bid_opening_place: pick([/(?:开标地点|询价地点|磋商地点|谈判地点|评审地点)[：:\s]*([^\n。；;]+)/], text),
          review_time: pick([/(?:评审时间|开标时间|询价时间|磋商时间|谈判时间)[：:\s]*([^\n。；;]+)/], text),
          review_place: pick([/(?:评审地点|开标地点|询价地点|磋商地点|谈判地点)[：:\s]*([^\n。；;]+)/], text)
        },
        supplier_rows: bidRows,
        table_modules: bidTableModules()
      }
    : undefined;
  const warnings = [];

  if (!text) {
    warnings.push({ type: "empty_text", message: "No readable text was found. Upload a .txt file or paste text manually." });
  }
  if (taskType === "unknown") {
    warnings.push({ type: "task_type_unknown", message: "Task type could not be determined automatically. Please choose a path manually." });
  }

  return {
    review_id: `review_${Date.now()}`,
    upload_id: input.uploadId,
    source: "skill_rule",
    source_file: {
      file_name: input.fileName,
      file_type: input.fileType,
      file_size: input.fileSize
    },
    parsed_text: text,
    material_type: classification.materialType,
    task_type: taskType,
    task_basis: buildTaskBasis(classification, templateType),
    matched_template_type: templateType,
    matched_basic_templates: basicTemplates,
    rule_source: "references/enterprise-templates",
    template_source: templateRules.templateSource,
    extracted_fields: fields,
    directory_placement: shouldBuildFiling
      ? buildDirectoryPlacement(
          text,
          input.fileName,
          templateRules.filingRule,
          templateRules.templateSource
        )
      : [],
    bid_evaluation_table: bidRows,
    bid_analysis: bidAnalysis,
    draft_outline: shouldBuildFiling ? buildDraftOutline(fields) : { draft_title: "备案文件初稿", sections: [] },
    warnings,
    skill_basis: [
      "filing-skills/s2-filing-basic-info-extractor",
      "filing-skills/s3-filing-directory-matcher",
      "filing-skills/s5-bid-evaluation-table-generator",
      "references/enterprise-templates/filing-template-rules.json",
      "references/enterprise-templates/bid-table-template-rules.json",
      "references/enterprise-templates/field-alias-rules.json",
      "references/enterprise-templates/material-classification-rules.json",
      "references/enterprise-templates/basic-template-index.json",
      "references/enterprise-templates/filing-basic-template.json",
      "references/enterprise-templates/bid-evaluation-basic-template.json",
      "references/enterprise-templates/template-routing-rules.json"
    ],
    review_required: fields.some((field) => field.review_required) || taskType === "unknown"
  };
}
