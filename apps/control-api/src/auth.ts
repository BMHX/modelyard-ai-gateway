import { createHash, randomBytes } from "node:crypto";

export function getBearerToken(authorization?: string) {
  if (!authorization) {
    return null;
  }

  const [scheme, token] = authorization.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return null;
  }

  return token.trim();
}

export type RequestHeaders = Record<string, string | string[] | undefined>;

export function getHeaderValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

function getTrimmedHeaderValue(value: string | string[] | undefined) {
  const normalized = getHeaderValue(value)?.trim();
  return normalized || null;
}

export function getRequestExplicitActor(headers: RequestHeaders) {
  const actorType = getTrimmedHeaderValue(headers["x-actor-type"]);
  const actorId = getTrimmedHeaderValue(headers["x-actor-id"]);

  if (!actorType || !actorId) {
    return null;
  }

  return {
    actorType,
    actorId,
  };
}

export function getRequestMemberEmail(headers: RequestHeaders) {
  const email = getTrimmedHeaderValue(headers["x-member-email"])?.toLowerCase();
  return email || null;
}

export function getRequestCorrelationId(headers: RequestHeaders, fallback?: string | null) {
  return (
    getTrimmedHeaderValue(headers["x-correlation-id"]) ??
    getTrimmedHeaderValue(headers["x-request-id"]) ??
    fallback ??
    null
  );
}

export function getRequestSourceRequestId(headers: RequestHeaders) {
  return getTrimmedHeaderValue(headers["x-source-request-id"]);
}

export function getRequestOriginService(headers: RequestHeaders) {
  return getTrimmedHeaderValue(headers["x-origin-service"]);
}

export function getWebAdminSessionHandle(headers: RequestHeaders) {
  const rawValue =
    getTrimmedHeaderValue(headers["x-teamops-web-admin-auth"]) ??
    getTrimmedHeaderValue(headers["x-web-admin-auth"]);

  if (!rawValue) {
    return null;
  }

  const [scheme, handle] = rawValue.split(/\s+/, 2);
  if (scheme?.toLowerCase() !== "session" || !handle) {
    return null;
  }

  return handle.trim() || null;
}

export function hashControlPlaneSessionHandle(handle: string) {
  return createHash("sha256").update(handle).digest("hex");
}

export function createOpaqueSessionHandle() {
  return randomBytes(32).toString("base64url");
}

export function createOpaqueState() {
  return randomBytes(24).toString("base64url");
}
