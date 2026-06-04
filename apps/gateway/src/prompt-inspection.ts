import type {
  PromptActivityLabel,
  PromptInspectionVerdict,
  PromptPolicy,
  PromptRiskCategory,
  VirtualKey,
} from "@teamops/contracts";

import type { GatewayRequestPath } from "./protocol.js";
import {
  criticalSecretPatterns,
  cooccurrenceGroups,
  phraseRules,
  regexRules,
  structuralRules,
  type InspectionRule,
  type RuleSeverity,
} from "./prompt-inspection-data/catalog.js";

type InspectionHit = {
  ruleId: string;
  riskCategory: PromptRiskCategory;
  severity: RuleSeverity;
  weight: number;
  activityLabel?: PromptActivityLabel;
  evidence: string;
  range: {
    start: number;
    end: number;
  };
};

type InspectionContextEvent = {
  at: number;
  verdict: PromptInspectionVerdict;
  riskCategories: PromptRiskCategory[];
  simhash: string | null;
};

type InspectionContextBucket = {
  events: InspectionContextEvent[];
  lastSeenAt: number;
};

type InspectionContextCounts = {
  reviewCount15m: number;
  blockCount1h: number;
  sameRisk15m: number;
  repeatedSimhash24h: number;
  escalated: boolean;
};

export type PromptInspectionDecision = {
  verdict: PromptInspectionVerdict;
  score: number;
  topActivityLabel: PromptActivityLabel;
  riskCategories: PromptRiskCategory[];
  hitRuleIds: string[];
  redactedEvidence: string[];
  simhash: string | null;
  truncated: boolean;
  contextCounts: InspectionContextCounts;
  shouldPersist: boolean;
  shouldCreateAlert: boolean;
  blockMessage: string | null;
  metadataSummary: {
    inspectionVerdict: PromptInspectionVerdict;
    inspectionScore: number;
    inspectionRiskCategories: PromptRiskCategory[];
    inspectionTopLabel: PromptActivityLabel;
  };
};

const textBudgetBytes = 16 * 1024;
const maxFragments = 256;
const maxDepth = 6;
const maxEvidenceCount = 3;
const maxEvidenceLength = 160;
const maxContextKeys = 2_048;
const maxEventsPerContextKey = 64;
const zeroWidthPattern = /[\u200B-\u200D\uFEFF]/g;
const collapseWhitespacePattern = /\s+/g;
const repeatedPunctuationPattern = /([!?.,:;])\1+/g;
const emailPattern = /(?<![:/])\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b(?!:)/gi;
const phonePattern = /(?<![A-Za-z0-9])(?:\+?\d[\d\s().-]{7,}\d)(?![A-Za-z0-9])/g;
const longDigitPattern = /\b\d{8,}\b/g;
const longTokenPattern = /\b[A-Za-z0-9_/-]{16,}\b/g;
const domainPattern = /\b(?:https?:\/\/)?([a-z0-9.-]+\.[a-z]{2,})(?:\/[^\s]*)?/gi;
const lineSplitPattern = /\r?\n/;
const ignoredDirectStringKeys = new Set([
  "id",
  "model",
  "provider",
  "providerid",
  "providername",
  "requestid",
  "providerrequestid",
  "role",
  "type",
  "url",
  "uri",
  "format",
  "mimetype",
  "contenttype",
  "tool",
  "toolname",
  "toolchoice",
  "name",
]);
const contextStore = new Map<string, InspectionContextBucket>();

function clampSnippet(value: string) {
  return value.trim().slice(0, maxEvidenceLength);
}

function normalizeText(value: string) {
  return value
    .normalize("NFKC")
    .replace(zeroWidthPattern, "")
    .toLowerCase()
    .replace(repeatedPunctuationPattern, "$1")
    .replace(collapseWhitespacePattern, " ")
    .trim();
}

function normalizeInspectionKey(value: string) {
  return value.trim().toLowerCase().replace(/[_-]+/g, "");
}

