import assert from "node:assert/strict";
import test from "node:test";

import {
  buildExactPricingRulesFromSelectedModels,
  getSelectedModelPricingCoverage,
  isPricingRuleLinkedToSelectedModels,
} from "./providers/provider-pricing-coverage";

test("buildExactPricingRulesFromSelectedModels creates one exact rule per selected model only once", () => {
  const rules = buildExactPricingRulesFromSelectedModels({
    provider: "openai-compatible",
    selectedModels: [
      { id: "glm-4", label: "GLM-4", source: "catalog" },
      { id: "glm-4", label: "GLM-4", source: "catalog" },
    ],
    existingRules: [],
  });

  assert.equal(rules.length, 1);
  assert.equal(rules[0]?.matchType, "canonical");
  assert.equal(rules[0]?.model, "glm-4");
});

test("selected model pricing coverage marks fallback-only coverage without treating family aliases as exact", () => {
  const coverage = getSelectedModelPricingCoverage({
    provider: "openai-compatible",
    selectedModels: [{ id: "glm-4", label: "GLM-4", source: "catalog" }],
    pricingConfig: {
      mode: "manual",
      rules: [
        {
          matchType: "canonical",
          model: "glm",
          rates: {
            inputUsdPerMillion: 1,
            outputUsdPerMillion: 2,
            cachedInputUsdPerMillion: null,
            cacheReadInputUsdPerMillion: null,
            cacheWrite5mInputUsdPerMillion: null,
            cacheWrite1hInputUsdPerMillion: null,
            longContextThresholdInputTokens: null,
            longContextInputUsdPerMillion: null,
            longContextOutputUsdPerMillion: null,
            longContextCacheReadInputUsdPerMillion: null,
            longContextCacheWrite5mInputUsdPerMillion: null,
            longContextCacheWrite1hInputUsdPerMillion: null,
          },
        },
        {
          matchType: "fallback",
          model: null,
          rates: {
            inputUsdPerMillion: 1,
            outputUsdPerMillion: 2,
            cachedInputUsdPerMillion: null,
            cacheReadInputUsdPerMillion: null,
            cacheWrite5mInputUsdPerMillion: null,
            cacheWrite1hInputUsdPerMillion: null,
            longContextThresholdInputTokens: null,
            longContextInputUsdPerMillion: null,
            longContextOutputUsdPerMillion: null,
            longContextCacheReadInputUsdPerMillion: null,
            longContextCacheWrite5mInputUsdPerMillion: null,
            longContextCacheWrite1hInputUsdPerMillion: null,
          },
        },
      ],
    },
    metadata: {},
  });

  assert.deepEqual(coverage, [
    {
      canonicalModel: "glm-4",
      label: "GLM-4",
      status: "fallback",
    },
  ]);
});

test("selected model pricing coverage counts builtin pricing as exact coverage", () => {
  const coverage = getSelectedModelPricingCoverage({
    provider: "openai",
    selectedModels: [{ id: "gpt-4.1-mini", label: "GPT-4.1 mini", source: "preset" }],
    pricingConfig: null,
    metadata: {},
  });

  assert.deepEqual(coverage, [
    {
      canonicalModel: "gpt-4.1-mini",
      label: "GPT-4.1 mini",
      status: "exact",
    },
  ]);
});

test("isPricingRuleLinkedToSelectedModels keeps unrelated exact rules marked as unlinked", () => {
  assert.equal(
    isPricingRuleLinkedToSelectedModels(
      {
        matchType: "canonical",
        model: "glm",
      },
      [{ id: "glm-4", label: "GLM-4", source: "catalog" }],
    ),
    false,
  );
});
