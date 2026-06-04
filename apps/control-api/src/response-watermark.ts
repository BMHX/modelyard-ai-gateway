import { createHash } from "node:crypto";

import type { FastifyReply, FastifyRequest } from "fastify";

import {
  createResponseWatermarkBinding,
  digestResponseWatermarkQuery,
  issueOpaqueResponseWatermark,
} from "@teamops/contracts/response-watermark";

import {
  getBearerToken,
  getHeaderValue,
  getRequestCorrelationId,
  getRequestSourceRequestId,
} from "./auth.js";
import type { ControlApiContext } from "./context.js";
import { resolveRequestAuth } from "./request-auth.js";

type RequestResponseWatermarkState = {
  correlationId: string;
  fingerprint: string | null;
  requestId: string;
  sourceRequestId: string | null;
  token: string | null;
  workspaceId: string | null;
};

const requestWatermarkStateCache = new WeakMap<
  FastifyRequest,
  Promise<RequestResponseWatermarkState | null>
>();

const requestWatermarkStateSymbol = Symbol("teamops.requestResponseWatermarkState");
const requestWatermarkWorkspaceIdSymbol = Symbol("teamops.requestResponseWatermarkWorkspaceId");

type RequestWithWatermarkState = FastifyRequest & {
  [requestWatermarkStateSymbol]?: RequestResponseWatermarkState | null;
  [requestWatermarkWorkspaceIdSymbol]?: string | null;
};

const uuidPattern =
  /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;

function getTrimmedValue(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized || null;
}

function getWatermarkSecret() {
  const configured =
    getTrimmedValue(process.env.PRIVATE_RESPONSE_ATTESTATION_SECRET) ??
    getTrimmedValue(process.env.RESPONSE_WATERMARK_SECRET);
  if (configured) {
    return configured;
  }

  if (process.env.NODE_ENV !== "production") {
    return "teamops-dev-response-watermark-secret";
  }

  return null;
}

function getWatermarkKeyId() {
  return (
    getTrimmedValue(process.env.PRIVATE_RESPONSE_ATTESTATION_KEY_ID) ??
    getTrimmedValue(process.env.RESPONSE_WATERMARK_KEY_ID) ??
    "k1"
  );
}

function getWatermarkInstanceId() {
  return (
    getTrimmedValue(process.env.PRIVATE_RESPONSE_ATTESTATION_INSTANCE_ID) ??
    getTrimmedValue(process.env.RESPONSE_WATERMARK_INSTANCE_ID) ??
    getTrimmedValue(process.env.HOSTNAME) ??
    null
  );
}

function mergeHeaderValues(currentValue: string | number | string[] | undefined, value: string) {
  const existingValues = new Set(
    (Array.isArray(currentValue) ? currentValue.join(",") : String(currentValue ?? ""))
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  );

  existingValues.add(value);
  return [...existingValues].join(", ");
}

function mergeServerTiming(currentValue: string | number | string[] | undefined, token: string) {
  const metric = `rctx;desc="${token}"`;
  const existing = Array.isArray(currentValue) ? currentValue.join(", ") : String(currentValue ?? "").trim();

  return existing ? `${existing}, ${metric}` : metric;
}

function getNormalizedUrl(request: FastifyRequest) {
  return new URL(request.url, "http://control-api.local");
}

function inferWorkspaceIdFromRequest(request: FastifyRequest) {
  const explicitWorkspaceId = (request as RequestWithWatermarkState)[requestWatermarkWorkspaceIdSymbol];
  if (explicitWorkspaceId !== undefined) {
    return explicitWorkspaceId;
  }

  const url = getNormalizedUrl(request);
  const searchWorkspaceId = getTrimmedValue(url.searchParams.get("workspaceId"));
  if (searchWorkspaceId && uuidPattern.test(searchWorkspaceId)) {
    return searchWorkspaceId;
  }

  const pathMatch = url.pathname.match(new RegExp(`/workspaces/(${uuidPattern.source})(?:/|$)`, "i"));
  if (pathMatch?.[1]) {
    return pathMatch[1];
  }

  return null;
}

function buildSurfaceLabel(request: FastifyRequest) {
  const url = getNormalizedUrl(request);
  return `control-api:${request.method.toUpperCase()}:${url.pathname}`;
}

