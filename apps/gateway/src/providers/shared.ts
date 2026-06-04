import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";

import { GatewayHttpError } from "../errors.js";
import {
  calculateUsageCostBreakdown,
  calculateUsageCostUsd,
  createUsageTokenCounts,
  resolveModelPricing,
  type ResolvedModelPricing,
  type UsageTokenCounts,
} from "../pricing.js";
import { isClientDisconnectAbortReason } from "../request-abort.js";

import type {
  GatewayProviderRequest,
  GatewayProviderResult,
  GatewayProviderUsageEvent,
} from "./types.js";

const blockedResponseHeaders = new Set([
  "connection",
  "content-length",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const blockedConfiguredRequestHeaders = new Set([
  "authorization",
  "content-length",
  "connection",
  "host",
  "x-api-key",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toNonNegativeInteger(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.trunc(value));
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.trunc(parsed));
    }
  }

  return 0;
}

function formatErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "unknown error";
}

function looksLikeJsonContentType(contentType?: string | null) {
  if (!contentType) {
    return false;
  }

  const normalized = contentType.toLowerCase();
  return normalized.includes("application/json") || normalized.includes("+json");
}

function isEventStream(contentType?: string | null) {
  return contentType?.toLowerCase().includes("text/event-stream") ?? false;
}

function maybeParseJsonBody(rawBody: string, contentType?: string | null) {
  if (!rawBody.trim()) {
    return null;
  }

  if (
    !looksLikeJsonContentType(contentType) &&
    !rawBody.trimStart().startsWith("{") &&
    !rawBody.trimStart().startsWith("[")
  ) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawBody) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function getHeaderValue(headers: Headers, headerName: string) {
  return headers.get(headerName) ?? headers.get(headerName.toLowerCase()) ?? null;
}

function getUpstreamRequestId(headers: Headers) {
  return getHeaderValue(headers, "request-id") ?? getHeaderValue(headers, "x-request-id");
}

function copyPassthroughResponseHeaders(headers: Headers) {
  const responseHeaders: Record<string, string> = {};

  for (const [name, value] of headers) {
    if (blockedResponseHeaders.has(name.toLowerCase())) {
      continue;
    }

    responseHeaders[name] = value;
  }

  return responseHeaders;
}

export function getConfiguredRequestHeaders(metadata: Record<string, string>) {
  const headers: Record<string, string> = {};

  for (const [key, value] of Object.entries(metadata)) {
    if (typeof value !== "string" || value.trim().length === 0) {
      continue;
    }

    const prefix = key.startsWith("header.")
      ? "header."
      : key.startsWith("headers.")
        ? "headers."
        : null;
    if (!prefix) {
      continue;
    }

    const headerName = key.slice(prefix.length).trim();
    if (!headerName) {
      continue;
    }

    if (blockedConfiguredRequestHeaders.has(headerName.toLowerCase())) {
      continue;
    }

    headers[headerName] = value;
  }

  return headers;
}

function getNestedRecord(record: Record<string, unknown> | null, key: string) {
  const nested = record?.[key];
  return isRecord(nested) ? nested : null;
}

function mergeUsageCounts(current: UsageTokenCounts, next: UsageTokenCounts) {
  return createUsageTokenCounts({
    promptTokens: Math.max(current.promptTokens, next.promptTokens),
    completionTokens: Math.max(current.completionTokens, next.completionTokens),
    cachedInputTokens: Math.max(current.cachedInputTokens, next.cachedInputTokens),
    cacheReadInputTokens: Math.max(
      current.cacheReadInputTokens,
      next.cacheReadInputTokens,
    ),
    cacheWrite5mInputTokens: Math.max(
      current.cacheWrite5mInputTokens,
      next.cacheWrite5mInputTokens,
    ),
    cacheWrite1hInputTokens: Math.max(
      current.cacheWrite1hInputTokens,
      next.cacheWrite1hInputTokens,
    ),
    reasoningTokens: Math.max(current.reasoningTokens, next.reasoningTokens),
  });
}

