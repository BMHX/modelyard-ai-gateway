import type { PromptActivityLabel, PromptRiskCategory } from "@teamops/contracts";

export type RuleSeverity = "low" | "medium" | "high" | "critical";
export type RulePatternType = "phrase" | "regex" | "structural" | "cooccurrence";

export type InspectionRule = {
  ruleId: string;
  version: 1;
  riskCategory: PromptRiskCategory;
  severity: RuleSeverity;
  patternType: RulePatternType;
  weight: number;
  activityLabel?: PromptActivityLabel;
  phrase?: string;
  regex?: RegExp;
};

export type InspectionCooccurrenceGroup = {
  ruleId: string;
  version: 1;
  riskCategory: PromptRiskCategory;
  severity: RuleSeverity;
  patternType: "cooccurrence";
  weight: number;
  terms: string[];
};

export type PromptInspectionCatalog = {
  criticalSecretPatterns: RegExp[];
  phraseRules: InspectionRule[];
  regexRules: InspectionRule[];
  structuralRules: Record<string, InspectionRule>;
  cooccurrenceGroups: InspectionCooccurrenceGroup[];
};

const riskCategoryValues = new Set<PromptRiskCategory>([
  "secret_exfiltration",
  "credential_exposure",
  "pii_exposure",
  "customer_data_export",
  "external_business",
  "personal_use",
  "policy_evasion",
  "suspicious_obfuscation",
]);
const severityValues = new Set<RuleSeverity>(["low", "medium", "high", "critical"]);
const patternTypeValues = new Set<RulePatternType>(["phrase", "regex", "structural", "cooccurrence"]);

function normalizePhraseDefinition(value: string) {
  return value.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
}

const credentialPhraseRules: InspectionRule[] = [
  { ruleId: "secret.api-key", version: 1, riskCategory: "secret_exfiltration", severity: "high", patternType: "phrase", weight: 65, phrase: "api key" },
  { ruleId: "secret.client-secret", version: 1, riskCategory: "secret_exfiltration", severity: "high", patternType: "phrase", weight: 65, phrase: "client secret" },
  { ruleId: "secret.access-token", version: 1, riskCategory: "credential_exposure", severity: "high", patternType: "phrase", weight: 70, phrase: "access token" },
  { ruleId: "secret.refresh-token", version: 1, riskCategory: "credential_exposure", severity: "high", patternType: "phrase", weight: 65, phrase: "refresh token" },
  { ruleId: "secret.cookie", version: 1, riskCategory: "credential_exposure", severity: "high", patternType: "phrase", weight: 60, phrase: "cookie" },
  { ruleId: "secret.session", version: 1, riskCategory: "credential_exposure", severity: "high", patternType: "phrase", weight: 55, phrase: "session token" },
  { ruleId: "secret.session-cookie", version: 1, riskCategory: "credential_exposure", severity: "high", patternType: "phrase", weight: 60, phrase: "session cookie" },
  { ruleId: "secret.bearer-token", version: 1, riskCategory: "credential_exposure", severity: "high", patternType: "phrase", weight: 65, phrase: "bearer token" },
  { ruleId: "secret.private-key", version: 1, riskCategory: "secret_exfiltration", severity: "critical", patternType: "phrase", weight: 100, phrase: "private key" },
  { ruleId: "secret.ssh-key", version: 1, riskCategory: "secret_exfiltration", severity: "critical", patternType: "phrase", weight: 100, phrase: "ssh key" },
  { ruleId: "secret.db-conn", version: 1, riskCategory: "secret_exfiltration", severity: "critical", patternType: "phrase", weight: 100, phrase: "数据库连接串" },
  { ruleId: "secret.private-endpoint", version: 1, riskCategory: "secret_exfiltration", severity: "high", patternType: "phrase", weight: 60, phrase: "private endpoint" },
];

const customerExportPhraseRules: InspectionRule[] = [
  { ruleId: "customer.contact-list", version: 1, riskCategory: "customer_data_export", severity: "high", patternType: "phrase", weight: 55, phrase: "联系人清单" },
  { ruleId: "customer.contact-sheet", version: 1, riskCategory: "customer_data_export", severity: "high", patternType: "phrase", weight: 55, phrase: "联系人表" },
  { ruleId: "customer.customer-list", version: 1, riskCategory: "customer_data_export", severity: "high", patternType: "phrase", weight: 60, phrase: "客户名单" },
  { ruleId: "customer.mail-list", version: 1, riskCategory: "customer_data_export", severity: "high", patternType: "phrase", weight: 55, phrase: "邮件列表" },
  { ruleId: "customer.email-list", version: 1, riskCategory: "customer_data_export", severity: "high", patternType: "phrase", weight: 55, phrase: "邮箱清单" },
  { ruleId: "customer.phone-list", version: 1, riskCategory: "pii_exposure", severity: "high", patternType: "phrase", weight: 25, phrase: "手机号列表" },
  { ruleId: "customer.export", version: 1, riskCategory: "customer_data_export", severity: "high", patternType: "phrase", weight: 60, phrase: "导出客户" },
];

