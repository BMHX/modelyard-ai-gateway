import { Readable } from "node:stream";

import {
  calculateUsageCostBreakdown,
  calculateUsageCostUsd,
  createUsageTokenCounts,
  resolveModelPricing,
} from "../pricing.js";

import type { GatewayProviderRequest, GatewayProviderResult, GatewayProviderUsageEvent } from "./types.js";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function collectPromptText(body: Record<string, unknown>) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const parts: string[] = [];

  for (const message of messages) {
    const record = asRecord(message);
    if (!record) {
      continue;
    }

    const directContent = asString(record.content);
    if (directContent) {
      parts.push(directContent);
      continue;
    }

    if (!Array.isArray(record.content)) {
      continue;
    }

    for (const item of record.content) {
      const contentRecord = asRecord(item);
      const text = contentRecord ? asString(contentRecord.text) : null;
      if (text) {
        parts.push(text);
      }
    }
  }

  return parts.join(" ").trim();
}

function buildDemoText(body: Record<string, unknown>) {
  const promptText = collectPromptText(body);
  if (!promptText) {
    return "Demo mode is enabled. This gateway is returning a synthetic completion without calling an upstream provider.";
  }

  return `Demo mode is enabled. The gateway accepted your prompt and generated a synthetic response for: ${promptText.slice(0, 180)}`;
}

function estimatePromptTokens(body: Record<string, unknown>) {
  return Math.max(24, Math.ceil(JSON.stringify(body).length / 4));
}

function estimateCompletionTokens(text: string) {
  return Math.max(32, Math.ceil(text.length / 4));
}

function isStreamRequested(request: GatewayProviderRequest) {
  return request.body.stream === true || request.requestHeaders.accept?.includes("text/event-stream") === true;
}

function createUsageEvent(
  request: GatewayProviderRequest,
  model: string,
  promptTokens: number,
  completionTokens: number,
  providerRequestId: string,
): GatewayProviderUsageEvent {
  const pricing = resolveModelPricing(
    request.providerConnection.provider,
    model,
    request.providerConnection.pricingConfig,
    request.metadata,
  );
  const usage = createUsageTokenCounts({
    promptTokens,
    completionTokens,
  });
  const pricingBreakdown = calculateUsageCostBreakdown(pricing, usage);

  return {
    providerRequestId,
    provider: request.providerConnection.provider,
    model,
    promptTokens,
    completionTokens,
    costUsd: calculateUsageCostUsd(pricing, usage),
    status: "success",
    metadata: {
      protocol: request.protocol,
      streamed: isStreamRequested(request),
      pricingSource: pricing?.source ?? "unknown",
      pricingInputUsdPerMillion: pricing?.inputUsdPerMillion ?? null,
      pricingOutputUsdPerMillion: pricing?.outputUsdPerMillion ?? null,
      pricingCachedInputUsdPerMillion: pricing?.cachedInputUsdPerMillion ?? null,
      pricingCacheReadInputUsdPerMillion:
        pricing?.cacheReadInputUsdPerMillion ?? null,
      pricingCacheWrite5mInputUsdPerMillion:
        pricing?.cacheWrite5mInputUsdPerMillion ?? null,
      pricingCacheWrite1hInputUsdPerMillion:
        pricing?.cacheWrite1hInputUsdPerMillion ?? null,
      pricingLongContextThresholdInputTokens:
        pricing?.longContextThresholdInputTokens ?? null,
      pricingLongContextInputUsdPerMillion:
        pricing?.longContextInputUsdPerMillion ?? null,
      pricingLongContextOutputUsdPerMillion:
        pricing?.longContextOutputUsdPerMillion ?? null,
      pricingLongContextCacheReadInputUsdPerMillion:
        pricing?.longContextCacheReadInputUsdPerMillion ?? null,
      pricingLongContextCacheWrite5mInputUsdPerMillion:
        pricing?.longContextCacheWrite5mInputUsdPerMillion ?? null,
      pricingLongContextCacheWrite1hInputUsdPerMillion:
        pricing?.longContextCacheWrite1hInputUsdPerMillion ?? null,
      canonicalModel: pricing?.canonicalModel ?? null,
      modelFamily: pricing?.modelFamily ?? null,
      modelMappingSource: pricing ? "pricing-resolver" : "unknown",
      cachedInputTokens: 0,
      cacheReadInputTokens: 0,
      cacheWrite5mInputTokens: 0,
      cacheWrite1hInputTokens: 0,
      reasoningTokens: 0,
      pricingBreakdown,
      demoMode: true,
      upstreamStatusCode: 200,
    },
  };
}