async function buildRequestResponseWatermarkState(
  context: ControlApiContext,
  request: FastifyRequest,
) {
  const auth = await resolveRequestAuth(context, request);
  if (auth.kind === "none") {
    return null;
  }

  const url = getNormalizedUrl(request);
  const secret = getWatermarkSecret();
  const correlationId = getRequestCorrelationId(request.headers, request.id) ?? request.id;
  const sourceRequestId = getRequestSourceRequestId(request.headers);
  const workspaceId = inferWorkspaceIdFromRequest(request);
  let token: string | null = null;
  let fingerprint: string | null = null;

  if (secret) {
    const claims = {
      v: 1 as const,
      l: "control-api",
      s: buildSurfaceLabel(request),
      i: new Date().toISOString().slice(0, 16),
      m: request.method.toUpperCase(),
      p: url.pathname,
      q: digestResponseWatermarkQuery(url.search),
      rid: request.id,
      cid: correlationId,
      sid: sourceRequestId,
      wid: workspaceId,
      inst: getWatermarkInstanceId(),
      ctx: {
        auth: auth.kind,
        ...(auth.kind === "session"
          ? {
              operatorId: auth.operatorId,
              organizationSlug: auth.organizationSlug,
            }
          : {}),
      },
      oid: auth.kind === "session" ? auth.organizationId : null,
      bid:
        auth.kind === "session"
          ? `${auth.sessionId}:${auth.operatorId}`
          : auth.kind === "member-header"
            ? createResponseWatermarkBinding(secret, "member-email", auth.email.toLowerCase())
            : (() => {
                const adminToken = getBearerToken(request.headers.authorization);
                return adminToken
                  ? createHash("sha256").update(adminToken).digest("hex")
                  : "admin";
              })(),
    };

    const watermark = issueOpaqueResponseWatermark({
      secret,
      keyId: getWatermarkKeyId(),
      claims,
    });

    token = watermark.token;
    fingerprint = watermark.fingerprint;
  }

  return {
    token,
    fingerprint,
    requestId: request.id,
    correlationId,
    sourceRequestId,
    workspaceId,
  } satisfies RequestResponseWatermarkState;
}

export async function ensureRequestResponseWatermarkState(
  context: ControlApiContext,
  request: FastifyRequest,
) {
  const cached = requestWatermarkStateCache.get(request);
  if (cached) {
    return cached;
  }

  const promise = buildRequestResponseWatermarkState(context, request).then((state) => {
    (request as RequestWithWatermarkState)[requestWatermarkStateSymbol] = state;
    return state;
  });

  requestWatermarkStateCache.set(request, promise);
  return promise;
}

export function getRequestResponseWatermarkState(request: FastifyRequest) {
  return (request as RequestWithWatermarkState)[requestWatermarkStateSymbol] ?? null;
}

export function getRequestResponseWatermarkFingerprint(request: FastifyRequest) {
  return getRequestResponseWatermarkState(request)?.fingerprint ?? null;
}

export function setRequestResponseWatermarkWorkspaceId(
  request: FastifyRequest,
  workspaceId: string | null,
) {
  (request as RequestWithWatermarkState)[requestWatermarkWorkspaceIdSymbol] = workspaceId;
}

export function applyRequestResponseWatermarkHeaders(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const state = getRequestResponseWatermarkState(request);
  if (!state) {
    return;
  }

  reply.header("x-request-id", state.requestId);
  reply.header("x-correlation-id", state.correlationId);

  if (state.sourceRequestId) {
    reply.header("x-source-request-id", state.sourceRequestId);
  }

  reply.header(
    "access-control-expose-headers",
    mergeHeaderValues(reply.getHeader("access-control-expose-headers"), "x-request-id"),
  );
  reply.header(
    "access-control-expose-headers",
    mergeHeaderValues(reply.getHeader("access-control-expose-headers"), "x-correlation-id"),
  );

  if (state.sourceRequestId) {
    reply.header(
      "access-control-expose-headers",
      mergeHeaderValues(reply.getHeader("access-control-expose-headers"), "x-source-request-id"),
    );
  }

  if (state.token) {
    reply.header("x-teamops-private-attestation", state.token);
    reply.header(
      "access-control-expose-headers",
      mergeHeaderValues(reply.getHeader("access-control-expose-headers"), "x-teamops-private-attestation"),
    );
    reply.header("server-timing", mergeServerTiming(reply.getHeader("server-timing"), state.token));
  }
}