const externalBusinessPhraseRules: InspectionRule[] = [
  { ruleId: "external.quote", version: 1, riskCategory: "external_business", severity: "high", patternType: "phrase", weight: 55, phrase: "报价" },
  { ruleId: "external.quote-sheet", version: 1, riskCategory: "external_business", severity: "high", patternType: "phrase", weight: 55, phrase: "报价单" },
  { ruleId: "external.contract", version: 1, riskCategory: "external_business", severity: "high", patternType: "phrase", weight: 55, phrase: "合同" },
  { ruleId: "external.sow", version: 1, riskCategory: "external_business", severity: "high", patternType: "phrase", weight: 60, phrase: "statement of work" },
  { ruleId: "external.proposal", version: 1, riskCategory: "external_business", severity: "high", patternType: "phrase", weight: 55, phrase: "proposal" },
  { ruleId: "external.delivery", version: 1, riskCategory: "external_business", severity: "high", patternType: "phrase", weight: 50, phrase: "交付" },
  { ruleId: "external.client-delivery", version: 1, riskCategory: "external_business", severity: "high", patternType: "phrase", weight: 50, phrase: "客户交付" },
  { ruleId: "external.send-client", version: 1, riskCategory: "external_business", severity: "high", patternType: "phrase", weight: 55, phrase: "发给客户" },
];

const personalUsePhraseRules: InspectionRule[] = [
  { ruleId: "personal.resume", version: 1, riskCategory: "personal_use", severity: "high", patternType: "phrase", weight: 60, phrase: "简历" },
  { ruleId: "personal.resume-polish", version: 1, riskCategory: "personal_use", severity: "high", patternType: "phrase", weight: 60, phrase: "润色简历" },
  { ruleId: "personal.resume-optimize", version: 1, riskCategory: "personal_use", severity: "high", patternType: "phrase", weight: 60, phrase: "简历优化" },
  { ruleId: "personal.interview", version: 1, riskCategory: "personal_use", severity: "medium", patternType: "phrase", weight: 35, phrase: "面试" },
  { ruleId: "personal.interview-questions", version: 1, riskCategory: "personal_use", severity: "high", patternType: "phrase", weight: 35, phrase: "面试题" },
  { ruleId: "personal.interview-prep", version: 1, riskCategory: "personal_use", severity: "high", patternType: "phrase", weight: 40, phrase: "面试准备" },
  { ruleId: "personal.job-search", version: 1, riskCategory: "personal_use", severity: "high", patternType: "phrase", weight: 60, phrase: "求职" },
  { ruleId: "personal.job-application", version: 1, riskCategory: "personal_use", severity: "high", patternType: "phrase", weight: 60, phrase: "求职申请" },
  { ruleId: "personal.cover-letter", version: 1, riskCategory: "personal_use", severity: "high", patternType: "phrase", weight: 60, phrase: "求职信" },
  { ruleId: "personal.freelance", version: 1, riskCategory: "personal_use", severity: "high", patternType: "phrase", weight: 50, phrase: "自由职业" },
  { ruleId: "personal.side-job", version: 1, riskCategory: "personal_use", severity: "high", patternType: "phrase", weight: 50, phrase: "私活" },
  { ruleId: "personal.travel", version: 1, riskCategory: "personal_use", severity: "medium", patternType: "phrase", weight: 25, phrase: "旅游攻略" },
  { ruleId: "personal.itinerary", version: 1, riskCategory: "personal_use", severity: "medium", patternType: "phrase", weight: 20, phrase: "行程安排" },
  { ruleId: "personal.hotel", version: 1, riskCategory: "personal_use", severity: "medium", patternType: "phrase", weight: 25, phrase: "酒店" },
  { ruleId: "personal.hotel-recommend", version: 1, riskCategory: "personal_use", severity: "medium", patternType: "phrase", weight: 25, phrase: "酒店推荐" },
  { ruleId: "personal.shopping", version: 1, riskCategory: "personal_use", severity: "medium", patternType: "phrase", weight: 20, phrase: "购物清单" },
];

