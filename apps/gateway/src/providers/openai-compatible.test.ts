import test from "node:test";
import assert from "node:assert/strict";

import { invokeOpenAiCompatible } from "./openai-compatible.js";
import type { GatewayProviderRequest } from "./types.js";

function createRequest(overrides: Partial<GatewayProviderRequest> = {}): GatewayProviderRequest {
  return {
    method: "GET",
    path: "/v1/models",
    search: "",
    protocol: "openai-compatible",
    body: {},
    providerConnection: {
      id: "provider-openai",
      workspaceId: "workspace-1",
      provider: "openai",
      label: "OpenAI",
      metadata: {},
      pricingConfig: null,
      baseUrl: null,
      anthropicVersion: null,
      status: "active",
      revokedAt: null,
      lastTestedAt: null,
      lastTestStatus: null,
      lastTestError: null,
      lastTestStatusCode: null,
      lastTestLatencyMs: null,
      createdAt: "2026-04-04T00:00:00.000Z",
      updatedAt: "2026-04-04T00:00:00.000Z",
    },
    apiKey: "test-key",
    metadata: {},
    demoMode: false,
    requestHeaders: {},
    signal: AbortSignal.timeout(1_000),
    ...overrides,
  };
}

test("invokeOpenAiCompatible forwards query strings and omits content-type on GET models requests", async () => {
  const originalFetch = globalThis.fetch;
  let observedUrl = "";
  let observedMethod = "";
  let observedHeaders: unknown;
  let observedBody: unknown;

  globalThis.fetch = (async (
    input: unknown,
    init?: {
      method?: string;
      headers?: unknown;
      body?: unknown;
    },
  ) => {
    observedUrl = String(input);
    observedMethod = init?.method ?? "";
    observedHeaders = init?.headers;
    observedBody = init?.body;

    return new Response(
      JSON.stringify({
        object: "list",
        data: [],
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      },
    );
  }) as typeof fetch;

  try {
    const result = await invokeOpenAiCompatible(
      createRequest({
        search: "?limit=10&after=model_123",
      }),
    );

    assert.equal(result.statusCode, 200);
    assert.equal(observedUrl, "https://api.openai.com/v1/models?limit=10&after=model_123");
    assert.equal(observedMethod, "GET");
    assert.equal(observedBody, undefined);

    const headers = observedHeaders instanceof Headers ? observedHeaders : new Headers(observedHeaders as Record<string, string>);
    assert.equal(headers.get("authorization"), "Bearer test-key");
    assert.equal(headers.has("content-type"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("invokeOpenAiCompatible forwards OpenAI SDK compatibility headers", async () => {
  const originalFetch = globalThis.fetch;
  let observedHeaders: Record<string, string> | null = null;

  globalThis.fetch = (async (_input, init) => {
    const normalized = new Headers(init?.headers as Record<string, string>);
    observedHeaders = Object.fromEntries(normalized.entries());

    return new Response(
      JSON.stringify({
        id: "resp_123",
        object: "response",
        model: "gpt-4.1-mini",
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      },
    );
  }) as typeof fetch;

  try {
    await invokeOpenAiCompatible(
      createRequest({
        method: "POST",
        path: "/v1/responses",
        search: "",
        body: {
          model: "gpt-4.1-mini",
          input: "hello",
        },
        requestHeaders: {
          "openai-beta": "responses=v1",
          "idempotency-key": "idem_123",
          "x-stainless-lang": "ts",
          "x-stainless-runtime": "node",
        },
      }),
    );

    if (!observedHeaders) {
      throw new Error("Expected forwarded headers to be captured");
    }

    assert.equal(observedHeaders["openai-beta"], "responses=v1");
    assert.equal(observedHeaders["idempotency-key"], "idem_123");
    assert.equal(observedHeaders["x-stainless-lang"], "ts");
    assert.equal(observedHeaders["x-stainless-runtime"], "node");
    assert.equal(observedHeaders["content-type"], "application/json");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
