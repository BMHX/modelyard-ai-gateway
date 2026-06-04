import { NextRequest, NextResponse } from "next/server";

import {
  buildGatewayProxyUpstreamUrl,
  loadConsoleRuntimeSettings,
} from "@/app/lib/console-settings";

const hopByHopHeaders = new Set([
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function buildUpstreamHeaders(request: NextRequest) {
  const headers = new Headers(request.headers);

  for (const headerName of hopByHopHeaders) {
    headers.delete(headerName);
  }

  return headers;
}

async function proxyGatewayRequest(
  request: NextRequest,
  context: {
    params: Promise<{
      path: string[];
    }>;
  },
) {
  const { path } = await context.params;
  const search = request.nextUrl.search || "";
  const { settings } = await loadConsoleRuntimeSettings();
  const upstreamUrl = buildGatewayProxyUpstreamUrl(settings, path, search);
  const method = request.method.toUpperCase();
  const shouldForwardBody = method !== "GET" && method !== "HEAD";
  const requestInit: RequestInit & {
    duplex?: "half";
  } = {
    method,
    headers: buildUpstreamHeaders(request),
    redirect: "manual",
    cache: "no-store",
    signal: AbortSignal.timeout(settings.gatewayRequestTimeoutMs),
  };

  if (shouldForwardBody) {
    requestInit.body = request.body;
    requestInit.duplex = "half";
  }

  const upstreamResponse = await fetch(upstreamUrl, requestInit);

  const responseHeaders = new Headers(upstreamResponse.headers);
  for (const headerName of hopByHopHeaders) {
    responseHeaders.delete(headerName);
  }

  return new NextResponse(method === "HEAD" ? null : upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: responseHeaders,
  });
}

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: {
    params: Promise<{
      path: string[];
    }>;
  },
) {
  return proxyGatewayRequest(request, context);
}

export async function POST(
  request: NextRequest,
  context: {
    params: Promise<{
      path: string[];
    }>;
  },
) {
  return proxyGatewayRequest(request, context);
}

export async function PUT(
  request: NextRequest,
  context: {
    params: Promise<{
      path: string[];
    }>;
  },
) {
  return proxyGatewayRequest(request, context);
}

export async function PATCH(
  request: NextRequest,
  context: {
    params: Promise<{
      path: string[];
    }>;
  },
) {
  return proxyGatewayRequest(request, context);
}

export async function DELETE(
  request: NextRequest,
  context: {
    params: Promise<{
      path: string[];
    }>;
  },
) {
  return proxyGatewayRequest(request, context);
}

export async function OPTIONS(
  request: NextRequest,
  context: {
    params: Promise<{
      path: string[];
    }>;
  },
) {
  return proxyGatewayRequest(request, context);
}

export async function HEAD(
  request: NextRequest,
  context: {
    params: Promise<{
      path: string[];
    }>;
  },
) {
  return proxyGatewayRequest(request, context);
}