function buildOpenAiUsageCounts(usage: Record<string, unknown>) {
  const promptTokenDetails =
    getNestedRecord(usage, "prompt_tokens_details") ??
    getNestedRecord(usage, "input_tokens_details");
  const completionTokenDetails =
    getNestedRecord(usage, "completion_tokens_details") ??
    getNestedRecord(usage, "output_tokens_details");

  return createUsageTokenCounts({
    promptTokens: toNonNegativeInteger(usage.prompt_tokens ?? usage.input_tokens),
    completionTokens: toNonNegativeInteger(
      usage.completion_tokens ?? usage.output_tokens,
    ),
    cachedInputTokens: toNonNegativeInteger(promptTokenDetails?.cached_tokens),
    reasoningTokens: toNonNegativeInteger(
      completionTokenDetails?.reasoning_tokens,
    ),
  });
}

function getAnthropicCacheCreationRecord(records: Array<Record<string, unknown> | null>) {
  for (const record of records) {
    const cacheCreation = getNestedRecord(record, "cache_creation");
    if (cacheCreation) {
      return cacheCreation;
    }
  }

  return null;
}

function buildAnthropicUsageCounts(
  usage: Record<string, unknown>,
  records: Array<Record<string, unknown> | null>,
) {
  const cacheCreationInputTokens = toNonNegativeInteger(
    usage.cache_creation_input_tokens,
  );
  const cacheReadInputTokens = toNonNegativeInteger(usage.cache_read_input_tokens);
  const cacheCreation = getAnthropicCacheCreationRecord([usage, ...records]);
  const explicitCacheWrite5mInputTokens = toNonNegativeInteger(
    cacheCreation?.ephemeral_5m_input_tokens ?? usage.ephemeral_5m_input_tokens,
  );
  const explicitCacheWrite1hInputTokens = toNonNegativeInteger(
    cacheCreation?.ephemeral_1h_input_tokens ?? usage.ephemeral_1h_input_tokens,
  );
  const hasExplicitCacheWriteBreakdown =
    explicitCacheWrite5mInputTokens > 0 || explicitCacheWrite1hInputTokens > 0;

  return createUsageTokenCounts({
    promptTokens:
      toNonNegativeInteger(usage.input_tokens) +
      cacheCreationInputTokens +
      cacheReadInputTokens,
    completionTokens: toNonNegativeInteger(usage.output_tokens),
    cacheReadInputTokens,
    cacheWrite5mInputTokens: hasExplicitCacheWriteBreakdown
      ? explicitCacheWrite5mInputTokens
      : cacheCreationInputTokens,
    cacheWrite1hInputTokens: hasExplicitCacheWriteBreakdown
      ? explicitCacheWrite1hInputTokens
      : 0,
  });
}

function extractUsageFromPayload(
  protocol: GatewayProviderRequest["protocol"],
  payload: Record<string, unknown> | null,
) {
  if (!payload) {
    return createUsageTokenCounts({
      promptTokens: 0,
      completionTokens: 0,
    });
  }

  const usage = isRecord(payload.usage)
    ? payload.usage
    : isRecord(payload.response) && isRecord(payload.response.usage)
      ? payload.response.usage
      : null;

  if (!usage) {
    return createUsageTokenCounts({
      promptTokens: 0,
      completionTokens: 0,
    });
  }

  if (protocol === "anthropic") {
    return buildAnthropicUsageCounts(usage, [
      payload,
      getNestedRecord(payload, "message"),
    ]);
  }

  return buildOpenAiUsageCounts(usage);
}

function extractProviderRequestId(
  payload: Record<string, unknown> | null,
  headers: Headers,
) {
  if (payload && typeof payload.id === "string" && payload.id.trim().length > 0) {
    return payload.id;
  }

  if (isRecord(payload?.response) && typeof payload.response.id === "string") {
    return payload.response.id.trim() || getUpstreamRequestId(headers);
  }

  return getUpstreamRequestId(headers);
}

function extractModel(
  payload: Record<string, unknown> | null,
  fallbackModel: string | null,
) {
  if (payload && typeof payload.model === "string" && payload.model.trim().length > 0) {
    return payload.model;
  }

  if (isRecord(payload?.response) && typeof payload.response.model === "string") {
    return payload.response.model.trim() || fallbackModel;
  }

  return fallbackModel;
}

