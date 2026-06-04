import {
  calculateUsageCostUsd,
  createUsageTokenCounts,
  type ResolvedModelPricing,
} from "./pricing.js";

import type { GatewayProtocol } from "./protocol.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toPositiveInteger(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.trunc(value);
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.trunc(parsed);
    }
  }

  return null;
}

function collectStringFragments(value: unknown, parts: string[], depth: number, budget: { visited: number }) {
  if (depth > 6 || budget.visited > 2_000) {
    return;
  }

  budget.visited += 1;

  if (typeof value === "string") {
    parts.push(value);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectStringFragments(item, parts, depth + 1, budget);
      if (budget.visited > 2_000) {
        break;
      }
    }
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    if (typeof nestedValue === "string") {
      parts.push(`${key}:${nestedValue}`);
      continue;
    }

    collectStringFragments(nestedValue, parts, depth + 1, budget);
    if (budget.visited > 2_000) {
      break;
    }
  }
}

function getExplicitRequestedCompletionTokens(body: Record<string, unknown>) {
  return (
    toPositiveInteger(body.max_tokens) ??
    toPositiveInteger(body.max_output_tokens) ??
    toPositiveInteger(body.max_completion_tokens) ??
    toPositiveInteger(body.max_tokens_to_sample)
  );
}

function getMetadataEstimatedCompletionTokens(
  protocol: GatewayProtocol,
  metadata: Record<string, string>,
) {
  return (
    toPositiveInteger(metadata[`budget.${protocol}.defaultEstimatedOutputTokens`]) ??
    toPositiveInteger(metadata.budgetDefaultEstimatedOutputTokens) ??
    toPositiveInteger(metadata.defaultEstimatedOutputTokens) ??
    toPositiveInteger(metadata.estimatedOutputTokens)
  );
}

function getProtocolFallbackCompletionTokens(protocol: GatewayProtocol) {
  return protocol === "anthropic" ? 1024 : 768;
}

export function estimatePromptTokens(body: Record<string, unknown>) {
  const serialized = JSON.stringify(body);
  const fragments: string[] = [];
  collectStringFragments(body, fragments, 0, { visited: 0 });
  const textLength = fragments.join(" ").length;

  return Math.max(24, Math.ceil(Math.max(serialized.length, textLength) / 4));
}

export function estimateCompletionTokens(
  body: Record<string, unknown>,
  protocol: GatewayProtocol,
  metadata: Record<string, string>,
) {
  const explicit = getExplicitRequestedCompletionTokens(body);
  if (explicit) {
    return {
      tokens: explicit,
      source: "request_cap" as const,
    };
  }

  const metadataDefault = getMetadataEstimatedCompletionTokens(protocol, metadata);
  if (metadataDefault) {
    return {
      tokens: metadataDefault,
      source: "provider_metadata" as const,
    };
  }

  return {
    tokens: getProtocolFallbackCompletionTokens(protocol),
    source: "protocol_default" as const,
  };
}

export function estimateRequestCost(args: {
  body: Record<string, unknown>;
  protocol: GatewayProtocol;
  metadata: Record<string, string>;
  pricing: ResolvedModelPricing;
}) {
  const promptTokens = estimatePromptTokens(args.body);
  const completionEstimate = estimateCompletionTokens(args.body, args.protocol, args.metadata);

  return {
    promptTokens,
    completionTokens: completionEstimate.tokens,
    completionSource: completionEstimate.source,
    costUsd: calculateUsageCostUsd(
      args.pricing,
      createUsageTokenCounts({
        promptTokens,
        completionTokens: completionEstimate.tokens,
      }),
    ),
  };
}
