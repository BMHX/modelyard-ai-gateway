import cors from "@fastify/cors";
import Fastify from "fastify";
import { ZodError } from "zod";

import { DatabaseSchemaDriftError, DatabaseValidationError } from "@teamops/database";

import { sendApiError } from "./api-error.js";
import type { ControlApiContext } from "./context.js";
import { getRequestMemberEmail, getWebAdminSessionHandle } from "./auth.js";
import { hasAdminAccess } from "./permissions.js";
import {
  applyRequestResponseWatermarkHeaders,
  ensureRequestResponseWatermarkState,
} from "./response-watermark.js";
import { registerRoutes } from "./routes/index.js";

const controlApiSecurityHeaders = {
  "content-security-policy": "base-uri 'none'; frame-ancestors 'none'; object-src 'none'",
  "cross-origin-resource-policy": "same-origin",
  "permissions-policy":
    "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "x-robots-tag": "noindex, nofollow",
} as const;

const controlApiAllowedHeaderNames = [
  "accept",
  "authorization",
  "content-type",
  "x-actor-id",
  "x-actor-type",
  "x-correlation-id",
  "x-teamops-web-admin-auth",
  "x-web-admin-auth",
  "x-member-email",
  "x-origin-service",
  "x-request-id",
  "x-source-request-id",
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
  try {
    return new URL(origin).origin;
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

function isTrustedBrowserSource(
  headers: Record<string, string | string[] | undefined>,
  allowedOrigins: ReadonlySet<string>,
) {
  const origin = getHeaderValue(headers.origin)?.trim();
  if (origin) {
    return isAllowedOrigin(origin, allowedOrigins);
  }

  const requestOrigin = getRequestHostOrigin(headers);
  const refererOrigin = normalizeOrigin(getHeaderValue(headers.referer)?.trim() || "");
  if (refererOrigin && (allowedOrigins.has(refererOrigin) || refererOrigin === requestOrigin)) {
    return true;
  }

  const secFetchSite = getHeaderValue(headers["sec-fetch-site"])?.trim().toLowerCase();
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
  }

  return allowedOrigins;
}

function getConflictMessage(constraint: string | null | undefined) {
  switch (constraint) {
    case "organizations_slug_key":
      return "Organization slug already exists";
    case "workspaces_organization_id_slug_key":
      return "Workspace slug already exists in this organization";
    case "projects_workspace_id_slug_key":
      return "Project slug already exists in this workspace";
    case "environments_project_id_slug_key":
      return "Environment slug already exists in this project";
    case "members_workspace_id_email_key":
      return "Member email already exists in this workspace";
    case "virtual_keys_key_hash_key":
      return "Virtual key already exists";
    default:
      return "A record with the same unique field already exists";
  }
}

function getFastifyRequestMessage(code: string | undefined, fallbackMessage: string | undefined) {
  switch (code) {
    case "FST_ERR_CTP_EMPTY_JSON_BODY":
      return "Request body must not be empty";
    case "FST_ERR_CTP_INVALID_JSON_BODY":
      return "Request body must be valid JSON";
    default:
      return typeof fallbackMessage === "string" ? fallbackMessage : "Invalid request";
  }
}

function isTransientSqlState(code: string | undefined) {
  if (!code || !/^[0-9A-Z]{5}$/.test(code)) {
    return false;
  }

  const sqlStateClass = code.slice(0, 2);
  return sqlStateClass === "08" || sqlStateClass === "53" || sqlStateClass === "57" || sqlStateClass === "58" || sqlStateClass === "XX";
}

function getMissingTableResource(message: string | undefined) {
  const normalizedMessage = message?.toLowerCase() ?? "";
  if (normalizedMessage.includes("saved_views")) {
    return "saved_views" as const;
  }

  if (normalizedMessage.includes("scheduled_reports")) {
    return "scheduled_reports" as const;
  }

  if (
    normalizedMessage.includes("workspace_model_assignments") ||
    normalizedMessage.includes("catalog_models") ||
    normalizedMessage.includes("provider_connection_catalog_models")
  ) {
    return "workspace_model_catalog" as const;
  }

  return null;
}

function getSchemaDriftResource(
  error: {
    code?: string;
    message?: string;
  },
) {
  if (error.code !== "42703") {
    return null;
  }

  const normalizedMessage = error.message?.toLowerCase() ?? "";
  if (
    normalizedMessage.includes("credential_key_fingerprint") &&
    normalizedMessage.includes("provider_connections")
  ) {
    return "provider_connections" as const;
  }

  if (
    normalizedMessage.includes("catalog_models") &&
    (
      normalizedMessage.includes("source_provider_connection_id") ||
      normalizedMessage.includes("source_provider_connection_label") ||
      normalizedMessage.includes("source_provider")
    )
  ) {
    return "workspace_model_catalog" as const;
  }

  return null;
}

export async function buildControlApi(context: ControlApiContext) {
  const app = Fastify({
    logger: true,
  });

  const allowedOrigins = collectAllowedOrigins("CONTROL_API");

  await app.register(cors, {
    origin(origin, callback) {
      if (!origin) {
        callback(null, false);
        return;
      }

      const normalizedOrigin = normalizeOrigin(origin);
      callback(null, Boolean(normalizedOrigin && allowedOrigins.has(normalizedOrigin)));
    },
    allowedHeaders: [...controlApiAllowedHeaderNames],
    credentials: false,
    maxAge: 600,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });

  app.addHook("onSend", async (request, reply, payload) => {
    for (const [name, value] of Object.entries(controlApiSecurityHeaders)) {
      if (!reply.hasHeader(name)) {
        reply.header(name, value);
      }
    }

    if (!reply.hasHeader("cache-control")) {
      reply.header("cache-control", "no-store");
    }

    reply.header("vary", mergeVaryHeader(reply.getHeader("vary"), ["origin"]));
    if (request.url !== "/healthz" && !request.url.startsWith("/healthz?")) {
      applyRequestResponseWatermarkHeaders(request, reply);
    }

    return payload;
  });

  app.addHook("onRequest", async (request, reply) => {
    if (
      request.url !== "/healthz" &&
      !request.url.startsWith("/healthz?") &&
      request.url.startsWith("/v1/") &&
      !isTrustedBrowserSource(request.headers, allowedOrigins)
    ) {
      return reply.send(
        sendApiError(reply, {
          statusCode: 403,
          code: "CROSS_ORIGIN_FORBIDDEN",
          message: "Cross-origin browser access is not allowed for this route",
        }),
      );
    }

    if (request.method === "OPTIONS") {
      return;
    }

    if (request.url === "/healthz" || request.url.startsWith("/healthz?")) {
      return;
    }

    if (!request.url.startsWith("/v1/")) {
      return;
    }

    if (
      request.url === "/v1/auth/login/start" ||
      request.url.startsWith("/v1/auth/login/start?") ||
      request.url === "/v1/auth/test-login" ||
      request.url.startsWith("/v1/auth/test-login?") ||
      request.url === "/v1/auth/login/callback" ||
      request.url.startsWith("/v1/auth/login/callback?")
    ) {
      return;
    }

    if (hasAdminAccess(context, request)) {
      await ensureRequestResponseWatermarkState(context, request);
      return;
    }

    if (getWebAdminSessionHandle(request.headers)) {
      await ensureRequestResponseWatermarkState(context, request);
      return;
    }

    if (getRequestMemberEmail(request.headers)) {
      await ensureRequestResponseWatermarkState(context, request);
      return;
    }

    return reply.send(
      sendApiError(reply, {
        statusCode: 401,
        code: "AUTH_REQUIRED",
        message: "Authentication is required for this route",
      }),
    );
  });

  app.setErrorHandler((error, request, reply) => {
    request.log.error(error);

    if (error instanceof DatabaseSchemaDriftError) {
      return reply.send(
        sendApiError(reply, {
          statusCode: 500,
          code: "TEAMOPS_MISSING_TABLE",
          resource: error.resource,
          message:
            error.resource === "provider_connections"
              ? "Provider connections are unavailable until database migrations are up to date"
              : "Workspace model assignments are unavailable until database migrations are up to date",
        }),
      );
    }

    if (error instanceof ZodError) {
      return reply.send(
        sendApiError(reply, {
          statusCode: 400,
          code: "INVALID_REQUEST_BODY",
          message: error.issues[0]?.message ?? "Invalid request payload",
        }),
      );
    }

    if (error instanceof DatabaseValidationError) {
      return reply.send(
        sendApiError(reply, {
          statusCode: error.statusCode,
          code: "INVALID_REQUEST",
          message: error.message,
        }),
      );
    }

    const httpError = error as { statusCode?: number; code?: string; message?: string };
    if (typeof httpError.statusCode === "number" && httpError.statusCode >= 400 && httpError.statusCode < 500) {
      return reply.send(
        sendApiError(reply, {
          statusCode: httpError.statusCode,
          code: "INVALID_REQUEST",
          message: getFastifyRequestMessage(httpError.code, httpError.message),
        }),
      );
    }

    const databaseError = error as { code?: string; constraint?: string; message?: string };
    if (databaseError.code === "22P02") {
      return reply.send(
        sendApiError(reply, {
          statusCode: 400,
          code:
            typeof databaseError.message === "string" && databaseError.message.toLowerCase().includes("uuid")
              ? "INVALID_UUID"
              : "INVALID_REQUEST_PARAMETER",
          message:
            typeof databaseError.message === "string" && databaseError.message.toLowerCase().includes("uuid")
              ? "Invalid UUID in request"
              : "Invalid request parameter",
        }),
      );
    }

    if (databaseError.code === "23505") {
      return reply.send(
        sendApiError(reply, {
          statusCode: 409,
          code: "CONFLICT",
          message: getConflictMessage(databaseError.constraint),
        }),
      );
    }

    if (databaseError.code === "23503") {
      return reply.send(
        sendApiError(reply, {
          statusCode: 400,
          code: "REFERENCED_RESOURCE_MISSING",
          message: "Referenced resource does not exist",
        }),
      );
    }

    if (databaseError.code === "42P01") {
      const missingTableResource = getMissingTableResource(databaseError.message);
      if (missingTableResource) {
        return reply.send(
          sendApiError(reply, {
            statusCode: 500,
            code: "TEAMOPS_MISSING_TABLE",
            resource: missingTableResource,
            message:
              missingTableResource === "saved_views"
                ? "Saved views are unavailable until database migrations are up to date"
                : missingTableResource === "scheduled_reports"
                  ? "Scheduled reports are unavailable until database migrations are up to date"
                  : "Workspace model assignments are unavailable until database migrations are up to date",
          }),
        );
      }
    }

    const schemaDriftResource = getSchemaDriftResource(databaseError);
    if (schemaDriftResource) {
      return reply.send(
        sendApiError(reply, {
          statusCode: 500,
          code: "TEAMOPS_MISSING_TABLE",
          resource: schemaDriftResource,
          message:
            schemaDriftResource === "provider_connections"
              ? "Provider connections are unavailable until database migrations are up to date"
              : schemaDriftResource === "workspace_model_catalog"
                ? "Workspace model assignments are unavailable until database migrations are up to date"
                : "The control plane is unavailable until database migrations are up to date",
        }),
      );
    }

    if (isTransientSqlState(databaseError.code)) {
      return reply.send(
        sendApiError(reply, {
          statusCode: 503,
          code: "SERVICE_UNAVAILABLE",
          message: "Control API is temporarily unavailable",
        }),
      );
    }

    return reply.send(
      sendApiError(reply, {
        statusCode: 500,
        code: "UNEXPECTED_ERROR",
        message: "Unexpected control API error",
      }),
    );
  });

  await registerRoutes(app, context);
  return app;
}
