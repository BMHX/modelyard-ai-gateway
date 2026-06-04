import { FAMILY_CAPS, STRONG_FAMILIES } from "./catalog.js";
import { clamp } from "./normalize.js";
import type {
  ConfidenceBand,
  DetectionReport,
  DetectionSummary,
  DetectionTask,
  EvidenceFamily,
  EvidenceRecord,
  ScoreBreakdown,
  SourceSurface,
  Verdict,
} from "./types.js";

function createEmptyFamilyScores() {
  return {
    runtimeHeader: 0,
    healthIdentity: 0,
    containerMetadata: 0,
    manifestFingerprint: 0,
    routeTopology: 0,
    semanticWatermark: 0,
  };
}

function independenceMultiplier(index: number) {
  if (index === 0) {
    return 1;
  }

  if (index === 1) {
    return 0.45;
  }

  return 0.2;
}

function computeFamilyScores(evidence: EvidenceRecord[]) {
  const familyScores = createEmptyFamilyScores();
  const independenceCounts = new Map<string, number>();
  const perSurfaceRaw = new Map<SourceSurface, number>();

  for (const item of evidence) {
    const count = independenceCounts.get(item.independenceKey) ?? 0;
    independenceCounts.set(item.independenceKey, count + 1);

    const raw = item.baseWeight * item.rarity * item.strength * item.tamperCost * independenceMultiplier(count);
    const family = item.family;
    familyScores[family] = Math.min(FAMILY_CAPS[family], familyScores[family] + raw);
    perSurfaceRaw.set(item.sourceSurface, (perSurfaceRaw.get(item.sourceSurface) ?? 0) + raw);
  }

  const roundedFamilyScores = {
    runtimeHeader: Number(familyScores.runtimeHeader.toFixed(1)),
    healthIdentity: Number(familyScores.healthIdentity.toFixed(1)),
    containerMetadata: Number(familyScores.containerMetadata.toFixed(1)),
    manifestFingerprint: Number(familyScores.manifestFingerprint.toFixed(1)),
    routeTopology: Number(familyScores.routeTopology.toFixed(1)),
    semanticWatermark: Number(familyScores.semanticWatermark.toFixed(1)),
  };

  return {
    familyScores: roundedFamilyScores,
    perSurfaceRaw,
  };
}

function computeCrossSignalBonus(evidence: EvidenceRecord[]) {
  const perSurfaceFamilies = new Map<SourceSurface, Set<EvidenceFamily>>();
  const perSurfaceStrong = new Map<SourceSurface, boolean>();
  const matchedStrongFamilies = new Set<EvidenceFamily>();

  for (const item of evidence) {
    const familySet = perSurfaceFamilies.get(item.sourceSurface) ?? new Set<EvidenceFamily>();
    familySet.add(item.family);
    perSurfaceFamilies.set(item.sourceSurface, familySet);

    if (STRONG_FAMILIES.has(item.family)) {
      perSurfaceStrong.set(item.sourceSurface, true);
      matchedStrongFamilies.add(item.family);
    }
  }

  let bonus = 0;
  for (const [surface, familySet] of perSurfaceFamilies) {
    if (surface === "unknown") {
      continue;
    }

    if (familySet.size >= 2) {
      bonus += 3;
    }
    if (familySet.size >= 3) {
      bonus += 2;
    }
    if (perSurfaceStrong.get(surface) && familySet.size >= 2) {
      bonus += 1;
    }
  }

  if (matchedStrongFamilies.size >= 2) {
    bonus += (matchedStrongFamilies.size - 1) * 2;
  }

  return Math.min(10, bonus);
}

function computeFalsePositivePenalty(evidence: EvidenceRecord[], matchedFamilies: EvidenceFamily[]) {
  if (evidence.length === 0) {
    return 0;
  }

  const strongEvidence = evidence.filter((item) => STRONG_FAMILIES.has(item.family));
  const genericEvidence = evidence.filter((item) => item.metadata?.generic === true);

  let penalty = 0;
  if (strongEvidence.length === 0) {
    penalty += 8;
  }
  if (genericEvidence.length === evidence.length) {
    penalty += 12;
  }
  if (matchedFamilies.length <= 1) {
    penalty += 5;
  }

  return Math.min(25, penalty);
}