const policyEvasionPhraseRules: InspectionRule[] = [
  { ruleId: "evasion.avoid-logging", version: 1, riskCategory: "policy_evasion", severity: "high", patternType: "phrase", weight: 60, phrase: "不要记录" },
  { ruleId: "evasion.avoid-admin", version: 1, riskCategory: "policy_evasion", severity: "high", patternType: "phrase", weight: 60, phrase: "不要让管理员看到" },
  { ruleId: "evasion.no-trace", version: 1, riskCategory: "policy_evasion", severity: "high", patternType: "phrase", weight: 60, phrase: "不要留痕" },
  { ruleId: "evasion.no-audit", version: 1, riskCategory: "policy_evasion", severity: "high", patternType: "phrase", weight: 60, phrase: "不要审计" },
  { ruleId: "evasion.skip-policy", version: 1, riskCategory: "policy_evasion", severity: "high", patternType: "phrase", weight: 60, phrase: "忽略策略" },
  { ruleId: "evasion.bypass", version: 1, riskCategory: "policy_evasion", severity: "high", patternType: "phrase", weight: 60, phrase: "绕过检测" },
  { ruleId: "evasion.skip-log", version: 1, riskCategory: "policy_evasion", severity: "high", patternType: "phrase", weight: 60, phrase: "别记日志" },
];

const activityPhraseRules: InspectionRule[] = [
  { ruleId: "activity.code", version: 1, riskCategory: "personal_use", severity: "low", patternType: "phrase", weight: 6, phrase: "bug", activityLabel: "debugging" },
  { ruleId: "activity.debug", version: 1, riskCategory: "personal_use", severity: "low", patternType: "phrase", weight: 8, phrase: "stack trace", activityLabel: "debugging" },
  { ruleId: "activity.test", version: 1, riskCategory: "personal_use", severity: "low", patternType: "phrase", weight: 8, phrase: "test case", activityLabel: "testing" },
  { ruleId: "activity.docs", version: 1, riskCategory: "personal_use", severity: "low", patternType: "phrase", weight: 8, phrase: "documentation", activityLabel: "documentation" },
  { ruleId: "activity.translate", version: 1, riskCategory: "personal_use", severity: "low", patternType: "phrase", weight: 8, phrase: "translate", activityLabel: "translation" },
  { ruleId: "activity.research", version: 1, riskCategory: "personal_use", severity: "low", patternType: "phrase", weight: 8, phrase: "research", activityLabel: "research" },
];

export const phraseRules = [
  ...credentialPhraseRules,
  ...customerExportPhraseRules,
  ...externalBusinessPhraseRules,
  ...personalUsePhraseRules,
  ...policyEvasionPhraseRules,
  ...activityPhraseRules,
];

const credentialRegexRules: InspectionRule[] = [
  { ruleId: "regex.anthropic-key", version: 1, riskCategory: "secret_exfiltration", severity: "critical", patternType: "regex", weight: 100, regex: /sk-ant-api03-[A-Za-z0-9_-]{20,}/gi },
  { ruleId: "regex.generic-key", version: 1, riskCategory: "credential_exposure", severity: "critical", patternType: "regex", weight: 100, regex: /\bsk-[A-Za-z0-9]{20,}\b/gi },
  { ruleId: "regex.private-key", version: 1, riskCategory: "secret_exfiltration", severity: "critical", patternType: "regex", weight: 120, regex: /-----BEGIN (?:RSA|OPENSSH|DSA|EC|PGP) PRIVATE KEY-----/gi },
  { ruleId: "regex.jwt", version: 1, riskCategory: "credential_exposure", severity: "critical", patternType: "regex", weight: 90, regex: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9._-]{8,}\.[A-Za-z0-9._-]{8,}\b/gi },
  { ruleId: "regex.bearer", version: 1, riskCategory: "credential_exposure", severity: "critical", patternType: "regex", weight: 90, regex: /\bbearer\s+[a-z0-9._-]{20,}\b/gi },
  { ruleId: "regex.connection-string", version: 1, riskCategory: "secret_exfiltration", severity: "critical", patternType: "regex", weight: 110, regex: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s]+/gi },
];

const piiRegexRules: InspectionRule[] = [
  {
    ruleId: "regex.email",
    version: 1,
    riskCategory: "pii_exposure",
    severity: "medium",
    patternType: "regex",
    weight: 12,
    regex: /(?<![:/])\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b(?!:)/gi,
  },
  {
    ruleId: "regex.phone",
    version: 1,
    riskCategory: "pii_exposure",
    severity: "medium",
    patternType: "regex",
    weight: 10,
    regex: /(?<![A-Za-z0-9])(?:\+?\d[\d\s().-]{7,}\d)(?![A-Za-z0-9])/g,
  },
];

export const regexRules = [...credentialRegexRules, ...piiRegexRules];

