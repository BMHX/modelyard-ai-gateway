import assert from "node:assert/strict";
import test from "node:test";

import { finalizeStreamUsageEvent } from "./stream-usage.js";

test("finalizeStreamUsageEvent preserves successful stream events when delivery completes", () => {
  const usageEvent = finalizeStreamUsageEvent({
    usageEvent: {
      providerRequestId: "req_stream_ok",
      provider: "openai",
      model: "gpt-4.1-mini",
      promptTokens: 42,
      completionTokens: 18,
      costUsd: 0.00024,
      status: "success",
      metadata: {
        streamed: true,
      },
    },
    streamError: null,
    clientDisconnected: false,
  });

  assert.equal(usageEvent.status, "success");
  assert.equal(usageEvent.promptTokens, 42);
  assert.equal(usageEvent.completionTokens, 18);
  assert.equal((usageEvent.metadata as Record<string, unknown>).streamError, null);
  assert.equal((usageEvent.metadata as Record<string, unknown>).streamInterrupted, false);
});

test("finalizeStreamUsageEvent marks interrupted streams as errors", () => {
  const usageEvent = finalizeStreamUsageEvent({
    usageEvent: {
      providerRequestId: "req_stream_partial",
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      promptTokens: 91,
      completionTokens: 12,
      costUsd: 0.0012,
      status: "success",
      metadata: {
        streamed: true,
      },
    },
    streamError: new Error("Premature close"),
    clientDisconnected: false,
  });

  assert.equal(usageEvent.status, "error");
  assert.equal((usageEvent.metadata as Record<string, unknown>).streamError, "Premature close");
  assert.equal((usageEvent.metadata as Record<string, unknown>).streamInterrupted, true);
  assert.equal((usageEvent.metadata as Record<string, unknown>).reason, "stream_pipeline_terminated");
});

test("finalizeStreamUsageEvent records client disconnect reasons without losing observed usage", () => {
  const usageEvent = finalizeStreamUsageEvent({
    usageEvent: {
      providerRequestId: "req_stream_disconnect",
      provider: "openai",
      model: "gpt-4.1-mini",
      promptTokens: 64,
      completionTokens: 27,
      costUsd: 0.00031,
      status: "success",
      metadata: {
        streamed: true,
      },
    },
    streamError: new Error("socket hang up"),
    clientDisconnected: true,
  });

  assert.equal(usageEvent.status, "error");
  assert.equal(usageEvent.promptTokens, 64);
  assert.equal(usageEvent.completionTokens, 27);
  assert.equal((usageEvent.metadata as Record<string, unknown>).reason, "client_disconnected");
  assert.equal((usageEvent.metadata as Record<string, unknown>).streamInterrupted, true);
});
