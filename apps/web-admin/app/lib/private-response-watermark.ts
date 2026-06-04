import { createHash } from "node:crypto";

import { type NextRequest, NextResponse } from "next/server";

import {
  digestResponseWatermarkQuery,
  issueOpaqueResponseWatermark,
  type ResponseWatermarkClaims,
} from "@teamops/contracts/response-watermark";

import {
  controlPlaneSessionCookieName,
  getWebAdminAuthMode,
} from "./control-plane-auth";
import { getCurrentRequestTrace, createRequestTrace } from "./request-trace";

const privateCacheControl = "private, no-store, max-age=0";

type PrivateResponseWatermarkArgs = {
  extraContext?: Record<string, string | null | undefined>;
  headers?: ConstructorParameters<typeof Headers>[0];
  status?: number;
  surface: string;
  workspaceId?: string | null;
};

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

function getSessionHandleFromCookieHeader(cookieHeader: string | null | undefined) {
  if (!cookieHeader) {
    return null;
  }

  const match = cookieHeader.match(
    new RegExp(`(?:^|;\\s*)${controlPlaneSessionCookieName}=([^;]+)`),
  );
  if (!match?.[1]) {
    return null;
  }

  try {
    return decodeURIComponent(match[1]).trim() || null;
  } catch {
    return match[1].trim() || null;
  }
}

function mergeServerTiming(headers: Headers, token: string) {
  const metric = `rctx;desc="${token}"`;
  const existing = headers.get("server-timing");
  headers.set("server-timing", existing ? `${existing}, ${metric}` : metric);
}

function buildClaims(
  request: NextRequest,
  args: Omit<PrivateResponseWatermarkArgs, "headers" | "status">,
) {
  const trace = getCurrentRequestTrace() ?? createRequestTrace(request.headers);
  const sessionHandle = getSessionHandleFromCookieHeader(request.headers.get("cookie"));
  const authMode = getWebAdminAuthMode();
  const secret = getWatermarkSecret();
  const extraContext = Object.fromEntries(
    Object.entries(args.extraContext ?? {}).filter(([, value]) => value !== undefined),
  );
  const claims: ResponseWatermarkClaims = {
    v: 1,
    l: "web-admin",
    s: args.surface,
    i: new Date().toISOString().slice(0, 16),
    m: request.method,
    p: request.nextUrl.pathname,
    q: digestResponseWatermarkQuery(request.nextUrl.search),
    rid: trace.requestId,
    cid: trace.correlationId,
    sid: trace.sourceRequestId,
    wid: args.workspaceId ?? null,
    inst: getWatermarkInstanceId(),
    ctx: {
      authMode,
      ...extraContext,
    },
  };

  if (sessionHandle) {
    claims.bid = createHash("sha256").update(sessionHandle).digest("hex");
  } else if (authMode === "bootstrap_member_email") {
    const memberEmail = getTrimmedValue(process.env.CONTROL_API_MEMBER_EMAIL)?.toLowerCase();
    if (memberEmail && secret) {
      claims.bid = createHash("sha256").update(memberEmail).digest("hex");
    }
  }

  return {
    claims,
    trace,
    secret,
  };
}

export function buildPrivateResponseHeaders(
  request: NextRequest,
  args: Omit<PrivateResponseWatermarkArgs, "status">,
) {
  const headers = new Headers(args.headers);
  const { claims, trace, secret } = buildClaims(request, args);

  headers.set("cache-control", privateCacheControl);
  headers.set("x-request-id", trace.requestId);
  headers.set("x-correlation-id", trace.correlationId);
  headers.set("x-source-request-id", trace.sourceRequestId);

  if (secret) {
    const watermark = issueOpaqueResponseWatermark({
      secret,
      keyId: getWatermarkKeyId(),
      claims,
    });
    headers.set("x-teamops-private-attestation", watermark.token);
    mergeServerTiming(headers, watermark.token);
  }

  return headers;
}

export function jsonWithPrivateWatermark(
  request: NextRequest,
  body: unknown,
  args: PrivateResponseWatermarkArgs,
) {
  return NextResponse.json(body, {
    status: args.status,
    headers: buildPrivateResponseHeaders(request, args),
  });
}

export function responseWithPrivateWatermark(
  request: NextRequest,
  body: BodyInit | null,
  args: PrivateResponseWatermarkArgs,
) {
  return new NextResponse(body, {
    status: args.status,
    headers: buildPrivateResponseHeaders(request, args),
  });
}
