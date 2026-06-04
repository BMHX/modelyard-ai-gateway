import {
  getProviderModelPricingMatch,
  inferModelFamily,
  normalizeCanonicalModel,
  normalizeProviderModel,
  type ProviderConnection,
  type ProviderPricingConfig,
  type ProviderPricingRule,
} from "@teamops/contracts";

type ModelPricingSource = "builtin" | "manual" | "connection-metadata";

export type ResolvedModelPricing = {
  providerModel: string;
  canonicalModel: string;
  modelFamily: string;
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  cachedInputUsdPerMillion: number | null;
  cacheReadInputUsdPerMillion: number | null;
  cacheWrite5mInputUsdPerMillion: number | null;
  cacheWrite1hInputUsdPerMillion: number | null;
  longContextThresholdInputTokens: number | null;
  longContextInputUsdPerMillion: number | null;
  longContextOutputUsdPerMillion: number | null;
  longContextCacheReadInputUsdPerMillion: number | null;
  longContextCacheWrite5mInputUsdPerMillion: number | null;
  longContextCacheWrite1hInputUsdPerMillion: number | null;
  source: ModelPricingSource;
};

export type UsageTokenCounts = {
  promptTokens: number;
  completionTokens: number;
  cachedInputTokens: number;
  cacheReadInputTokens: number;
  cacheWrite5mInputTokens: number;
  cacheWrite1hInputTokens: number;
  reasoningTokens: number;
};

export type UsageCostBreakdown = {
  promptTokens: number;
  completionTokens: number;
  baseInputTokens: number;
  cachedInputTokens: number;
  cacheReadInputTokens: number;
  cacheWrite5mInputTokens: number;
  cacheWrite1hInputTokens: number;
  reasoningTokens: number;
  appliedLongContextPricing: boolean;
  costUsd: number;
  rates: {
    inputUsdPerMillion: number;
    outputUsdPerMillion: number;
    cachedInputUsdPerMillion: number | null;
    cacheReadInputUsdPerMillion: number | null;
    cacheWrite5mInputUsdPerMillion: number | null;
    cacheWrite1hInputUsdPerMillion: number | null;
  };
};

type ResolvedPricingRates = UsageCostBreakdown["rates"] & {
  appliedLongContextPricing: boolean;
};

