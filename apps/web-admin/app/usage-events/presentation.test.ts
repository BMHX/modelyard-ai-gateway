import assert from "node:assert/strict";
import test from "node:test";

import type { UsageEvent } from "@teamops/contracts";

import { describeUsageEventOutcome, getUsageEventStatusTone, getUsageEventSurface } from "./presentation";

function createUsageEvent(overrides: Partial<UsageEvent> = {}): UsageEvent {
  return {
    id: overrides.id ?? "11111111-1111-4111-8111-111111111111",
    workspaceId: overrides.workspaceId ?? "22222222-2222-4222-8222-222222222222",
    projectId: overrides.projectId ?? null,
    environmentId: overrides.environmentId ?? null,
    virtualKeyId: overrides.virtualKeyId ?? null,
    providerConnectionId: overrides.providerConnectionId ?? null,
    requestId: overrides.requestId ?? "req_123",
    providerRequestId: overrides.providerRequestId ?? "up_123",
    provider: overrides.provider ?? "openai",
    model: overrides.model ?? null,
    promptTokens: overrides.promptTokens ?? 0,
    completionTokens: overrides.completionTokens ?? 0,
    totalTokens: overrides.totalTokens ?? 0,
    costUsd: overrides.costUsd ?? 0,
    latencyMs: overrides.latencyMs ?? null,
    status: overrides.status ?? "success",
    metadata: overrides.metadata ?? {},
    createdAt: overrides.createdAt ?? "2026-04-03T00:00:00.000Z",
  };
}

test("getUsageEventSurface highlights metadata catalog requests", () => {
  const event = createUsageEvent({
    status: "success",
    metadata: {
      path: "/v1/models",
      protocol: "openai-compatible",
      httpStatusCode: 200,
      demoMode: true,
    },
  });

  const surface = getUsageEventSurface(event);

  assert.equal(surface.displayName, "usage.presentation.modelCatalog");
  assert.equal(surface.metadataRequest, true);
  assert.equal(surface.protocol, "openai-compatible");
  assert.deepEqual(
    surface.tags.map((tag) => tag.label),
    ["metadata", "demo", "HTTP 200"],
  );
});

test("describeUsageEventOutcome surfaces interrupted stream details", () => {
  const event = createUsageEvent({
    status: "error",
    metadata: {
      path: "/v1/chat/completions",
      protocol: "openai-compatible",
      streamed: true,
      streamInterrupted: true,
      streamError: "Premature close",
    },
  });

  const surface = getUsageEventSurface(event);
  const outcome = describeUsageEventOutcome(event);

  assert.equal(surface.streamInterrupted, true);
  assert.equal(surface.streamError, "Premature close");
  assert.equal(outcome.reasonLabel, "stream interrupted");
  assert.equal(outcome.detail, "Premature close");
});

test("getUsageEventStatusTone maps statuses to visual tones", () => {
  assert.equal(getUsageEventStatusTone("success"), "resolved");
  assert.equal(getUsageEventStatusTone("error"), "warning");
  assert.equal(getUsageEventStatusTone("blocked"), "critical");
});
