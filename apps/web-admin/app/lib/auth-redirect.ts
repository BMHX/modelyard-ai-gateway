import type { NextRequest } from "next/server";

import { getTrustedRequestOrigin } from "./request-origin";

export function buildRequestScopedUrl(request: NextRequest, target: string) {
  const origin = getTrustedRequestOrigin(request) ?? request.nextUrl.origin;
  return new URL(target, origin);
}

export function buildRequestScopedCurrentUrl(request: NextRequest) {
  return buildRequestScopedUrl(request, `${request.nextUrl.pathname}${request.nextUrl.search}`);
}