function createDemoUpstreamDebug(providerRequestId: string, contentType: string) {
  return {
    upstreamRequestId: providerRequestId,
    providerRequestId,
    contentType,
  };
}

function createAnthropicStream(requestId: string, model: string, text: string, promptTokens: number, completionTokens: number) {
  const lines = [
    `event: message_start\ndata: ${JSON.stringify({
      type: "message_start",
      message: {
        id: requestId,
        type: "message",
        role: "assistant",
        model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: {
          input_tokens: promptTokens,
          output_tokens: 0,
        },
      },
    })}\n\n`,
    `event: content_block_start\ndata: ${JSON.stringify({
      type: "content_block_start",
      index: 0,
      content_block: {
        type: "text",
        text: "",
      },
    })}\n\n`,
    `event: content_block_delta\ndata: ${JSON.stringify({
      type: "content_block_delta",
      index: 0,
      delta: {
        type: "text_delta",
        text,
      },
    })}\n\n`,
    `event: content_block_stop\ndata: ${JSON.stringify({
      type: "content_block_stop",
      index: 0,
    })}\n\n`,
    `event: message_delta\ndata: ${JSON.stringify({
      type: "message_delta",
      delta: {
        stop_reason: "end_turn",
        stop_sequence: null,
      },
      usage: {
        output_tokens: completionTokens,
      },
    })}\n\n`,
    "event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n",
  ];

  return Readable.from(lines);
}

function createOpenAiStream(requestId: string, model: string, text: string, promptTokens: number, completionTokens: number) {
  const created = Math.floor(Date.now() / 1000);
  const lines = [
    `data: ${JSON.stringify({
      id: requestId,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [
        {
          index: 0,
          delta: {
            role: "assistant",
          },
          finish_reason: null,
        },
      ],
    })}\n\n`,
    `data: ${JSON.stringify({
      id: requestId,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [
        {
          index: 0,
          delta: {
            content: text,
          },
          finish_reason: null,
        },
      ],
    })}\n\n`,
    `data: ${JSON.stringify({
      id: requestId,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [
        {
          index: 0,
          delta: {},
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
      },
    })}\n\n`,
    "data: [DONE]\n\n",
  ];

  return Readable.from(lines);
}

function createOpenAiResponsesStream(
  requestId: string,
  model: string,
  text: string,
  promptTokens: number,
  completionTokens: number,
) {
  const createdAt = Math.floor(Date.now() / 1000);
  const lines = [
    `event: response.created\ndata: ${JSON.stringify({
      type: "response.created",
      response: {
        id: requestId,
        object: "response",
        created_at: createdAt,
        model,
        output: [],
        usage: {
          input_tokens: promptTokens,
          output_tokens: 0,
          total_tokens: promptTokens,
        },
      },
    })}\n\n`,
    `event: response.output_text.delta\ndata: ${JSON.stringify({
      type: "response.output_text.delta",
      response_id: requestId,
      delta: text,
    })}\n\n`,
    `event: response.completed\ndata: ${JSON.stringify({
      type: "response.completed",
      response: {
        id: requestId,
        object: "response",
        created_at: createdAt,
        model,
        status: "completed",
        output: [
          {
            type: "message",
            id: `${requestId}_msg`,
            role: "assistant",
            content: [
              {
                type: "output_text",
                text,
                annotations: [],
              },
            ],
          },
        ],
        usage: {
          input_tokens: promptTokens,
          output_tokens: completionTokens,
          total_tokens: promptTokens + completionTokens,
        },
      },
    })}\n\n`,
  ];

  return Readable.from(lines);
}