function parseInteger(value: string | undefined) {
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

function createResolvedPricing(args: {
  model: string;
  rates: ProviderPricingRule["rates"];
  source: ModelPricingSource;
}) {
  const providerModel = normalizeProviderModel(args.model);
  const canonicalModel = normalizeCanonicalModel(args.model);

  return {
    providerModel,
    canonicalModel,
    modelFamily: inferModelFamily(canonicalModel),
    inputUsdPerMillion: args.rates.inputUsdPerMillion,
    outputUsdPerMillion: args.rates.outputUsdPerMillion,
    cachedInputUsdPerMillion: args.rates.cachedInputUsdPerMillion,
    cacheReadInputUsdPerMillion: args.rates.cacheReadInputUsdPerMillion,
    cacheWrite5mInputUsdPerMillion: args.rates.cacheWrite5mInputUsdPerMillion,
    cacheWrite1hInputUsdPerMillion: args.rates.cacheWrite1hInputUsdPerMillion,
    longContextThresholdInputTokens: args.rates.longContextThresholdInputTokens,
    longContextInputUsdPerMillion: args.rates.longContextInputUsdPerMillion,
    longContextOutputUsdPerMillion: args.rates.longContextOutputUsdPerMillion,
    longContextCacheReadInputUsdPerMillion:
      args.rates.longContextCacheReadInputUsdPerMillion,
    longContextCacheWrite5mInputUsdPerMillion:
      args.rates.longContextCacheWrite5mInputUsdPerMillion,
    longContextCacheWrite1hInputUsdPerMillion:
      args.rates.longContextCacheWrite1hInputUsdPerMillion,
    source: args.source,
  } satisfies ResolvedModelPricing;
}

export function createUsageTokenCounts(
  counts: Partial<UsageTokenCounts> & Pick<UsageTokenCounts, "promptTokens" | "completionTokens">,
): UsageTokenCounts {
  return {
    promptTokens: Math.max(0, Math.trunc(counts.promptTokens)),
    completionTokens: Math.max(0, Math.trunc(counts.completionTokens)),
    cachedInputTokens: Math.max(0, Math.trunc(counts.cachedInputTokens ?? 0)),
    cacheReadInputTokens: Math.max(0, Math.trunc(counts.cacheReadInputTokens ?? 0)),
    cacheWrite5mInputTokens: Math.max(0, Math.trunc(counts.cacheWrite5mInputTokens ?? 0)),
    cacheWrite1hInputTokens: Math.max(0, Math.trunc(counts.cacheWrite1hInputTokens ?? 0)),
    reasoningTokens: Math.max(0, Math.trunc(counts.reasoningTokens ?? 0)),
  };
}

export function resolveModelPricing(
  provider: ProviderConnection["provider"],
  model: string,
  pricingConfig: ProviderPricingConfig | null | undefined,
  metadata: Record<string, string>,
): ResolvedModelPricing | null {
  const match = getProviderModelPricingMatch({
    provider,
    model,
    pricingConfig,
    metadata,
  });
  if (!match) {
    return null;
  }

  return createResolvedPricing({
    model,
    rates: match.rates,
    source: match.source,
  });
}

function resolveAppliedRates(
  pricing: ResolvedModelPricing,
  usage: UsageTokenCounts,
): ResolvedPricingRates {
  const shouldApplyLongContextPricing =
    pricing.longContextThresholdInputTokens !== null &&
    usage.promptTokens > pricing.longContextThresholdInputTokens &&
    (pricing.longContextInputUsdPerMillion !== null ||
      pricing.longContextOutputUsdPerMillion !== null ||
      pricing.longContextCacheReadInputUsdPerMillion !== null ||
      pricing.longContextCacheWrite5mInputUsdPerMillion !== null ||
      pricing.longContextCacheWrite1hInputUsdPerMillion !== null);

  if (!shouldApplyLongContextPricing) {
    return {
      inputUsdPerMillion: pricing.inputUsdPerMillion,
      outputUsdPerMillion: pricing.outputUsdPerMillion,
      cachedInputUsdPerMillion: pricing.cachedInputUsdPerMillion,
      cacheReadInputUsdPerMillion: pricing.cacheReadInputUsdPerMillion,
      cacheWrite5mInputUsdPerMillion: pricing.cacheWrite5mInputUsdPerMillion,
      cacheWrite1hInputUsdPerMillion: pricing.cacheWrite1hInputUsdPerMillion,
      appliedLongContextPricing: false,
    };
  }

  return {
    inputUsdPerMillion:
      pricing.longContextInputUsdPerMillion ?? pricing.inputUsdPerMillion,
    outputUsdPerMillion:
      pricing.longContextOutputUsdPerMillion ?? pricing.outputUsdPerMillion,
    cachedInputUsdPerMillion: pricing.cachedInputUsdPerMillion,
    cacheReadInputUsdPerMillion:
      pricing.longContextCacheReadInputUsdPerMillion ??
      pricing.cacheReadInputUsdPerMillion,
    cacheWrite5mInputUsdPerMillion:
      pricing.longContextCacheWrite5mInputUsdPerMillion ??
      pricing.cacheWrite5mInputUsdPerMillion,
    cacheWrite1hInputUsdPerMillion:
      pricing.longContextCacheWrite1hInputUsdPerMillion ??
      pricing.cacheWrite1hInputUsdPerMillion,
    appliedLongContextPricing: true,
  };
}

export function calculateUsageCostBreakdown(
  pricing: ResolvedModelPricing | null,
  counts: UsageTokenCounts,
): UsageCostBreakdown | null {
  if (!pricing) {
    return null;
  }

  const usage = createUsageTokenCounts(counts);
  const rates = resolveAppliedRates(pricing, usage);
  const baseInputTokens = Math.max(
    0,
    usage.promptTokens -
      usage.cachedInputTokens -
      usage.cacheReadInputTokens -
      usage.cacheWrite5mInputTokens -
      usage.cacheWrite1hInputTokens,
  );

  const totalCostUsd =
    (baseInputTokens * rates.inputUsdPerMillion +
      usage.cachedInputTokens * (rates.cachedInputUsdPerMillion ?? 0) +
      usage.cacheReadInputTokens * (rates.cacheReadInputUsdPerMillion ?? 0) +
      usage.cacheWrite5mInputTokens * (rates.cacheWrite5mInputUsdPerMillion ?? 0) +
      usage.cacheWrite1hInputTokens * (rates.cacheWrite1hInputUsdPerMillion ?? 0) +
      usage.completionTokens * rates.outputUsdPerMillion) /
    1_000_000;

  return {
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    baseInputTokens,
    cachedInputTokens: usage.cachedInputTokens,
    cacheReadInputTokens: usage.cacheReadInputTokens,
    cacheWrite5mInputTokens: usage.cacheWrite5mInputTokens,
    cacheWrite1hInputTokens: usage.cacheWrite1hInputTokens,
    reasoningTokens: usage.reasoningTokens,
    appliedLongContextPricing: rates.appliedLongContextPricing,
    costUsd: Number(totalCostUsd.toFixed(6)),
    rates: {
      inputUsdPerMillion: rates.inputUsdPerMillion,
      outputUsdPerMillion: rates.outputUsdPerMillion,
      cachedInputUsdPerMillion: rates.cachedInputUsdPerMillion,
      cacheReadInputUsdPerMillion: rates.cacheReadInputUsdPerMillion,
      cacheWrite5mInputUsdPerMillion: rates.cacheWrite5mInputUsdPerMillion,
      cacheWrite1hInputUsdPerMillion: rates.cacheWrite1hInputUsdPerMillion,
    },
  };
}

export function calculateUsageCostUsd(
  pricing: ResolvedModelPricing | null,
  counts: UsageTokenCounts,
) {
  return calculateUsageCostBreakdown(pricing, counts)?.costUsd ?? 0;
}

export function parseLegacyPricingThreshold(metadata: Record<string, string>) {
  return parseInteger(metadata.pricingLongContextThresholdInputTokens);
}
