import test from "node:test";
import assert from "node:assert/strict";

import { GatewayHttpError } from "../errors.js";
import { CLIENT_DISCONNECT_ABORT_REASON } from "../request-abort.js";
import { performProviderPassthrough } from "./shared.js";
import type { GatewayProviderRequest } from "./types.js";

function createProviderConnection(
  overrides: Partial<GatewayProviderRequest["providerConnection"]> = {},
): GatewayProviderRequest["providerConnection"] {
  return {
    id: "provider-1",
    workspaceId: "workspace-1",
    provider: "anthropic",
    label: "Anthropic",
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
    createdAt: "2026-04-03T00:00:00.000Z",
    updatedAt: "2026-04-03T00:00:00.000Z",
    ...overrides,
  };
}

function createRequest(overrides: Partial<GatewayProviderRequest> = {}): GatewayProviderRequest {
  return {
    method: overrides.method ?? "POST",
    path: overrides.path ?? "/v1/messages",
    search: overrides.search ?? "",
    protocol: overrides.protocol ?? "anthropic",
    body: overrides.body ?? {
      model: "claude-sonnet-4-20250514",
      messages: [],
    },
    providerConnection: overrides.providerConnection ?? createProviderConnection(),
    apiKey: overrides.apiKey ?? "test-key",
    metadata: overrides.metadata ?? {},
    demoMode: overrides.demoMode ?? false,
    requestHeaders: overrides.requestHeaders ?? {},
    signal: overrides.signal ?? AbortSignal.timeout(1_000),
  };
}