function summarizeError(payload: Record<string, unknown> | null, rawBody: string) {
  if (payload) {
    const nestedError = isRecord(payload.error) ? payload.error : null;
    if (nestedError && typeof nestedError.message === "string") {
      return nestedError.message;
    }

    if (typeof payload.message === "string") {
      return payload.message;
    }
  }

  if (!rawBody) {
    return "empty upstream error body";
  }

  return rawBody.slice(0, 4000);
}

function buildUsageMetadata(args: {
  request: GatewayProviderRequest;
  response: Response;
  payload: Record<string, unknown> | null;
  rawBody?: string;
  streamed: boolean;
  pricing: ResolvedModelPricing | null;
  usage: UsageTokenCounts;
  streamParseError?: string;
}) {
  const upstreamRequestId = getUpstreamRequestId(args.response.headers);
  const pricingBreakdown = calculateUsageCostBreakdown(args.pricing, args.usage);

  return {
    protocol: args.request.protocol,
    streamed: args.streamed,
    upstreamStatusCode: args.response.status,
    contentType: args.response.headers.get("content-type"),
    pricingSource: args.pricing?.source ?? "unknown",
    pricingInputUsdPerMillion: args.pricing?.inputUsdPerMillion ?? null,
    pricingOutputUsdPerMillion: args.pricing?.outputUsdPerMillion ?? null,
    pricingCachedInputUsdPerMillion:
      args.pricing?.cachedInputUsdPerMillion ?? null,
    pricingCacheReadInputUsdPerMillion:
      args.pricing?.cacheReadInputUsdPerMillion ?? null,
    pricingCacheWrite5mInputUsdPerMillion:
      args.pricing?.cacheWrite5mInputUsdPerMillion ?? null,
    pricingCacheWrite1hInputUsdPerMillion:
      args.pricing?.cacheWrite1hInputUsdPerMillion ?? null,
    pricingLongContextThresholdInputTokens:
      args.pricing?.longContextThresholdInputTokens ?? null,
    pricingLongContextInputUsdPerMillion:
      args.pricing?.longContextInputUsdPerMillion ?? null,
    pricingLongContextOutputUsdPerMillion:
      args.pricing?.longContextOutputUsdPerMillion ?? null,
    pricingLongContextCacheReadInputUsdPerMillion:
      args.pricing?.longContextCacheReadInputUsdPerMillion ?? null,
    pricingLongContextCacheWrite5mInputUsdPerMillion:
      args.pricing?.longContextCacheWrite5mInputUsdPerMillion ?? null,
    pricingLongContextCacheWrite1hInputUsdPerMillion:
      args.pricing?.longContextCacheWrite1hInputUsdPerMillion ?? null,
    canonicalModel: args.pricing?.canonicalModel ?? null,
    modelFamily: args.pricing?.modelFamily ?? null,
    modelMappingSource: args.pricing ? "pricing-resolver" : "unknown",
    cachedInputTokens: args.usage.cachedInputTokens,
    cacheReadInputTokens: args.usage.cacheReadInputTokens,
    cacheWrite5mInputTokens: args.usage.cacheWrite5mInputTokens,
    cacheWrite1hInputTokens: args.usage.cacheWrite1hInputTokens,
    reasoningTokens: args.usage.reasoningTokens,
    pricingBreakdown,
    upstreamRequestId,
    streamParseError: args.streamParseError ?? null,
    upstreamError: args.response.ok
      ? null
      : summarizeError(args.payload, args.rawBody ?? ""),
  };
}

