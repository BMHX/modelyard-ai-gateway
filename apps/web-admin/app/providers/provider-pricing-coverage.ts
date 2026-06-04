import {
  getProviderModelPricingCoverageStatus,
  normalizeCanonicalModel,
  type ProviderConnection,
  type ProviderPricingConfig,
  type ProviderModelConfigItem,
  type ProviderPricingRule,
} from "@teamops/contracts";

export type SelectedModelPricingCoverage = {
  canonicalModel: string;
  label: string;
  status: "exact" | "fallback" | "uncovered";
};

function createEmptyPricingRule(
  provider: ProviderConnection["provider"],
  model: string,
): ProviderPricingRule {
  return {
    matchType: "canonical",
    model,
    rates: {
      inputUsdPerMillion: 0,
      outputUsdPerMillion: 0,
      cachedInputUsdPerMillion: provider === "openai" ? 0 : null,
      cacheReadInputUsdPerMillion: provider === "anthropic" ? 0 : null,
      cacheWrite5mInputUsdPerMillion: provider === "anthropic" ? 0 : null,
      cacheWrite1hInputUsdPerMillion: provider === "anthropic" ? 0 : null,
      longContextThresholdInputTokens: null,
      longContextInputUsdPerMillion: null,
      longContextOutputUsdPerMillion: null,
      longContextCacheReadInputUsdPerMillion: null,
      longContextCacheWrite5mInputUsdPerMillion: null,
      longContextCacheWrite1hInputUsdPerMillion: null,
    },
  };
}

export function buildExactPricingRulesFromSelectedModels(args: {
  provider: ProviderConnection["provider"];
  selectedModels: ProviderModelConfigItem[];
  existingRules: ProviderPricingRule[];
}) {
  const existingExactModels = new Set(
    args.existingRules
      .filter((rule) => rule.matchType === "canonical" && rule.model)
      .map((rule) => normalizeCanonicalModel(rule.model ?? "")),
  );

  const nextRules = [...args.existingRules];
  for (const model of args.selectedModels) {
    const canonicalModel = normalizeCanonicalModel(model.id);
    if (!canonicalModel || existingExactModels.has(canonicalModel)) {
      continue;
    }

    nextRules.push(createEmptyPricingRule(args.provider, canonicalModel));
    existingExactModels.add(canonicalModel);
  }

  return nextRules;
}

export function getSelectedModelPricingCoverage(
  args: {
    provider: ProviderConnection["provider"];
    selectedModels: ProviderModelConfigItem[];
    pricingConfig: ProviderPricingConfig | null;
    metadata: Record<string, string>;
  },
): SelectedModelPricingCoverage[] {
  return args.selectedModels.map((model) => {
    const canonicalModel = normalizeCanonicalModel(model.id);
    const coverage = getProviderModelPricingCoverageStatus({
      provider: args.provider,
      model: canonicalModel,
      pricingConfig: args.pricingConfig,
      metadata: args.metadata,
    });

    return {
      canonicalModel,
      label: model.label?.trim() || canonicalModel,
      status: coverage === "canonical" ? "exact" : coverage === "fallback" ? "fallback" : "uncovered",
    };
  });
}

export function isPricingRuleLinkedToSelectedModels(
  rule: Pick<ProviderPricingRule, "matchType" | "model">,
  selectedModels: ProviderModelConfigItem[],
) {
  if (rule.matchType !== "canonical" || !rule.model) {
    return true;
  }

  const canonicalModel = normalizeCanonicalModel(rule.model);
  return selectedModels.some(
    (model) => normalizeCanonicalModel(model.id) === canonicalModel,
  );
}
