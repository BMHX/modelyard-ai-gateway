import cors from "@fastify/cors";
import Fastify from "fastify";

import type { GatewayContext } from "./context.js";
import { registerGatewayRoutes } from "./routes.js";

const gatewaySecurityHeaders = {
  "content-security-policy": "base-uri 'none'; frame-ancestors 'none'; object-src 'none'",
  "cross-origin-resource-policy": "same-origin",
  "permissions-policy":
    "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "x-robots-tag": "noindex, nofollow",
} as const;

const gatewayAllowedHeaderNames = [
  "accept",
  "authorization",
  "content-type",
  "x-provider-connection-id",
  "x-provider-kind",
  "x-teamops-provider",
] as const;

function getHeaderValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function mergeVaryHeader(currentValue: string | number | string[] | undefined, headerNames: readonly string[]) {
  const varyValues = new Set(
    (Array.isArray(currentValue) ? currentValue.join(",") : String(currentValue ?? ""))
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );

  for (const headerName of headerNames) {
    varyValues.add(headerName.toLowerCase());
  }

  return [...varyValues].join(", ");
}

function normalizeOrigin(origin: string) {
  const trimmedOrigin = origin.trim();
  if (!trimmedOrigin) {
    return null;
  }

  if (trimmedOrigin === "null") {
    return "null";
  }

  try {
    return new URL(trimmedOrigin).origin;
  } catch {
    return null;
  }
}

function isAllowedOrigin(origin: string | undefined, allowedOrigins: ReadonlySet<string>) {
  if (!origin) {
    return true;
  }

  const normalizedOrigin = normalizeOrigin(origin);
  return Boolean(normalizedOrigin && allowedOrigins.has(normalizedOrigin));
}

function getRequestHostOrigin(headers: Record<string, string | string[] | undefined>) {
  const host = getHeaderValue(headers.host)?.trim();
  if (!host) {
    return null;
  }

  const forwardedProto = getHeaderValue(headers["x-forwarded-proto"])?.split(",")[0]?.trim();
  const protocol = forwardedProto || "http";

  try {
    return new URL(`${protocol}://${host}`).origin;
  } catch {
    return null;
  }
}

function isLoopbackOrigin(origin: string | null) {
  if (!origin) {
    return false;
  }

  try {
    const { hostname } = new URL(origin);
    return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]" || hostname === "::1";
  } catch {
    return false;
  }
}

function isTrustedBrowserSource(
  headers: Record<string, string | string[] | undefined>,
  allowedOrigins: ReadonlySet<string>,
) {
  const origin = getHeaderValue(headers.origin)?.trim();
  const requestOrigin = getRequestHostOrigin(headers);
  const refererOrigin = normalizeOrigin(getHeaderValue(headers.referer)?.trim() || "");
  const normalizedOrigin = origin ? normalizeOrigin(origin) : null;
  const isLoopbackRequest = isLoopbackOrigin(requestOrigin);

  if (origin) {
    if (isAllowedOrigin(origin, allowedOrigins)) {
      return true;
    }

    if (isLoopbackRequest && normalizedOrigin === "null" && !refererOrigin) {
      return true;
    }

    return false;
  }

  if (refererOrigin && (allowedOrigins.has(refererOrigin) || refererOrigin === requestOrigin)) {
    return true;
  }

  if (isLoopbackRequest && !refererOrigin) {
    return true;
  }

  const secFetchSite = getHeaderValue(headers["sec-fetch-site"])?.trim().toLowerCase();
  if (process.env.NODE_ENV !== "production" && !origin && !refererOrigin && secFetchSite === "cross-site") {
    return true;
  }

  if (secFetchSite === "cross-site") {
    return false;
  }

  if (refererOrigin) {
    return false;
  }

  return true;
}

function collectAllowedOrigins(servicePrefix: "CONTROL_API" | "GATEWAY") {
  const allowedOrigins = new Set<string>();
  const rawOriginLists = [
    process.env[`${servicePrefix}_CORS_ALLOWED_ORIGINS`],
    process.env.CORS_ALLOWED_ORIGINS,
    process.env.WEB_ADMIN_BASE_URL,
    process.env.WEB_ADMIN_PUBLIC_BASE_URL,
    process.env.APP_BASE_URL,
    process.env.PUBLIC_APP_BASE_URL,
  ];

  for (const rawOriginList of rawOriginLists) {
    if (!rawOriginList) {
      continue;
    }

    for (const candidate of rawOriginList.split(/[,\n]/)) {
      const normalized = normalizeOrigin(candidate.trim());
      if (normalized) {
        allowedOrigins.add(normalized);
      }
    }
  }

  if (process.env.NODE_ENV !== "production") {
    allowedOrigins.add("http://127.0.0.1:3001");
    allowedOrigins.add("http://localhost:3001");
    allowedOrigins.add("http://[::1]:3001");
    allowedOrigins.add("null");
  }

  return allowedOrigins;
}

export async function buildGateway(context: GatewayContext) {
  const app = Fastify({
    logger: true,
  });

  const allowedOrigins = collectAllowedOrigins("GATEWAY");

  await app.register(cors, {
    origin(origin, callback) {
      if (!origin) {
        callback(null, false);
        return;
      }

      const normalizedOrigin = normalizeOrigin(origin);
      callback(null, Boolean(normalizedOrigin && allowedOrigins.has(normalizedOrigin)));
    },
    allowedHeaders: [...gatewayAllowedHeaderNames],
    credentials: false,
    maxAge: 600,
    methods: ["GET", "HEAD", "POST", "OPTIONS"],
  });

  app.addHook("onSend", async (_request, reply, payload) => {
    for (const [name, value] of Object.entries(gatewaySecurityHeaders)) {
      if (!reply.hasHeader(name)) {
        reply.header(name, value);
      }
    }

    if (!reply.hasHeader("cache-control")) {
      reply.header("cache-control", "no-store");
    }

    reply.header("vary", mergeVaryHeader(reply.getHeader("vary"), ["origin"]));

    return payload;
  });

  app.addHook("onRequest", async (request, reply) => {
    if (
      request.url !== "/healthz" &&
      !request.url.startsWith("/healthz?") &&
      request.url.startsWith("/v1/") &&
      !isTrustedBrowserSource(request.headers, allowedOrigins)
    ) {
      reply.code(403);
      return reply.send({
        error: {
          message: "Cross-origin browser access is not allowed for this route",
        },
      });
    }
  });

  await registerGatewayRoutes(app, context);
  return app;
}