function buildUsageEventFromPayload(args: {
  request: GatewayProviderRequest;
  response: Response;
  payload: Record<string, unknown> | null;
  rawBody: string;
}): GatewayProviderUsageEvent {
  const model = extractModel(
    args.payload,
    typeof args.request.body.model === "string" ? args.request.body.model : null,
  );
  const usage = extractUsageFromPayload(args.request.protocol, args.payload);
  const pricing = model
    ? resolveModelPricing(
        args.request.providerConnection.provider,
        model,
        args.request.providerConnection.pricingConfig,
        args.request.metadata,
      )
    : null;

  return {
    providerRequestId: extractProviderRequestId(args.payload, args.response.headers),
    provider: args.request.providerConnection.provider,
    model,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    costUsd: calculateUsageCostUsd(pricing, usage),
    status: args.response.ok ? "success" : "error",
    metadata: buildUsageMetadata({
      request: args.request,
      response: args.response,
      payload: args.payload,
      rawBody: args.rawBody,
      streamed: false,
      pricing,
      usage,
    }),
  };
}

function handleSseChunk(
  rawEvent: string,
  onEvent: (eventName: string | null, payload: Record<string, unknown>) => void,
) {
  const lines = rawEvent.split("\n");
  const dataLines: string[] = [];
  let eventName: string | null = null;

  for (const line of lines) {
    if (!line || line.startsWith(":")) {
      continue;
    }

    if (line.startsWith("event:")) {
      eventName = line.slice("event:".length).trim() || null;
      continue;
    }

    if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  }

  const payloadText = dataLines.join("\n").trim();
  if (!payloadText || payloadText === "[DONE]") {
    return;
  }

  try {
    const parsed = JSON.parse(payloadText) as unknown;
    if (isRecord(parsed)) {
      onEvent(eventName, parsed);
    }
  } catch {
    // Ignore non-JSON event payloads.
  }
}

async function consumeSseJsonEvents(
  stream: WebReadableStream<Uint8Array>,
  onEvent: (eventName: string | null, payload: Record<string, unknown>) => void,
) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const flush = (force = false) => {
    let normalized = buffer.replace(/\r\n/g, "\n");
    let separatorIndex = normalized.indexOf("\n\n");

    while (separatorIndex >= 0) {
      handleSseChunk(normalized.slice(0, separatorIndex), onEvent);
      normalized = normalized.slice(separatorIndex + 2);
      separatorIndex = normalized.indexOf("\n\n");
    }

    buffer = normalized;
    if (force && buffer.trim().length > 0) {
      handleSseChunk(buffer, onEvent);
      buffer = "";
    }
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      flush();
    }

    buffer += decoder.decode();
    flush(true);
  } finally {
    reader.releaseLock();
  }
}

async function buildUsageEventFromStream(args: {
  request: GatewayProviderRequest;
  response: Response;
  stream: WebReadableStream<Uint8Array>;
}): Promise<GatewayProviderUsageEvent> {
  let providerRequestId =
    getHeaderValue(args.response.headers, "request-id") ??
    getHeaderValue(args.response.headers, "x-request-id");
  let model =
    typeof args.request.body.model === "string" ? args.request.body.model : null;
  let usage = createUsageTokenCounts({
    promptTokens: 0,
    completionTokens: 0,
  });
  let streamParseError: string | undefined;

  try {
    await consumeSseJsonEvents(args.stream, (eventName, payload) => {
      if (typeof payload.id === "string" && payload.id.trim().length > 0) {
        providerRequestId = payload.id;
      }

      if (typeof payload.model === "string" && payload.model.trim().length > 0) {
        model = payload.model;
      }

      if (args.request.protocol === "anthropic") {
        const message = getNestedRecord(payload, "message");
        if (message) {
          if (typeof message.id === "string" && message.id.trim().length > 0) {
            providerRequestId = message.id;
          }

          if (
            typeof message.model === "string" &&
            message.model.trim().length > 0
          ) {
            model = message.model;
          }

          const messageUsage = getNestedRecord(message, "usage");
          if (messageUsage) {
            usage = mergeUsageCounts(
              usage,
              buildAnthropicUsageCounts(messageUsage, [payload, message]),
            );
          }
        }

        if (eventName === "message_delta") {
          const deltaUsage = getNestedRecord(payload, "usage");
          if (deltaUsage) {
            usage = mergeUsageCounts(
              usage,
              buildAnthropicUsageCounts(deltaUsage, [payload]),
            );
          }
        }
      } else {
        const payloadUsage = getNestedRecord(payload, "usage");
        const responseRecord = getNestedRecord(payload, "response");
        const responseUsage = getNestedRecord(responseRecord, "usage");

        if (responseRecord) {
          if (
            typeof responseRecord.id === "string" &&
            responseRecord.id.trim().length > 0
          ) {
            providerRequestId = responseRecord.id;
          }

          if (
            typeof responseRecord.model === "string" &&
            responseRecord.model.trim().length > 0
          ) {
            model = responseRecord.model;
          }
        }

        if (payloadUsage) {
          usage = mergeUsageCounts(usage, buildOpenAiUsageCounts(payloadUsage));
        }

        if (responseUsage) {
          usage = mergeUsageCounts(usage, buildOpenAiUsageCounts(responseUsage));
        }
      }
    });
  } catch (error) {
    streamParseError = formatErrorMessage(error);
  }

  const pricing = model
    ? resolveModelPricing(
        args.request.providerConnection.provider,
        model,
        args.request.providerConnection.pricingConfig,
        args.request.metadata,
      )
    : null;

  return {
    providerRequestId,
    provider: args.request.providerConnection.provider,
    model,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    costUsd: calculateUsageCostUsd(pricing, usage),
    status: args.response.ok ? "success" : "error",
    metadata: buildUsageMetadata({
      request: args.request,
      response: args.response,
      payload: null,
      streamed: true,
      pricing,
      usage,
      streamParseError,
    }),
  };
}