function collectVisibleText(
  value: unknown,
  parts: string[],
  budget: { bytes: number; visited: number; truncated: boolean },
  depth = 0,
  keyName?: string,
) {
  if (depth > maxDepth || budget.visited >= maxFragments || budget.bytes >= textBudgetBytes) {
    budget.truncated = true;
    return;
  }

  budget.visited += 1;

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }

    if (keyName && ignoredDirectStringKeys.has(normalizeInspectionKey(keyName))) {
      return;
    }

    const remaining = textBudgetBytes - budget.bytes;
    if (remaining <= 0) {
      budget.truncated = true;
      return;
    }

    const slice = trimmed.slice(0, remaining);
    parts.push(slice);
    budget.bytes += slice.length;
    if (slice.length < trimmed.length) {
      budget.truncated = true;
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectVisibleText(item, parts, budget, depth + 1, keyName);
      if (budget.bytes >= textBudgetBytes) {
        budget.truncated = true;
        break;
      }
    }
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  for (const [nestedKey, nestedValue] of Object.entries(value as Record<string, unknown>)) {
    collectVisibleText(nestedValue, parts, budget, depth + 1, nestedKey);
    if (budget.bytes >= textBudgetBytes) {
      budget.truncated = true;
      break;
    }
  }
}

function extractDomains(text: string) {
  const domains = new Set<string>();
  let match: RegExpExecArray | null;
  domainPattern.lastIndex = 0;
  while ((match = domainPattern.exec(text)) !== null) {
    const domain = match[1]?.toLowerCase();
    if (domain) {
      domains.add(domain);
    }
  }
  return [...domains];
}

function domainAllowed(domain: string, policy: PromptPolicy) {
  return policy.allowedExternalDomains.some(
    (allowed) => domain === allowed.toLowerCase() || domain.endsWith(`.${allowed.toLowerCase()}`),
  );
}

function keywordAllowed(value: string, policy: PromptPolicy) {
  return policy.allowedKeywordOverrides.some((keyword) => value.includes(keyword.toLowerCase()));
}