export async function invokeDemoProvider(request: GatewayProviderRequest): Promise<GatewayProviderResult> {
  if (request.path === "/v1/models" || request.path.startsWith("/v1/models/")) {
    const created = Math.floor(Date.now() / 1000);
    const models = [
      {
        id: "gpt-4.1-mini",
        object: "model",
        created,
        owned_by: "openai",
      },
      {
        id: "gpt-4.1",
        object: "model",
        created,
        owned_by: "openai",
      },
      {
        id: "o4-mini",
        object: "model",
        created,
        owned_by: "openai",
      },
    ];
    const modelId = request.path === "/v1/models" ? null : decodeURIComponent(request.path.slice("/v1/models/".length));
    const matchedModel = modelId ? (models.find((item) => item.id === modelId) ?? null) : null;

    if (modelId && !matchedModel) {
      return {
        statusCode: 404,
        responseHeaders: {
          "content-type": "application/json; charset=utf-8",
          "x-teamops-demo-mode": "1",
        },
        responseKind: "json",
        responseBody: {
          error: {
            message: `The model '${modelId}' does not exist`,
            type: "invalid_request_error",
            param: "model",
            code: "model_not_found",
          },
        },
        upstreamDebug: createDemoUpstreamDebug(modelId, "application/json; charset=utf-8"),
        usageEventPromise: Promise.resolve({
          providerRequestId: modelId,
          provider: request.providerConnection.provider,
          model: modelId,
          promptTokens: 0,
          completionTokens: 0,
          costUsd: 0,
          status: "error",
          metadata: {
            protocol: request.protocol,
            streamed: false,
            pricingSource: "unknown",
            demoMode: true,
            upstreamStatusCode: 404,
            upstreamError: `The model '${modelId}' does not exist`,
          },
        }),
      };
    }

    if (modelId) {
      return {
        statusCode: 200,
        responseHeaders: {
          "content-type": "application/json; charset=utf-8",
          "x-teamops-demo-mode": "1",
        },
        responseKind: "json",
        responseBody: {
          ...(matchedModel ?? {}),
        },
        upstreamDebug: createDemoUpstreamDebug(modelId, "application/json; charset=utf-8"),
        usageEventPromise: Promise.resolve({
          providerRequestId: modelId,
          provider: request.providerConnection.provider,
          model: modelId,
          promptTokens: 0,
          completionTokens: 0,
          costUsd: 0,
          status: "success",
          metadata: {
            protocol: request.protocol,
            streamed: false,
            pricingSource: "unknown",
            demoMode: true,
            upstreamStatusCode: 200,
          },
        }),
      };
    }

    return {
      statusCode: 200,
      responseHeaders: {
        "content-type": "application/json; charset=utf-8",
        "x-teamops-demo-mode": "1",
      },
      responseKind: "json",
      responseBody: {
        object: "list",
        data: models,
      },
      upstreamDebug: createDemoUpstreamDebug("demo_models", "application/json; charset=utf-8"),
      usageEventPromise: Promise.resolve({
        providerRequestId: "demo_models",
        provider: request.providerConnection.provider,
        model: null,
        promptTokens: 0,
        completionTokens: 0,
        costUsd: 0,
        status: "success",
        metadata: {
          protocol: request.protocol,
          streamed: false,
          pricingSource: "unknown",
          demoMode: true,
          upstreamStatusCode: 200,
        },
      }),
    };
  }

  const model = typeof request.body.model === "string" ? request.body.model : "demo-model";
  const providerRequestId = `demo_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const text = buildDemoText(request.body);
  const promptTokens = estimatePromptTokens(request.body);
  const completionTokens = estimateCompletionTokens(text);
  const usageEvent = createUsageEvent(request, model, promptTokens, completionTokens, providerRequestId);

  if (isStreamRequested(request)) {
    if (request.protocol === "anthropic") {
      return {
        statusCode: 200,
        responseHeaders: {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
          connection: "keep-alive",
          "x-teamops-demo-mode": "1",
        },
        responseKind: "stream",
        responseBody: createAnthropicStream(providerRequestId, model, text, promptTokens, completionTokens),
        upstreamDebug: createDemoUpstreamDebug(providerRequestId, "text/event-stream; charset=utf-8"),
        usageEventPromise: Promise.resolve(usageEvent),
      };
    }

    if (request.path === "/v1/responses") {
      return {
        statusCode: 200,
        responseHeaders: {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
          connection: "keep-alive",
          "x-teamops-demo-mode": "1",
        },
        responseKind: "stream",
        responseBody: createOpenAiResponsesStream(providerRequestId, model, text, promptTokens, completionTokens),
        upstreamDebug: createDemoUpstreamDebug(providerRequestId, "text/event-stream; charset=utf-8"),
        usageEventPromise: Promise.resolve(usageEvent),
      };
    }

    return {
      statusCode: 200,
      responseHeaders: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        connection: "keep-alive",
        "x-teamops-demo-mode": "1",
      },
      responseKind: "stream",
      responseBody: createOpenAiStream(providerRequestId, model, text, promptTokens, completionTokens),
      upstreamDebug: createDemoUpstreamDebug(providerRequestId, "text/event-stream; charset=utf-8"),
      usageEventPromise: Promise.resolve(usageEvent),
    };
  }

  if (request.protocol === "anthropic") {
    return {
      statusCode: 200,
      responseHeaders: {
        "content-type": "application/json; charset=utf-8",
        "x-teamops-demo-mode": "1",
      },
      responseKind: "json",
      responseBody: {
        id: providerRequestId,
        type: "message",
        role: "assistant",
        model,
        stop_reason: "end_turn",
        stop_sequence: null,
        content: [
          {
            type: "text",
            text,
          },
        ],
        usage: {
          input_tokens: promptTokens,
          output_tokens: completionTokens,
        },
      },
      upstreamDebug: createDemoUpstreamDebug(providerRequestId, "application/json; charset=utf-8"),
      usageEventPromise: Promise.resolve(usageEvent),
    };
  }

  if (request.path === "/v1/responses") {
    return {
      statusCode: 200,
      responseHeaders: {
        "content-type": "application/json; charset=utf-8",
        "x-teamops-demo-mode": "1",
      },
      responseKind: "json",
      responseBody: {
        id: providerRequestId,
        object: "response",
        created_at: Math.floor(Date.now() / 1000),
        status: "completed",
        model,
        output: [
          {
            type: "message",
            id: `${providerRequestId}_msg`,
            role: "assistant",
            content: [
              {
                type: "output_text",
                text,
                annotations: [],
              },
            ],
          },
        ],
        usage: {
          input_tokens: promptTokens,
          output_tokens: completionTokens,
          total_tokens: promptTokens + completionTokens,
        },
      },
      upstreamDebug: createDemoUpstreamDebug(providerRequestId, "application/json; charset=utf-8"),
      usageEventPromise: Promise.resolve(usageEvent),
    };
  }

  return {
    statusCode: 200,
    responseHeaders: {
      "content-type": "application/json; charset=utf-8",
      "x-teamops-demo-mode": "1",
    },
    responseKind: "json",
    responseBody: {
      id: providerRequestId,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: text,
          },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
      },
    },
    upstreamDebug: createDemoUpstreamDebug(providerRequestId, "application/json; charset=utf-8"),
    usageEventPromise: Promise.resolve(usageEvent),
  };
}