export async function performProviderPassthrough(args: {
  request: GatewayProviderRequest;
  url: string;
  headers: Record<string, string>;
}): Promise<GatewayProviderResult> {
  let response: Response;

  try {
    response = await fetch(args.url, {
      method: args.request.method,
      headers: args.headers,
      body:
        args.request.method === "GET"
          ? undefined
          : JSON.stringify(args.request.body),
      signal: args.request.signal,
    });
  } catch (error) {
    if (
      args.request.signal.aborted &&
      isClientDisconnectAbortReason(args.request.signal.reason)
    ) {
      throw new GatewayHttpError(
        499,
        "Client disconnected during upstream request",
        {
          provider: args.request.providerConnection.provider,
          url: args.url,
          reason: "client_disconnected",
        },
      );
    }

    if (
      error instanceof Error &&
      (error.name === "AbortError" || error.name === "TimeoutError")
    ) {
      throw new GatewayHttpError(504, "Upstream request timed out", {
        provider: args.request.providerConnection.provider,
        url: args.url,
      });
    }

    throw new GatewayHttpError(502, "Failed to reach upstream provider", {
      provider: args.request.providerConnection.provider,
      url: args.url,
      error: formatErrorMessage(error),
    });
  }

  const responseHeaders = copyPassthroughResponseHeaders(response.headers);
  const contentType = response.headers.get("content-type");
  if (isEventStream(contentType) && response.body) {
    const [clientStream, inspectionStream] = response.body.tee();

    return {
      statusCode: response.status,
      responseHeaders,
      responseKind: "stream",
      responseBody: Readable.fromWeb(
        clientStream as WebReadableStream<Uint8Array>,
      ),
      upstreamDebug: {
        upstreamRequestId: getUpstreamRequestId(response.headers),
        providerRequestId: null,
        contentType,
      },
      usageEventPromise: buildUsageEventFromStream({
        request: args.request,
        response,
        stream: inspectionStream,
      }),
    };
  }

  const rawBody = await response.text();
  const payload = maybeParseJsonBody(rawBody, contentType);

  return {
    statusCode: response.status,
    responseHeaders,
    responseKind: payload ? "json" : "text",
    responseBody: payload ?? rawBody,
    upstreamDebug: {
      upstreamRequestId: getUpstreamRequestId(response.headers),
      providerRequestId: extractProviderRequestId(payload, response.headers),
      contentType,
    },
    usageEventPromise: Promise.resolve(
      buildUsageEventFromPayload({
        request: args.request,
        response,
        payload,
        rawBody,
      }),
    ),
  };
}