function maskLongToken(value: string) {
  if (value.length <= 8) {
    return "******";
  }
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function redactEvidence(value: string) {
  return clampSnippet(
    value
      .replace(emailPattern, (match) => {
        const [local, domain] = match.split("@");
        return `${local.slice(0, 1)}***@${domain}`;
      })
      .replace(phonePattern, (match) => `${match.slice(0, 2)}***${match.slice(-2)}`)
      .replace(longDigitPattern, (match) => `${"*".repeat(Math.max(match.length - 4, 4))}${match.slice(-4)}`)
      .replace(longTokenPattern, (match) => maskLongToken(match)),
  );
}

function snippetFromRange(text: string, start: number, end: number) {
  const left = Math.max(start - 48, 0);
  const right = Math.min(end + 48, text.length);
  return text.slice(left, right);
}

function severityRank(severity: RuleSeverity) {
  switch (severity) {
    case "critical":
      return 4;
    case "high":
      return 3;
    case "medium":
      return 2;
    default:
      return 1;
  }
}

function decideActivityLabel(hits: InspectionHit[]): PromptActivityLabel {
  const scores = new Map<PromptActivityLabel, number>();
  for (const hit of hits) {
    if (!hit.activityLabel) {
      continue;
    }
    scores.set(hit.activityLabel, (scores.get(hit.activityLabel) ?? 0) + hit.weight);
  }

  const ordered = [...scores.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  return ordered[0]?.[0] ?? "unknown";
}

function createSimhash(text: string) {
  const normalized = text.replace(collapseWhitespacePattern, " ").trim();
  if (!normalized) {
    return null;
  }

  const vector = new Array<number>(64).fill(0);
  for (let index = 0; index <= normalized.length - 5; index += 1) {
    const shingle = normalized.slice(index, index + 5);
    let hash = 0xcbf29ce484222325n;
    for (const char of shingle) {
      hash ^= BigInt(char.codePointAt(0) ?? 0);
      hash *= 0x100000001b3n;
      hash &= 0xffffffffffffffffn;
    }

    for (let bit = 0; bit < 64; bit += 1) {
      const mask = 1n << BigInt(bit);
      vector[bit] += (hash & mask) === 0n ? -1 : 1;
    }
  }

  let value = 0n;
  for (let bit = 0; bit < 64; bit += 1) {
    if (vector[bit] > 0) {
      value |= 1n << BigInt(bit);
    }
  }

  return value.toString(16).padStart(16, "0");
}

function trimContextStore() {
  while (contextStore.size > maxContextKeys) {
    const oldestKey = contextStore.keys().next().value;
    if (!oldestKey) {
      break;
    }
    contextStore.delete(oldestKey);
  }
}

function setContextBucket(virtualKeyId: string, bucket: InspectionContextBucket) {
  if (contextStore.has(virtualKeyId)) {
    contextStore.delete(virtualKeyId);
  }
  contextStore.set(virtualKeyId, bucket);
  trimContextStore();
}

function loadContextCounts(
  virtualKeyId: string,
  riskCategories: PromptRiskCategory[],
  simhash: string | null,
  now: number,
): InspectionContextCounts {
  const bucket = contextStore.get(virtualKeyId);
  const recent24h = (bucket?.events ?? []).filter((event) => now - event.at <= 24 * 60 * 60 * 1000);
  setContextBucket(virtualKeyId, {
    events: recent24h.slice(-maxEventsPerContextKey),
    lastSeenAt: now,
  });

  return {
    reviewCount15m: recent24h.filter((event) => event.verdict === "review" && now - event.at <= 15 * 60 * 1000).length,
    blockCount1h: recent24h.filter((event) => event.verdict === "block" && now - event.at <= 60 * 60 * 1000).length,
    sameRisk15m: recent24h.filter((event) =>
      now - event.at <= 15 * 60 * 1000 &&
      event.riskCategories.some((category) => riskCategories.includes(category)),
    ).length,
    repeatedSimhash24h: simhash
      ? recent24h.filter((event) => event.simhash !== null && event.simhash === simhash).length
      : 0,
    escalated: false,
  };
}

export function recordPromptInspectionContext(args: {
  virtualKeyId: string;
  verdict: PromptInspectionVerdict;
  riskCategories: PromptRiskCategory[];
  simhash: string | null;
  now?: number;
}) {
  const now = args.now ?? Date.now();
  const existing = contextStore.get(args.virtualKeyId)?.events ?? [];
  const recent24h = existing.filter((event) => now - event.at <= 24 * 60 * 60 * 1000);
  recent24h.push({
    at: now,
    verdict: args.verdict,
    riskCategories: args.riskCategories,
    simhash: args.simhash,
  });
  setContextBucket(args.virtualKeyId, {
    events: recent24h.slice(-maxEventsPerContextKey),
    lastSeenAt: now,
  });
}

export function resetPromptInspectionContext() {
  contextStore.clear();
}

function matchPhraseRules(text: string, policy: PromptPolicy): InspectionHit[] {
  const hits: InspectionHit[] = [];

  for (const rule of phraseRules) {
    const phrase = rule.phrase ?? "";
    if (!phrase) {
      continue;
    }

    if (policy.disabledRuleIds.includes(rule.ruleId)) {
      continue;
    }

    const normalizedPhrase = normalizeText(phrase);
    const index = text.indexOf(normalizedPhrase);
    if (index < 0 || keywordAllowed(normalizedPhrase, policy)) {
      continue;
    }

    hits.push({
      ruleId: rule.ruleId,
      riskCategory: rule.riskCategory,
      severity: rule.severity,
      weight: rule.weight,
      activityLabel: rule.activityLabel,
      evidence: snippetFromRange(text, index, index + normalizedPhrase.length),
      range: {
        start: index,
        end: index + normalizedPhrase.length,
      },
    });
  }

  return hits
    .sort((left, right) =>
      (right.range.end - right.range.start) - (left.range.end - left.range.start) ||
      right.weight - left.weight ||
      left.ruleId.localeCompare(right.ruleId),
    )
    .filter((hit, index, list) =>
      !list
        .slice(0, index)
        .some((existing) =>
          existing.riskCategory === hit.riskCategory &&
          existing.range.start <= hit.range.start &&
          existing.range.end >= hit.range.end,
        ),
    );
}

function matchRegexRules(text: string, policy: PromptPolicy): InspectionHit[] {
  const hits: InspectionHit[] = [];

  for (const rule of regexRules) {
    if (policy.disabledRuleIds.includes(rule.ruleId) || !rule.regex) {
      continue;
    }

    rule.regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    let matchCount = 0;
    while ((match = rule.regex.exec(text)) !== null) {
      const matched = match[0];
      hits.push({
        ruleId: rule.ruleId,
        riskCategory: rule.riskCategory,
        severity: rule.severity,
        weight: rule.weight,
        evidence: snippetFromRange(text, match.index, match.index + matched.length),
        range: {
          start: match.index,
          end: match.index + matched.length,
        },
      });

      matchCount += 1;
      if (rule.severity === "critical" || matchCount >= 3) {
        break;
      }
    }
  }

  return hits;
}

function matchStructuralRules(text: string, policy: PromptPolicy): InspectionHit[] {
  const hits: InspectionHit[] = [];
  const emails = text.match(emailPattern) ?? [];
  const phones = text.match(phonePattern) ?? [];
  const domains = extractDomains(text).filter((domain) => !domainAllowed(domain, policy));
  const lines = text.split(lineSplitPattern).filter((line) => line.trim().length > 0);

  if (emails.length >= 5 && !policy.disabledRuleIds.includes(structuralRules.bulkEmail.ruleId)) {
    hits.push({
      ruleId: structuralRules.bulkEmail.ruleId,
      riskCategory: structuralRules.bulkEmail.riskCategory,
      severity: structuralRules.bulkEmail.severity,
      weight: structuralRules.bulkEmail.weight,
      evidence: emails.slice(0, 3).join(", "),
      range: { start: 0, end: Math.min(text.length, 120) },
    });
  }

  if (phones.length >= 5 && !policy.disabledRuleIds.includes(structuralRules.bulkPhone.ruleId)) {
    hits.push({
      ruleId: structuralRules.bulkPhone.ruleId,
      riskCategory: structuralRules.bulkPhone.riskCategory,
      severity: structuralRules.bulkPhone.severity,
      weight: structuralRules.bulkPhone.weight,
      evidence: phones.slice(0, 3).join(", "),
      range: { start: 0, end: Math.min(text.length, 120) },
    });
  }

  if (domains.length >= 5 && !policy.disabledRuleIds.includes(structuralRules.bulkDomain.ruleId)) {
    hits.push({
      ruleId: structuralRules.bulkDomain.ruleId,
      riskCategory: structuralRules.bulkDomain.riskCategory,
      severity: structuralRules.bulkDomain.severity,
      weight: structuralRules.bulkDomain.weight,
      evidence: domains.slice(0, 3).join(", "),
      range: { start: 0, end: Math.min(text.length, 120) },
    });
  }

  if (
    lines.length >= 6 &&
    lines.some((line) => line.includes(",") || line.includes("\t")) &&
    !policy.disabledRuleIds.includes(structuralRules.tabularExport.ruleId)
  ) {
    hits.push({
      ruleId: structuralRules.tabularExport.ruleId,
      riskCategory: structuralRules.tabularExport.riskCategory,
      severity: structuralRules.tabularExport.severity,
      weight: structuralRules.tabularExport.weight,
      evidence: lines.slice(0, 3).join(" | "),
      range: { start: 0, end: Math.min(text.length, 180) },
    });
  }

  const compactText = text.replace(/[\s_-]+/g, "");
  const secretCompactText = text.replace(/[\s._:-]+/g, "");
  const alnumOnlyText = text.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const hasPlainCriticalSecret = criticalSecretPatterns.some((pattern) => pattern.test(text));
  const hasObfuscatedSecret =
    /skantapi03[a-z0-9]{20,}/i.test(secretCompactText) ||
    /sk[a-z0-9]{20,}/i.test(secretCompactText) ||
    /skantapi03[a-z0-9]{20,}/i.test(alnumOnlyText);
  if (
    (compactText !== text || secretCompactText !== text) &&
    !hasPlainCriticalSecret &&
    (criticalSecretPatterns.some((pattern) => pattern.test(compactText)) || hasObfuscatedSecret) &&
    !policy.disabledRuleIds.includes(structuralRules.secretObfuscated.ruleId)
  ) {
    hits.push({
      ruleId: structuralRules.secretObfuscated.ruleId,
      riskCategory: structuralRules.secretObfuscated.riskCategory,
      severity: structuralRules.secretObfuscated.severity,
      weight: structuralRules.secretObfuscated.weight,
      evidence: compactText.slice(0, 80),
      range: { start: 0, end: Math.min(text.length, 80) },
    });
  }

  return hits;
}

function matchCooccurrenceRules(text: string, policy: PromptPolicy): InspectionHit[] {
  const hits: InspectionHit[] = [];

  for (const group of cooccurrenceGroups) {
    if (policy.disabledRuleIds.includes(group.ruleId)) {
      continue;
    }

    const matched = group.terms.every((term) => text.includes(normalizeText(term)));
    if (!matched) {
      continue;
    }

    hits.push({
      ruleId: group.ruleId,
      riskCategory: group.riskCategory,
      severity: "high",
      weight: group.weight,
      evidence: group.terms.join(" / "),
      range: { start: 0, end: Math.min(text.length, 120) },
    });
  }

  return hits;
}

function dedupeHits(hits: InspectionHit[]) {
  const seen = new Set<string>();
  return hits
    .sort((left, right) =>
      severityRank(right.severity) - severityRank(left.severity) ||
      right.weight - left.weight ||
      left.ruleId.localeCompare(right.ruleId),
    )
    .filter((hit) => {
      const key = `${hit.ruleId}:${hit.range.start}:${hit.range.end}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

function pickBlockMessage(riskCategories: PromptRiskCategory[]) {
  if (riskCategories.includes("secret_exfiltration") || riskCategories.includes("credential_exposure")) {
    return "Blocked by prompt inspection because the request appears to contain credentials or secrets.";
  }
  if (riskCategories.includes("customer_data_export") || riskCategories.includes("pii_exposure")) {
    return "Blocked by prompt inspection because the request appears to export sensitive or customer data.";
  }
  return "Blocked by prompt inspection because the request violates workspace prompt policy.";
}

function applyPolicyVerdict(
  score: number,
  criticalHit: boolean,
  policy: PromptPolicy,
): PromptInspectionVerdict {
  let verdict: PromptInspectionVerdict;

  if (criticalHit || score >= policy.blockThreshold) {
    verdict = "block";
  } else if (score >= policy.reviewThreshold) {
    verdict = "review";
  } else if (score >= 20) {
    verdict = "allow_with_record";
  } else {
    verdict = "allow_clean";
  }

  if (policy.enforcementMode === "alert_only") {
    return verdict === "allow_clean" ? verdict : "allow_with_record";
  }

  if (policy.enforcementMode === "strict") {
    return verdict === "allow_clean" ? verdict : "block";
  }

  return verdict;
}

export function inspectPromptInput(args: {
  body: Record<string, unknown>;
  path: GatewayRequestPath;
  virtualKey: Pick<VirtualKey, "id">;
  policy: PromptPolicy;
  now?: number;
}): PromptInspectionDecision | null {
  if (!args.policy.enabled) {
    return null;
  }

  const fragments: string[] = [];
  const budget = {
    bytes: 0,
    visited: 0,
    truncated: false,
  };
  collectVisibleText(args.body, fragments, budget);

  if (!fragments.length) {
    return null;
  }

  const normalizedText = normalizeText(fragments.join("\n"));
  if (!normalizedText) {
    return null;
  }

  const hits = dedupeHits([
    ...matchPhraseRules(normalizedText, args.policy),
    ...matchRegexRules(normalizedText, args.policy),
    ...matchStructuralRules(normalizedText, args.policy),
    ...matchCooccurrenceRules(normalizedText, args.policy),
  ]);

  if (!hits.length) {
    return null;
  }

  const simhash = createSimhash(normalizedText);
  const contextCounts = loadContextCounts(
    args.virtualKey.id,
    [...new Set(hits.map((hit) => hit.riskCategory))],
    simhash,
    args.now ?? Date.now(),
  );

  const score = hits.reduce((sum, hit) => sum + hit.weight, 0)
    + Math.min(contextCounts.sameRisk15m * 8, 24)
    + Math.min(contextCounts.repeatedSimhash24h * 6, 18);
  const criticalHit = hits.some((hit) => hit.severity === "critical");

  let verdict = applyPolicyVerdict(score, criticalHit, args.policy);
  if (contextCounts.reviewCount15m >= 3) {
    if (verdict === "allow_with_record") {
      verdict = "review";
      contextCounts.escalated = true;
    } else if (verdict === "review") {
      verdict = "block";
      contextCounts.escalated = true;
    }
  }

  const riskCategories = [...new Set(hits.map((hit) => hit.riskCategory))];
  const redactedEvidence =
    args.policy.evidenceMode === "disabled" || args.policy.evidenceMode === "fingerprint_only"
      ? []
      : hits
          .map((hit) => redactEvidence(hit.evidence))
          .filter(Boolean)
          .slice(0, maxEvidenceCount);
  const topActivityLabel = decideActivityLabel(hits);
  const shouldCreateAlert =
    verdict === "block"
      ? criticalHit || contextCounts.blockCount1h >= 1
      : verdict === "review"
        ? contextCounts.reviewCount15m >= 2 || contextCounts.escalated
        : false;

  if (verdict === "allow_clean") {
    return null;
  }

  return {
    verdict,
    score,
    topActivityLabel,
    riskCategories,
    hitRuleIds: [...new Set(hits.map((hit) => hit.ruleId))],
    redactedEvidence,
    simhash,
    truncated: budget.truncated,
    contextCounts,
    shouldPersist: true,
    shouldCreateAlert,
    blockMessage: verdict === "block" ? pickBlockMessage(riskCategories) : null,
    metadataSummary: {
      inspectionVerdict: verdict,
      inspectionScore: score,
      inspectionRiskCategories: riskCategories,
      inspectionTopLabel: topActivityLabel,
    },
  };
}