test("performProviderPassthrough returns parsed JSON and usage metadata", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        id: "msg_123",
        model: "claude-sonnet-4-20250514",
        usage: {
          input_tokens: 120,
          output_tokens: 45,
        },
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json",
          "request-id": "req_123",
        },
      },
    )) as typeof fetch;

  try {
    const result = await performProviderPassthrough({
      request: createRequest(),
      url: "https://example.com/v1/messages",
      headers: {
        "content-type": "application/json",
      },
    });

    assert.equal(result.responseKind, "json");
    assert.equal(result.statusCode, 200);
    assert.equal(result.responseHeaders["request-id"], "req_123");
    assert.deepEqual(result.upstreamDebug, {
      upstreamRequestId: "req_123",
      providerRequestId: "msg_123",
      contentType: "application/json",
    });

    const usageEvent = await result.usageEventPromise;
    assert.equal(usageEvent.providerRequestId, "msg_123");
    assert.equal(usageEvent.promptTokens, 120);
    assert.equal(usageEvent.completionTokens, 45);
    assert.equal(usageEvent.status, "success");
    assert.equal(usageEvent.costUsd, 0.001035);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("performProviderPassthrough captures OpenAI cached input and reasoning token metadata", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        id: "resp_cached",
        object: "response",
        model: "gpt-4.1-mini",
        usage: {
          prompt_tokens: 1000,
          completion_tokens: 200,
          prompt_tokens_details: {
            cached_tokens: 400,
          },
          completion_tokens_details: {
            reasoning_tokens: 80,
          },
        },
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      },
    )) as typeof fetch;

  try {
    const result = await performProviderPassthrough({
      request: createRequest({
        path: "/v1/responses",
        protocol: "openai-compatible",
        body: {
          model: "gpt-4.1-mini",
          input: "hello",
        },
        providerConnection: createProviderConnection({
          provider: "openai",
          label: "OpenAI",
        }),
      }),
      url: "https://example.com/v1/responses",
      headers: {
        "content-type": "application/json",
      },
    });

    const usageEvent = await result.usageEventPromise;
    assert.equal(usageEvent.promptTokens, 1000);
    assert.equal(usageEvent.completionTokens, 200);
    assert.equal(usageEvent.costUsd, 0.0006);
    assert.equal((usageEvent.metadata as Record<string, unknown>).cachedInputTokens, 400);
    assert.equal((usageEvent.metadata as Record<string, unknown>).reasoningTokens, 80);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("performProviderPassthrough captures Anthropic cache usage and long-context pricing metadata", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        id: "msg_cache",
        model: "claude-sonnet-4-20250514",
        usage: {
          input_tokens: 120000,
          output_tokens: 10000,
          cache_creation_input_tokens: 40000,
          cache_read_input_tokens: 50000,
          cache_creation: {
            ephemeral_5m_input_tokens: 25000,
            ephemeral_1h_input_tokens: 15000,
          },
        },
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      },
    )) as typeof fetch;

  try {
    const result = await performProviderPassthrough({
      request: createRequest(),
      url: "https://example.com/v1/messages",
      headers: {
        "content-type": "application/json",
      },
    });

    const usageEvent = await result.usageEventPromise;
    assert.equal(usageEvent.promptTokens, 210000);
    assert.equal(usageEvent.completionTokens, 10000);
    assert.equal(usageEvent.costUsd, 1.3425);
    assert.equal((usageEvent.metadata as Record<string, unknown>).cacheReadInputTokens, 50000);
    assert.equal((usageEvent.metadata as Record<string, unknown>).cacheWrite5mInputTokens, 25000);
    assert.equal((usageEvent.metadata as Record<string, unknown>).cacheWrite1hInputTokens, 15000);
    assert.equal(
      ((usageEvent.metadata as Record<string, unknown>).pricingBreakdown as Record<string, unknown>)
        .appliedLongContextPricing,
      true,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("performProviderPassthrough extracts Anthropic SSE usage", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      [
        "event: message_start",
        `data: ${JSON.stringify({
          type: "message_start",
          message: {
            id: "msg_stream",
            type: "message",
            role: "assistant",
            model: "claude-sonnet-4-20250514",
            usage: {
              input_tokens: 88,
              output_tokens: 0,
            },
          },
        })}`,
        "",
        "event: message_delta",
        `data: ${JSON.stringify({
          type: "message_delta",
          usage: {
            output_tokens: 21,
          },
        })}`,
        "",
      ].join("\n"),
      {
        status: 200,
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
        },
      },
    )) as typeof fetch;

  try {
    const result = await performProviderPassthrough({
      request: createRequest(),
      url: "https://example.com/v1/messages",
      headers: {
        "content-type": "application/json",
      },
    });

    assert.equal(result.responseKind, "stream");
    assert.deepEqual(result.upstreamDebug, {
      upstreamRequestId: null,
      providerRequestId: null,
      contentType: "text/event-stream; charset=utf-8",
    });

    const usageEvent = await result.usageEventPromise;
    assert.equal(usageEvent.providerRequestId, "msg_stream");
    assert.equal(usageEvent.promptTokens, 88);
    assert.equal(usageEvent.completionTokens, 21);
    assert.equal(usageEvent.status, "success");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("performProviderPassthrough extracts OpenAI-compatible SSE usage", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      [
        `data: ${JSON.stringify({
          id: "chatcmpl_123",
          object: "chat.completion.chunk",
          model: "gpt-4.1-mini",
          choices: [
            {
              index: 0,
              delta: {
                role: "assistant",
              },
              finish_reason: null,
            },
          ],
        })}`,
        "",
        `data: ${JSON.stringify({
          id: "chatcmpl_123",
          object: "chat.completion.chunk",
          model: "gpt-4.1-mini",
          choices: [
            {
              index: 0,
              delta: {},
              finish_reason: "stop",
            },
          ],
          usage: {
            prompt_tokens: 55,
            completion_tokens: 13,
          },
        })}`,
        "",
        "data: [DONE]",
        "",
      ].join("\n"),
      {
        status: 200,
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
        },
      },
    )) as typeof fetch;

  try {
    const result = await performProviderPassthrough({
      request: createRequest({
        path: "/v1/chat/completions",
        protocol: "openai-compatible",
        body: {
          model: "gpt-4.1-mini",
          messages: [],
          stream: true,
        },
        providerConnection: createProviderConnection({
          id: "provider-openai",
          provider: "openai",
          label: "OpenAI",
        }),
      }),
      url: "https://example.com/v1/chat/completions",
      headers: {
        "content-type": "application/json",
      },
    });

    assert.equal(result.responseKind, "stream");
    assert.deepEqual(result.upstreamDebug, {
      upstreamRequestId: null,
      providerRequestId: null,
      contentType: "text/event-stream; charset=utf-8",
    });

    const usageEvent = await result.usageEventPromise;
    assert.equal(usageEvent.providerRequestId, "chatcmpl_123");
    assert.equal(usageEvent.promptTokens, 55);
    assert.equal(usageEvent.completionTokens, 13);
    assert.equal(usageEvent.costUsd, 0.000043);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("performProviderPassthrough extracts OpenAI responses SSE usage", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      [
        `event: response.created`,
        `data: ${JSON.stringify({
          type: "response.created",
          response: {
            id: "resp_123",
            object: "response",
            model: "gpt-4.1-mini",
            usage: {
              input_tokens: 34,
              output_tokens: 0,
            },
          },
        })}`,
        "",
        `event: response.completed`,
        `data: ${JSON.stringify({
          type: "response.completed",
          response: {
            id: "resp_123",
            object: "response",
            model: "gpt-4.1-mini",
            usage: {
              input_tokens: 34,
              output_tokens: 9,
            },
          },
        })}`,
        "",
      ].join("\n"),
      {
        status: 200,
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
        },
      },
    )) as typeof fetch;

  try {
    const result = await performProviderPassthrough({
      request: createRequest({
        path: "/v1/responses",
        protocol: "openai-compatible",
        body: {
          model: "gpt-4.1-mini",
          input: "hello",
          stream: true,
        },
        providerConnection: createProviderConnection({
          id: "provider-openai",
          provider: "openai",
          label: "OpenAI",
        }),
      }),
      url: "https://example.com/v1/responses",
      headers: {
        "content-type": "application/json",
      },
    });

    assert.equal(result.responseKind, "stream");
    assert.deepEqual(result.upstreamDebug, {
      upstreamRequestId: null,
      providerRequestId: null,
      contentType: "text/event-stream; charset=utf-8",
    });

    const usageEvent = await result.usageEventPromise;
    assert.equal(usageEvent.providerRequestId, "resp_123");
    assert.equal(usageEvent.promptTokens, 34);
    assert.equal(usageEvent.completionTokens, 9);
    assert.equal(usageEvent.costUsd, 0.000028);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("performProviderPassthrough maps client disconnect aborts to 499", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    const abortError = new Error("aborted");
    abortError.name = "AbortError";
    throw abortError;
  }) as typeof fetch;

  try {
    const controller = new AbortController();
    controller.abort(CLIENT_DISCONNECT_ABORT_REASON);

    await assert.rejects(
      () =>
        performProviderPassthrough({
          request: createRequest({
            signal: controller.signal,
          }),
          url: "https://example.com/v1/messages",
          headers: {
            "content-type": "application/json",
          },
        }),
      (error) =>
        error instanceof GatewayHttpError &&
        error.statusCode === 499 &&
        error.message.includes("Client disconnected"),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("performProviderPassthrough sends GET requests without a request body", async () => {
  const originalFetch = globalThis.fetch;
  let observedMethod = "";
  let observedBody: unknown;

  globalThis.fetch = (async (_input, init) => {
    observedMethod = init?.method ?? "";
    observedBody = init?.body;

    return new Response(
      JSON.stringify({
        object: "list",
        data: [
          {
            id: "gpt-4.1-mini",
            object: "model",
          },
        ],
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
    const result = await performProviderPassthrough({
      request: createRequest({
        method: "GET",
        path: "/v1/models",
        protocol: "openai-compatible",
        body: {},
        providerConnection: createProviderConnection({
          id: "provider-openai",
          provider: "openai",
          label: "OpenAI",
        }),
      }),
      url: "https://example.com/v1/models",
      headers: {
        authorization: "Bearer test-key",
      },
    });

    assert.equal(observedMethod, "GET");
    assert.equal(observedBody, undefined);
    assert.equal(result.responseKind, "json");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