export const structuralRules = {
  bulkEmail: {
    ruleId: "struct.bulk-email",
    version: 1,
    riskCategory: "customer_data_export",
    severity: "high",
    patternType: "structural",
    weight: 60,
  },
  bulkPhone: {
    ruleId: "struct.bulk-phone",
    version: 1,
    riskCategory: "pii_exposure",
    severity: "high",
    patternType: "structural",
    weight: 35,
  },
  bulkDomain: {
    ruleId: "struct.bulk-domain",
    version: 1,
    riskCategory: "external_business",
    severity: "medium",
    patternType: "structural",
    weight: 35,
  },
  tabularExport: {
    ruleId: "struct.tabular-export",
    version: 1,
    riskCategory: "customer_data_export",
    severity: "medium",
    patternType: "structural",
    weight: 35,
  },
  secretObfuscated: {
    ruleId: "struct.secret-obfuscated",
    version: 1,
    riskCategory: "suspicious_obfuscation",
    severity: "critical",
    patternType: "structural",
    weight: 120,
  },
} satisfies Record<string, InspectionRule>;

export const cooccurrenceGroups: InspectionCooccurrenceGroup[] = [
  { ruleId: "co.resume-polish", version: 1, riskCategory: "personal_use", severity: "high", patternType: "cooccurrence", weight: 35, terms: ["简历", "润色"] },
  { ruleId: "co.resume-interview", version: 1, riskCategory: "personal_use", severity: "high", patternType: "cooccurrence", weight: 45, terms: ["简历", "面试"] },
  { ruleId: "co.resume-job-search", version: 1, riskCategory: "personal_use", severity: "high", patternType: "cooccurrence", weight: 45, terms: ["简历", "求职"] },
  { ruleId: "co.interview-prep", version: 1, riskCategory: "personal_use", severity: "high", patternType: "cooccurrence", weight: 20, terms: ["面试", "准备"] },
  { ruleId: "co.customer-quote", version: 1, riskCategory: "external_business", severity: "high", patternType: "cooccurrence", weight: 60, terms: ["客户", "报价"] },
  { ruleId: "co.customer-delivery", version: 1, riskCategory: "external_business", severity: "high", patternType: "cooccurrence", weight: 55, terms: ["客户", "交付"] },
  { ruleId: "co.export-email", version: 1, riskCategory: "customer_data_export", severity: "high", patternType: "cooccurrence", weight: 55, terms: ["导出", "邮箱"] },
  { ruleId: "co.token-send", version: 1, riskCategory: "secret_exfiltration", severity: "high", patternType: "cooccurrence", weight: 75, terms: ["token", "发给"] },
  { ruleId: "co.cookie-bearer", version: 1, riskCategory: "credential_exposure", severity: "high", patternType: "cooccurrence", weight: 80, terms: ["cookie", "bearer"] },
];

export const criticalSecretPatterns = [
  /sk-ant-api03-[A-Za-z0-9_-]{20,}/i,
  /sk-[A-Za-z0-9]{20,}/i,
  /-----BEGIN (?:RSA|OPENSSH|DSA|EC|PGP) PRIVATE KEY-----/i,
  /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s]+/i,
  /\bbearer\s+[a-z0-9._-]{20,}\b/i,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9._-]{8,}\.[A-Za-z0-9._-]{8,}\b/i,
];

export function validatePromptInspectionCatalog(catalog: PromptInspectionCatalog) {
  const seenRuleIds = new Set<string>();
  const seenPhrases = new Set<string>();
  const rules = [
    ...catalog.phraseRules,
    ...catalog.regexRules,
    ...Object.values(catalog.structuralRules),
    ...catalog.cooccurrenceGroups,
  ];

  for (const rule of rules) {
    if (seenRuleIds.has(rule.ruleId)) {
      throw new Error(`Duplicate prompt inspection ruleId: ${rule.ruleId}`);
    }
    seenRuleIds.add(rule.ruleId);

    if (!riskCategoryValues.has(rule.riskCategory)) {
      throw new Error(`Invalid prompt inspection risk category: ${rule.ruleId}`);
    }
    if (!severityValues.has(rule.severity)) {
      throw new Error(`Invalid prompt inspection severity: ${rule.ruleId}`);
    }
    if (!patternTypeValues.has(rule.patternType)) {
      throw new Error(`Invalid prompt inspection pattern type: ${rule.ruleId}`);
    }

    if ("phrase" in rule && typeof rule.phrase === "string") {
      const normalizedPhrase = normalizePhraseDefinition(rule.phrase);
      if (seenPhrases.has(normalizedPhrase)) {
        throw new Error(`Duplicate prompt inspection phrase definition: ${rule.phrase}`);
      }
      seenPhrases.add(normalizedPhrase);
    }

    if ("terms" in rule) {
      if (!Array.isArray(rule.terms) || rule.terms.length < 2 || rule.terms.some((term) => !term.trim())) {
        throw new Error(`Invalid prompt inspection cooccurrence terms: ${rule.ruleId}`);
      }
    }
  }
}

export const promptInspectionCatalog = (() => {
  const catalog: PromptInspectionCatalog = {
    criticalSecretPatterns,
    phraseRules,
    regexRules,
    structuralRules,
    cooccurrenceGroups,
  };
  validatePromptInspectionCatalog(catalog);
  return catalog;
})();
