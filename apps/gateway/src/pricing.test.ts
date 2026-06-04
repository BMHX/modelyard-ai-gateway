import assert from "node:assert/strict";
import test from "node:test";

import { ProviderPricingConfigSchema } from "@teamops/contracts";

import {
  calculateUsageCostBreakdown,
  createUsageTokenCounts,
  resolveModelPricing,
} from "./pricing.js";

test("resolveModelPricing uses builtin catalog for managed public providers", () => {
  const pricing = resolveModelPricing("openai", "gpt-4.1-mini", null, {});

  assert(pricing);
  assert.equal(pricing.source, "builtin");
  assert.equal(pricing.canonicalModel, "gpt-4.1-mini");
  assert.equal(pricing.cachedInputUsdPerMillion, 0.1);
});

test("resolveModelPricing prefers manual exact rules over builtin catalog", () => {
  const pricingConfig = ProviderPricingConfigSchema.parse({
    mode: "manual",
    rules: [
      {
        matchType: "canonical",
        model: "gpt-4.1-mini",
        rates: {
          inputUsdPerMillion: 9,
          outputUsdPerMillion: 19,
          cachedInputUsdPerMillion: 3,
        },
      },
    ],
  });

  const pricing = resolveModelPricing("openai", "gpt-4.1-mini", pricingConfig, {});

  assert(pricing);
  assert.equal(pricing.source, "manual");
  assert.equal(pricing.inputUsdPerMillion, 9);
  assert.equal(pricing.outputUsdPerMillion, 19);
  assert.equal(pricing.cachedInputUsdPerMillion, 3);
});

test("resolveModelPricing uses manual fallback rules for unmatched models", () => {
  const pricingConfig = ProviderPricingConfigSchema.parse({
    mode: "manual",
    rules: [
      {
        matchType: "fallback",
        model: null,
        rates: {
          inputUsdPerMillion: 1,
          outputUsdPerMillion: 2,
        },
      },
    ],
  });

  const pricing = resolveModelPricing("openai-compatible", "custom-model", pricingConfig, {});

  assert(pricing);
  assert.equal(pricing.source, "manual");
  assert.equal(pricing.canonicalModel, "custom-model");
  assert.equal(pricing.inputUsdPerMillion, 1);
  assert.equal(pricing.outputUsdPerMillion, 2);
});

test("calculateUsageCostBreakdown applies cached input pricing for OpenAI models", () => {
  const pricing = resolveModelPricing("openai", "gpt-4.1-mini", null, {});
  if (!pricing) {
    throw new Error("Expected pricing");
  }

  const breakdown = calculateUsageCostBreakdown(
    pricing,
    createUsageTokenCounts({
      promptTokens: 1_000,
      completionTokens: 200,
      cachedInputTokens: 400,
    }),
  );

  assert(breakdown);
  assert.equal(breakdown.baseInputTokens, 600);
  assert.equal(breakdown.cachedInputTokens, 400);
  assert.equal(breakdown.costUsd, 0.0006);
});

test("calculateUsageCostBreakdown applies Anthropic cache pricing and long-context rates", () => {
  const pricing = resolveModelPricing("anthropic", "claude-sonnet-4-20250514", null, {});
  if (!pricing) {
    throw new Error("Expected pricing");
  }

  const breakdown = calculateUsageCostBreakdown(
    pricing,
    createUsageTokenCounts({
      promptTokens: 210_000,
      completionTokens: 10_000,
      cacheReadInputTokens: 50_000,
      cacheWrite5mInputTokens: 40_000,
      cacheWrite1hInputTokens: 10_000,
    }),
  );

  assert(breakdown);
  assert.equal(breakdown.appliedLongContextPricing, true);
  assert.equal(breakdown.baseInputTokens, 110_000);
  assert.equal(breakdown.costUsd, 1.335);
});

test("resolveModelPricing uses builtin catalog for current Anthropic Sonnet aliases", () => {
  const pricing = resolveModelPricing("anthropic", "claude-sonnet-4-6-20260219", null, {});

  assert(pricing);
  assert.equal(pricing.source, "builtin");
  assert.equal(pricing.canonicalModel, "claude-sonnet-4-6");
  assert.equal(pricing.inputUsdPerMillion, 3);
  assert.equal(pricing.outputUsdPerMillion, 15);
  assert.equal(pricing.cacheReadInputUsdPerMillion, 0.3);
});

test("resolveModelPricing uses builtin catalog for current Anthropic Haiku aliases", () => {
  const pricing = resolveModelPricing("anthropic", "claude-haiku-4-5-20251001", null, {});

  assert(pricing);
  assert.equal(pricing.source, "builtin");
  assert.equal(pricing.canonicalModel, "claude-haiku-4-5");
  assert.equal(pricing.inputUsdPerMillion, 1);
  assert.equal(pricing.outputUsdPerMillion, 5);
  assert.equal(pricing.cacheReadInputUsdPerMillion, 0.1);
});
