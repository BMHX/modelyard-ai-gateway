import type { NextRequest } from "next/server";

function getFirstForwardedValue(value: string | null) {
  return value
    ?.split(",")[0]
    ?.trim()
    || null;
}

function normalizeProtocol(protocol: string | null | undefined) {
  const normalized = protocol?.trim().replace(/:$/u, "");
  if (normalized === "http" || normalized === "https") {
    return normalized;
  }

  return null;
}

export function normalizeOrigin(origin: string | null | undefined) {
  if (!origin) {
    return null;
  }

  try {
    return new URL(origin).origin;
  } catch {
    return null;
  }
}

export function getTrustedRequestOrigin(request: Pick<NextRequest, "headers" | "nextUrl">) {
  const host = getFirstForwardedValue(request.headers.get("x-forwarded-host")) ?? request.headers.get("host")?.trim() ?? null;
  const protocol =
    normalizeProtocol(getFirstForwardedValue(request.headers.get("x-forwarded-proto"))) ??
    normalizeProtocol(request.nextUrl.protocol) ??
    "http";

  if (host) {
    try {
      return new URL(`${protocol}://${host}`).origin;
    } catch {
      return normalizeOrigin(request.nextUrl.origin);
    }
  }

  return normalizeOrigin(request.nextUrl.origin);
}

export function getTrustedRequestHostname(request: Pick<NextRequest, "headers" | "nextUrl">) {
  const origin = getTrustedRequestOrigin(request);
  if (!origin) {
    return request.nextUrl.hostname;
  }

  try {
    return new URL(origin).hostname;
  } catch {
    return request.nextUrl.hostname;
  }
}
