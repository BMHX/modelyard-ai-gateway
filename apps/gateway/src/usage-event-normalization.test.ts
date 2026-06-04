import assert from "node:assert/strict";
import test from "node:test";

import { normalizeGatewayProviderUsageEvent } from "./routes.js";

test("normalizeGatewayProviderUsageEvent fills missing provider usage fields with safe defaults", () => {
  const usageEvent = normalizeGatewayProviderUsageEvent({
    usageEvent: {
      promptTokens: 12,
      completionTokens: 4,
    },
    fallback: {
      provider: "openai",
      model: "gpt-4.1-mini",
      status: "success",
    },
  });

  assert.deepEqual(usageEvent, {
    customerId: null,
    deploymentId: null,
    releaseId: null,
    fingerprintId: null,
    manifestHash: null,
    providerRequestId: null,
    provider: "openai",
    model: "gpt-4.1-mini",
    promptTokens: 12,
    completionTokens: 4,
    costUsd: 0,
    status: "success",
    metadata: {},
  });
});

test("normalizeGatewayProviderUsageEvent clamps invalid numeric values and preserves structured metadata", () => {
  const usageEvent = normalizeGatewayProviderUsageEvent({
    usageEvent: {
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      promptTokens: Number.NaN,
      completionTokens: -3,
      costUsd: Number.POSITIVE_INFINITY,
      status: "error",
      metadata: {
        httpStatusCode: 502,
        upstreamError: "bad gateway",
      },
    },
    fallback: {
      provider: "openai",
      status: "success",
    },
  });

  assert.deepEqual(usageEvent, {
    customerId: null,
    deploymentId: null,
    releaseId: null,
    fingerprintId: null,
    manifestHash: null,
    providerRequestId: null,
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
    promptTokens: 0,
    completionTokens: 0,
    costUsd: 0,
    status: "error",
    metadata: {
      httpStatusCode: 502,
      upstreamError: "bad gateway",
    },
  });
});