function detectPartialRemoval(evidence: EvidenceRecord[]) {
  const signals = new Set(evidence.map((item) => item.signal));
  const gatewayChildSignals = [
    "x-teamops-provider",
    "x-teamops-provider-connection-id",
    "x-teamops-upstream-status",
    "x-teamops-provider-request-id",
  ];
  const hasGatewayAnchor = signals.has("x-teamops-gateway-protocol");

  if (!hasGatewayAnchor && gatewayChildSignals.some((signal) => signals.has(signal))) {
    return true;
  }

  const hasRouteFamily = ["/v1/messages", "/v1/responses", "/v1/models"].some((signal) => signals.has(signal));
  const hasRuntimeHeader = evidence.some((item) => item.family === "runtimeHeader");
  return hasRouteFamily && !hasRuntimeHeader;
}

function verdictFromScore(score: number): Verdict {
  if (score >= 90) {
    return "high-confidence-match";
  }
  if (score >= 75) {
    return "likely-match";
  }
  if (score >= 55) {
    return "possible-match";
  }
  if (score >= 30) {
    return "weak-signal";
  }
  return "unlikely";
}

function bandFromScore(score: number): ConfidenceBand {
  if (score >= 90) {
    return "very-high";
  }
  if (score >= 75) {
    return "high";
  }
  if (score >= 40) {
    return "medium";
  }
  return "low";
}

function buildLikelySources(perSurfaceRaw: Map<SourceSurface, number>) {
  const meaningful = [...perSurfaceRaw.entries()].filter(([surface, raw]) => surface !== "unknown" && raw > 0);
  const total = meaningful.reduce((sum, [, raw]) => sum + raw, 0);
  if (total <= 0) {
    return [];
  }

  return meaningful
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3)
    .map(([surface, raw]) => ({
      surface,
      confidence: Number((raw / total).toFixed(2)),
    }));
}

function buildReviewActions(args: {
  evidence: EvidenceRecord[];
  summary: DetectionSummary;
  task: DetectionTask;
}): string[] {
  const actions = new Set<string>();
  const families = new Set(args.summary.matchedFamilies);

  if (args.task.mode === "online" && !families.has("healthIdentity")) {
    actions.add("对目标再次执行 /api/healthz 与 /healthz 探测，确认是否存在被网关或 CDN 遮挡的服务身份信号。");
  }

  if (!families.has("containerMetadata")) {
    actions.add("补充 Docker image、部署目录或 compose 文件做离线确认，避免仅凭在线表象下结论。");
  }

  if (args.summary.partialRemovalSuspected) {
    actions.add("当前信号像是做过局部清洗，建议对比 bundle 字符串、运行时头和镜像元数据，确认是否存在删改。");
  }

  if (families.has("runtimeHeader")) {
    actions.add("重复探测 /v1/models 与 /v1/messages，记录不同状态码下的响应头，确认这些信号是否稳定出现。");
  }

  if (actions.size === 0) {
    actions.add("当前证据不足以上升到高置信度，先补一类独立信号源再复核。");
  }

  return [...actions].slice(0, 4);
}

export function scoreEvidence(args: {
  evidence: EvidenceRecord[];
  errors: string[];
  task: DetectionTask;
}): Pick<DetectionReport, "verdict" | "confidence" | "band" | "summary" | "scores" | "reviewActions"> {
  const { familyScores, perSurfaceRaw } = computeFamilyScores(args.evidence);
  const matchedFamilies = Object.entries(familyScores)
    .filter(([, score]) => score > 0)
    .map(([family]) => family as EvidenceFamily);

  const crossSignalBonus = computeCrossSignalBonus(args.evidence);
  const falsePositivePenalty = computeFalsePositivePenalty(args.evidence, matchedFamilies);
  const strongFamilyCount = matchedFamilies.filter((family) => STRONG_FAMILIES.has(family)).length;
  const partialRemovalSuspected = detectPartialRemoval(args.evidence);

  let total = Object.values(familyScores).reduce((sum, score) => sum + score, 0) + crossSignalBonus - falsePositivePenalty;
  total = clamp(total, 0, 100);

  if (strongFamilyCount === 0) {
    total = Math.min(total, 74);
  }
  if (matchedFamilies.length < 2) {
    total = Math.min(total, 74);
  }
  if (matchedFamilies.length < 1) {
    total = 0;
  }

  total = Math.round(total);

  const summary: DetectionSummary = {
    matchedFamilies,
    likelySources: buildLikelySources(perSurfaceRaw),
    partialRemovalSuspected,
  };

  const scores: ScoreBreakdown = {
    ...familyScores,
    crossSignalBonus,
    falsePositivePenalty,
    total,
  };

  return {
    verdict: verdictFromScore(total),
    confidence: total,
    band: bandFromScore(total),
    summary,
    scores,
    reviewActions: buildReviewActions({
      evidence: args.evidence,
      summary,
      task: args.task,
    }),
  };
}
