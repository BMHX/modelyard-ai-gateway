import { createHash } from "node:crypto";

import type { FastifyInstance, FastifyRequest } from "fastify";
import { createRemoteJWKSet, jwtVerify } from "jose";

import {
  AuthLoginCallbackInputSchema,
  AuthLoginCallbackResponseSchema,
  AuthLoginStartInputSchema,
  AuthLoginStartResponseSchema,
  AuthSessionSchema,
  AuthTestLoginInputSchema,
  normalizeMemberRole,
  UpdateWorkspaceGuidePreferenceInputSchema,
} from "@teamops/contracts";
import {
  appendAuditLog,
  createControlPlaneSession,
  decryptSecret,
  findControlPlaneOperatorById,
  findExternalIdentityByProviderAndSubject,
  findOrganizationBySlug,
  getStoredIdentityProviderByOrganizationId,
  listActiveMemberIdentitiesByEmail,
  listActiveMembersByOrganizationAndEmail,
  listOrganizationsByMemberEmail,
  recordControlPlaneOperatorActivity,
  revokeControlPlaneSessionsForOperator,
  updateControlPlaneOperatorGuidePreference,
  updateControlPlaneSessionActiveIdentity,
  upsertIdentityProvider,
  upsertControlPlaneOperator,
  upsertExternalIdentity,
} from "@teamops/database";

import {
  createOpaqueState,
  createOpaqueSessionHandle,
  getHeaderValue,
  getRequestCorrelationId,
  getRequestSourceRequestId,
  hashControlPlaneSessionHandle,
} from "../auth.js";
import { buildApiError } from "../api-error.js";
import type { ControlApiContext } from "../context.js";
import { requireSessionPrincipal, resolveRequestAuth } from "../request-auth.js";

type AuthTransaction = {
  organizationId: string;
  organizationSlug: string;
  identityProviderId: string;
  returnTo: string;
  nonce: string;
  codeVerifier: string;
  createdAt: string;
};

const authTransactionTtlSeconds = 10 * 60;
const sessionAbsoluteLifetimeMs = 12 * 60 * 60 * 1000;
const sessionIdleLifetimeMs = 60 * 60 * 1000;
const authTransactionPrefix = "teamops:oidc-auth:";
const syntheticTestIdentityProviderIssuer = "https://teamops.test.local/oidc";
const syntheticTestIdentityProviderClientId = "teamops-test-login";

function getWebAdminBaseUrl(env: ControlApiContext["env"]) {
  const baseUrl =
    env.WEB_ADMIN_BASE_URL ??
    env.WEB_ADMIN_PUBLIC_BASE_URL ??
    env.APP_BASE_URL ??
    env.PUBLIC_APP_BASE_URL ??
    "http://127.0.0.1:3001";

  return baseUrl.replace(/\/$/, "");
}

function buildWebAdminCallbackUrl(env: ControlApiContext["env"]) {
  return `${getWebAdminBaseUrl(env)}/auth/callback`;
}

function buildAuthTransactionKey(state: string) {
  return `${authTransactionPrefix}${state}`;
}

function encodeBase64Url(buffer: Buffer) {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function createPkceVerifier() {
  return createOpaqueSessionHandle();
}

function createPkceChallenge(verifier: string) {
  return encodeBase64Url(createHash("sha256").update(verifier).digest());
}

function coerceString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function coerceBoolean(value: unknown) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return value.toLowerCase() === "true";
  }

  return false;
}

function inferOperatorName(email: string, rawName?: string | null) {
  if (rawName?.trim()) {
    return rawName.trim();
  }

  const localPart = email.split("@")[0] ?? email;
  return localPart.replace(/[._-]+/g, " ").trim() || email;
}

function buildAuthErrorPayload(
  code: string,
  message: string,
  details?: Record<string, unknown>,
) {
  return buildApiError({
    code,
    message,
    details,
  });
}

function getAuthTrace(request: FastifyRequest) {
  return {
    requestId: request.id,
    correlationId: getRequestCorrelationId(request.headers, request.id),
    sourceRequestId: getRequestSourceRequestId(request.headers),
  };
}

function logAuthEvent(
  request: FastifyRequest,
  level: "info" | "warn",
  message: string,
  details: Record<string, unknown>,
) {
  request.log[level]({
    ...details,
    ...getAuthTrace(request),
  }, message);
}

function resolveDefaultActiveIdentity(
  memberships: Awaited<ReturnType<typeof listActiveMembersByOrganizationAndEmail>>,
) {
  const membership = memberships[0] ?? null;
  return {
    activeMembershipId: membership?.id ?? null,
    activeRole: membership?.roles[0] ?? null,
  };
}

async function requireSessionOrReply(
  context: ControlApiContext,
  request: FastifyRequest,
  reply: { code: (statusCode: number) => unknown },
) {
  const sessionPrincipal = await requireSessionPrincipal(context, request);
  if (sessionPrincipal) {
    return sessionPrincipal;
  }

  const auth = await resolveRequestAuth(context, request);
  reply.code(401);
  return buildAuthErrorPayload(
    auth.kind === "none" ? auth.errorCode : "AUTH_REQUIRED",
    auth.kind === "none" && auth.errorCode === "SESSION_EXPIRED"
      ? "The current control-plane session has expired"
      : auth.kind === "none" && auth.errorCode === "SESSION_REVOKED"
        ? "The current control-plane session has been revoked"
        : "Authentication is required for this route",
    {
      authStage: "session",
    },
  );
}

async function appendAuthAuditEvent(
  db: ControlApiContext["db"],
  request: FastifyRequest,
  input: {
    organizationId: string;
    actorType: string;
    actorId: string;
    action: string;
    payload: Record<string, unknown>;
  },
) {
  return appendAuditLog(db, {
    workspaceId: null,
    actorType: input.actorType,
    actorId: input.actorId,
    action: input.action,
    subjectType: "organization",
    subjectId: input.organizationId,
    payload: {
      ...input.payload,
      requestContext: {
        requestId: request.id,
        correlationId: getRequestCorrelationId(request.headers, request.id),
        sourceRequestId: getRequestSourceRequestId(request.headers),
        ip: request.ip,
        userAgent: getHeaderValue(request.headers["user-agent"]),
      },
    },
  });
}

async function requireStoredIdentityProvider(
  context: ControlApiContext,
  organizationId: string,
) {
  const identityProvider = await getStoredIdentityProviderByOrganizationId(context.db, organizationId);
  if (!identityProvider || identityProvider.status !== "active") {
    return null;
  }

  return identityProvider;
}

function isSyntheticTestIdentityProvider(identityProvider: {
  issuer: string;
  clientId: string;
}) {
  return (
    identityProvider.issuer === syntheticTestIdentityProviderIssuer ||
    identityProvider.clientId === syntheticTestIdentityProviderClientId
  );
}

async function ensureTestIdentityProvider(
  context: ControlApiContext,
  args: {
    organizationId: string;
  },
) {
  const existingProvider = await getStoredIdentityProviderByOrganizationId(
    context.db,
    args.organizationId,
  );
  if (existingProvider) {
    return existingProvider;
  }

  await upsertIdentityProvider(
    context.db,
    args.organizationId,
    {
      providerType: "generic-oidc",
      issuer: "https://teamops.test.local/oidc",
      authorizationEndpoint: "https://teamops.test.local/oidc/authorize",
      tokenEndpoint: "https://teamops.test.local/oidc/token",
      userinfoEndpoint: null,
      jwksUri: "https://teamops.test.local/oidc/keys",
      clientId: "teamops-test-login",
      clientSecret: null,
      scopes: ["openid", "email", "profile"],
      domainHint: null,
      status: "active",
    },
    context.env.ENCRYPTION_KEY_BASE64,
  );

  const identityProvider = await getStoredIdentityProviderByOrganizationId(
    context.db,
    args.organizationId,
  );
  if (!identityProvider) {
    throw new Error("Test identity provider could not be created");
  }

  return identityProvider;
}

async function fetchUserInfo(args: {
  accessToken: string | null;
  userinfoEndpoint: string | null;
}) {
  if (!args.accessToken || !args.userinfoEndpoint) {
    return null;
  }

  const response = await fetch(args.userinfoEndpoint, {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${args.accessToken}`,
    },
  });

  if (!response.ok) {
    return null;
  }

  return (await response.json()) as Record<string, unknown>;
}

function getIdTokenClaimSet(record: Record<string, unknown>, userinfo: Record<string, unknown> | null) {
  const email = coerceString(record.email) ?? coerceString(userinfo?.email);
  const emailVerified =
    coerceBoolean(record.email_verified) || (!record.email && coerceBoolean(userinfo?.email_verified));
  const name = coerceString(record.name) ?? coerceString(userinfo?.name);
  const amr = Array.isArray(record.amr)
    ? record.amr.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : [];

  return {
    email,
    emailVerified,
    name,
    amr,
  };
}

async function createOperatorSession(
  context: ControlApiContext,
  request: FastifyRequest,
  args: {
    organizationId: string;
    organizationSlug: string;
    identityProvider: Awaited<ReturnType<typeof getStoredIdentityProviderByOrganizationId>>;
    subject: string;
    email: string;
    name: string | null;
    emailVerified: boolean;
    amr: string[];
    externalIssuer: string;
    auditMode: "oidc" | "test-login";
  },
) {
  if (!args.identityProvider) {
    return {
      ok: false as const,
      statusCode: 403,
      code: "OIDC_PROVIDER_NOT_CONFIGURED",
      message: "OIDC login is not configured for this organization",
    };
  }

  const existingExternalIdentity = await findExternalIdentityByProviderAndSubject(
    context.db,
    args.identityProvider.id,
    args.subject,
  );

  let operator = existingExternalIdentity
    ? await findControlPlaneOperatorById(context.db, existingExternalIdentity.operatorId)
    : null;
  if (existingExternalIdentity && !operator) {
    return {
      ok: false as const,
      statusCode: 403,
      code: "OIDC_OPERATOR_MAPPING_UNAVAILABLE",
      message: "The mapped operator account is unavailable",
    };
  }

  const resolvedEmail = operator?.email ?? args.email;
  if (!resolvedEmail) {
    return {
      ok: false as const,
      statusCode: 403,
      code: "OIDC_EMAIL_UNRESOLVED",
      message: "No member email could be resolved for this login",
    };
  }

  if (!operator && !args.emailVerified) {
    return {
      ok: false as const,
      statusCode: 403,
      code: "OIDC_EMAIL_UNVERIFIED",
      message: "A verified member email is required to sign in",
    };
  }

  const activeMemberships = await listActiveMembersByOrganizationAndEmail(
    context.db,
    args.organizationId,
    resolvedEmail,
  );
  if (!activeMemberships.length) {
    return {
      ok: false as const,
      statusCode: 403,
      code: "OIDC_NO_ACTIVE_MEMBERSHIP",
      message: "No active workspace membership was found for this login",
    };
  }

  const assignableMemberships = activeMemberships.filter(
    (membership) => membership.roles.length > 0,
  );
  if (!assignableMemberships.length) {
    return {
      ok: false as const,
      statusCode: 403,
      code: "OIDC_MEMBERSHIP_NO_ROLES",
      message: "No permission is assigned to this account",
    };
  }

  if (!operator) {
    operator = await upsertControlPlaneOperator(context.db, {
      organizationId: args.organizationId,
      email: resolvedEmail,
      name: inferOperatorName(resolvedEmail, args.name),
      provisioningSource: args.auditMode === "test-login" ? "test-login" : "oidc",
    });
  }

  const externalIdentity = await upsertExternalIdentity(context.db, {
    organizationId: args.organizationId,
    identityProviderId: args.identityProvider.id,
    operatorId: operator.id,
    issuer: args.externalIssuer,
    subject: args.subject,
    email: resolvedEmail,
    emailVerified: args.emailVerified || Boolean(existingExternalIdentity?.emailVerified),
    lastLoginAt: new Date().toISOString(),
  });

  const now = Date.now();
  const sessionHandle = createOpaqueSessionHandle();
  const defaultActiveIdentity = resolveDefaultActiveIdentity(assignableMemberships);
  await createControlPlaneSession(context.db, {
    sessionHandleHash: hashControlPlaneSessionHandle(sessionHandle),
    organizationId: args.organizationId,
    operatorId: operator.id,
    identityProviderId: args.identityProvider.id,
    externalIdentityId: externalIdentity.id,
    email: operator.email,
    amr: args.amr,
    issuedAt: new Date(now).toISOString(),
    lastSeenAt: new Date(now).toISOString(),
    expiresAt: new Date(now + sessionAbsoluteLifetimeMs).toISOString(),
    idleExpiresAt: new Date(now + sessionIdleLifetimeMs).toISOString(),
    activeMembershipId: defaultActiveIdentity.activeMembershipId,
    activeRole: defaultActiveIdentity.activeRole,
    ipAddress: request.ip,
    userAgent: getHeaderValue(request.headers["user-agent"]),
    impersonatedByOperatorId: null,
  });
  await recordControlPlaneOperatorActivity(context.db, operator.id, {
    recordedAt: new Date(now).toISOString(),
    markLogin: true,
  });

  return {
    ok: true as const,
    operator,
    sessionHandle,
  };
}

export async function registerAuthRoutes(app: FastifyInstance, context: ControlApiContext) {
  app.post("/v1/auth/login/start", async (request, reply) => {
    if (!context.valkey) {
      reply.code(503);
      return buildAuthErrorPayload("AUTH_STORAGE_UNAVAILABLE", "Authentication storage is unavailable", {
        authStage: "oidc_start",
      });
    }

    const input = AuthLoginStartInputSchema.parse(request.body);
    const organization = await findOrganizationBySlug(context.db, input.organizationSlug);
    if (!organization) {
      reply.code(404);
      return buildAuthErrorPayload("ORGANIZATION_NOT_FOUND", "Organization not found", {
        authStage: "oidc_start",
        organizationSlug: input.organizationSlug,
        returnTo: input.returnTo,
      });
    }

    const identityProvider = await requireStoredIdentityProvider(context, organization.id);
    if (!identityProvider) {
      reply.code(403);
      return buildAuthErrorPayload("OIDC_PROVIDER_NOT_CONFIGURED", "OIDC login is not configured for this organization", {
        authStage: "oidc_start",
        organizationSlug: organization.slug,
        returnTo: input.returnTo,
      });
    }

    if (isSyntheticTestIdentityProvider(identityProvider)) {
      reply.code(403);
      return buildAuthErrorPayload(
        "OIDC_TEST_LOGIN_ONLY",
        "This organization only has development test sign-in. Use a test login preset instead of OIDC.",
        {
          authStage: "oidc_start",
          organizationSlug: organization.slug,
          returnTo: input.returnTo,
        },
      );
    }

    const state = createOpaqueState();
    const nonce = createOpaqueState();
    const codeVerifier = createPkceVerifier();
    const codeChallenge = createPkceChallenge(codeVerifier);
    const authorizationUrl = new URL(identityProvider.authorizationEndpoint);

    authorizationUrl.searchParams.set("response_type", "code");
    authorizationUrl.searchParams.set("client_id", identityProvider.clientId);
    authorizationUrl.searchParams.set("redirect_uri", buildWebAdminCallbackUrl(context.env));
    authorizationUrl.searchParams.set("scope", identityProvider.scopes.join(" "));
    authorizationUrl.searchParams.set("state", state);
    authorizationUrl.searchParams.set("nonce", nonce);
    authorizationUrl.searchParams.set("code_challenge", codeChallenge);
    authorizationUrl.searchParams.set("code_challenge_method", "S256");
    if (identityProvider.domainHint) {
      authorizationUrl.searchParams.set("domain_hint", identityProvider.domainHint);
    }

    const transaction: AuthTransaction = {
      organizationId: organization.id,
      organizationSlug: organization.slug,
      identityProviderId: identityProvider.id,
      returnTo: input.returnTo,
      nonce,
      codeVerifier,
      createdAt: new Date().toISOString(),
    };

    await context.valkey.setEx(
      buildAuthTransactionKey(state),
      authTransactionTtlSeconds,
      JSON.stringify(transaction),
    );

    await appendAuthAuditEvent(context.db, request, {
      organizationId: organization.id,
      actorType: "anonymous",
      actorId: request.ip,
      action: "auth.login.started",
      payload: {
        organizationSlug: organization.slug,
        providerType: identityProvider.providerType,
      },
    });
    logAuthEvent(request, "info", "OIDC login started", {
      action: "auth.login.started",
      authStage: "oidc_start",
      organizationSlug: organization.slug,
      providerType: identityProvider.providerType,
    });

    return AuthLoginStartResponseSchema.parse({
      authorizationUrl: authorizationUrl.toString(),
    });
  });

  app.post("/v1/auth/login/callback", async (request, reply) => {
    if (!context.valkey) {
      reply.code(503);
      return buildAuthErrorPayload("AUTH_STORAGE_UNAVAILABLE", "Authentication storage is unavailable", {
        authStage: "oidc_callback",
      });
    }

    const input = AuthLoginCallbackInputSchema.parse(request.body);
    const transactionValue = await context.valkey.get(buildAuthTransactionKey(input.state));
    await context.valkey.del(buildAuthTransactionKey(input.state));

    if (!transactionValue) {
      reply.code(401);
      logAuthEvent(request, "warn", "OIDC callback rejected: login transaction missing or expired", {
        action: "auth.login.failed",
        authStage: "oidc_callback",
        authReason: "login-transaction-missing",
      });
      return buildAuthErrorPayload("LOGIN_TRANSACTION_EXPIRED", "The login transaction is missing or has expired", {
        authStage: "oidc_callback",
      });
    }

    const transaction = JSON.parse(transactionValue) as AuthTransaction;
    const identityProvider = await requireStoredIdentityProvider(context, transaction.organizationId);
    if (!identityProvider || identityProvider.id !== transaction.identityProviderId) {
      reply.code(403);
      await appendAuthAuditEvent(context.db, request, {
        organizationId: transaction.organizationId,
        actorType: "anonymous",
        actorId: request.ip,
        action: "auth.login.failed",
        payload: {
          reason: "provider-not-configured",
          organizationSlug: transaction.organizationSlug,
        },
      });
      logAuthEvent(request, "warn", "OIDC callback rejected: provider no longer configured", {
        action: "auth.login.failed",
        authStage: "oidc_callback",
        authReason: "provider-not-configured",
        organizationSlug: transaction.organizationSlug,
      });
      return buildAuthErrorPayload("OIDC_PROVIDER_NOT_CONFIGURED", "OIDC login is not configured for this organization", {
        authStage: "oidc_callback",
        organizationSlug: transaction.organizationSlug,
        returnTo: transaction.returnTo,
      });
    }

    const tokenBody = new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      client_id: identityProvider.clientId,
      redirect_uri: buildWebAdminCallbackUrl(context.env),
      code_verifier: transaction.codeVerifier,
    });

    let decryptedClientSecret: string | null = null;
    if (identityProvider.encryptedClientSecret) {
      try {
        decryptedClientSecret = decryptSecret(
          identityProvider.encryptedClientSecret,
          context.env.ENCRYPTION_KEY_BASE64,
        );
      } catch (error) {
        reply.code(500);
        await appendAuthAuditEvent(context.db, request, {
          organizationId: transaction.organizationId,
          actorType: "anonymous",
          actorId: request.ip,
          action: "auth.login.failed",
          payload: {
            reason: "client-secret-decrypt-failed",
            organizationSlug: transaction.organizationSlug,
            error: error instanceof Error ? error.message : "unknown",
          },
        });
        logAuthEvent(request, "warn", "OIDC callback rejected: client secret decrypt failed", {
          action: "auth.login.failed",
          authStage: "oidc_callback",
          authReason: "client-secret-decrypt-failed",
          organizationSlug: transaction.organizationSlug,
        });
        return buildAuthErrorPayload(
          "OIDC_PROVIDER_SECRET_INVALID",
          "The OIDC provider client secret is invalid or no longer decryptable. Re-save the provider credentials and try again.",
          {
            authStage: "oidc_callback",
            organizationSlug: transaction.organizationSlug,
            returnTo: transaction.returnTo,
          },
        );
      }
    }
    if (decryptedClientSecret) {
      tokenBody.set("client_secret", decryptedClientSecret);
    }

    const tokenResponse = await fetch(identityProvider.tokenEndpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: tokenBody,
    });

    if (!tokenResponse.ok) {
      reply.code(401);
      await appendAuthAuditEvent(context.db, request, {
        organizationId: transaction.organizationId,
        actorType: "anonymous",
        actorId: request.ip,
        action: "auth.login.failed",
        payload: {
          reason: "token-exchange-failed",
          status: tokenResponse.status,
        },
      });
      logAuthEvent(request, "warn", "OIDC callback rejected: token exchange failed", {
        action: "auth.login.failed",
        authStage: "oidc_callback",
        authReason: "token-exchange-failed",
        organizationSlug: transaction.organizationSlug,
        status: tokenResponse.status,
      });
      return buildAuthErrorPayload("OIDC_TOKEN_EXCHANGE_FAILED", "OIDC token exchange failed", {
        authStage: "oidc_callback",
        organizationSlug: transaction.organizationSlug,
        returnTo: transaction.returnTo,
        upstreamStatus: tokenResponse.status,
      });
    }

    const tokenPayload = (await tokenResponse.json()) as Record<string, unknown>;
    const idToken = coerceString(tokenPayload.id_token);
    const accessToken = coerceString(tokenPayload.access_token);
    if (!idToken) {
      reply.code(401);
      logAuthEvent(request, "warn", "OIDC callback rejected: missing ID token", {
        action: "auth.login.failed",
        authStage: "oidc_callback",
        authReason: "id-token-missing",
        organizationSlug: transaction.organizationSlug,
      });
      return buildAuthErrorPayload("OIDC_ID_TOKEN_MISSING", "The OIDC provider did not return an ID token", {
        authStage: "oidc_callback",
        organizationSlug: transaction.organizationSlug,
        returnTo: transaction.returnTo,
      });
    }

    const remoteJwks = createRemoteJWKSet(new URL(identityProvider.jwksUri));
    let verifiedTokenPayload: Record<string, unknown>;
    try {
      const verified = await jwtVerify(idToken, remoteJwks, {
        issuer: identityProvider.issuer,
        audience: identityProvider.clientId,
      });
      verifiedTokenPayload = verified.payload as Record<string, unknown>;
    } catch (error) {
      reply.code(401);
      await appendAuthAuditEvent(context.db, request, {
        organizationId: transaction.organizationId,
        actorType: "anonymous",
        actorId: request.ip,
        action: "auth.login.failed",
        payload: {
          reason: "id-token-invalid",
          error: error instanceof Error ? error.message : "unknown",
        },
      });
      logAuthEvent(request, "warn", "OIDC callback rejected: ID token invalid", {
        action: "auth.login.failed",
        authStage: "oidc_callback",
        authReason: "id-token-invalid",
        organizationSlug: transaction.organizationSlug,
        error: error instanceof Error ? error.message : "unknown",
      });
      return buildAuthErrorPayload("OIDC_ID_TOKEN_INVALID", "The OIDC ID token is invalid", {
        authStage: "oidc_callback",
        organizationSlug: transaction.organizationSlug,
        returnTo: transaction.returnTo,
      });
    }

    if (coerceString(verifiedTokenPayload.nonce) !== transaction.nonce) {
      reply.code(401);
      await appendAuthAuditEvent(context.db, request, {
        organizationId: transaction.organizationId,
        actorType: "anonymous",
        actorId: request.ip,
        action: "auth.login.failed",
        payload: {
          reason: "nonce-mismatch",
        },
      });
      logAuthEvent(request, "warn", "OIDC callback rejected: nonce mismatch", {
        action: "auth.login.failed",
        authStage: "oidc_callback",
        authReason: "nonce-mismatch",
        organizationSlug: transaction.organizationSlug,
      });
      return buildAuthErrorPayload("OIDC_NONCE_MISMATCH", "The OIDC nonce validation failed", {
        authStage: "oidc_callback",
        organizationSlug: transaction.organizationSlug,
        returnTo: transaction.returnTo,
      });
    }

    const subject = coerceString(verifiedTokenPayload.sub);
    if (!subject) {
      reply.code(401);
      logAuthEvent(request, "warn", "OIDC callback rejected: subject missing", {
        action: "auth.login.failed",
        authStage: "oidc_callback",
        authReason: "subject-missing",
        organizationSlug: transaction.organizationSlug,
      });
      return buildAuthErrorPayload("OIDC_SUBJECT_MISSING", "The OIDC subject claim is missing", {
        authStage: "oidc_callback",
        organizationSlug: transaction.organizationSlug,
        returnTo: transaction.returnTo,
      });
    }

    const userinfo = await fetchUserInfo({
      accessToken,
      userinfoEndpoint: identityProvider.userinfoEndpoint,
    });
    const { email, emailVerified, name, amr } = getIdTokenClaimSet(verifiedTokenPayload, userinfo);
    const sessionResult = await createOperatorSession(context, request, {
      organizationId: transaction.organizationId,
      organizationSlug: transaction.organizationSlug,
      identityProvider,
      subject,
      email: email ?? "",
      name,
      emailVerified,
      amr,
      externalIssuer: identityProvider.issuer,
      auditMode: "oidc",
    });

    if (!sessionResult.ok) {
      reply.code(sessionResult.statusCode);
      await appendAuthAuditEvent(context.db, request, {
        organizationId: transaction.organizationId,
        actorType: "operator",
        actorId: email ?? request.ip,
        action: "auth.login.failed",
        payload: {
          reason:
            sessionResult.message === "A verified member email is required to sign in"
              ? "unverified-email"
              : sessionResult.message === "No active workspace membership was found for this login"
                ? "no-active-membership"
                : "operator-session-creation-failed",
          organizationSlug: transaction.organizationSlug,
        },
      });
      logAuthEvent(request, "warn", "OIDC callback rejected during session creation", {
        action: "auth.login.failed",
        authStage: "oidc_callback",
        authReason: sessionResult.code,
        organizationSlug: transaction.organizationSlug,
        operatorEmail: email ?? null,
      });
      return buildAuthErrorPayload(sessionResult.code, sessionResult.message, {
        authStage: "oidc_callback",
        organizationSlug: transaction.organizationSlug,
        returnTo: transaction.returnTo,
      });
    }

    await appendAuthAuditEvent(context.db, request, {
      organizationId: transaction.organizationId,
      actorType: "operator",
      actorId: sessionResult.operator.email,
      action: "auth.login.succeeded",
      payload: {
        mode: "oidc",
        operatorId: sessionResult.operator.id,
        identityProviderId: identityProvider.id,
      },
    });
    logAuthEvent(request, "info", "OIDC login succeeded", {
      action: "auth.login.succeeded",
      authStage: "oidc_callback",
      organizationSlug: transaction.organizationSlug,
      operatorId: sessionResult.operator.id,
      operatorEmail: sessionResult.operator.email,
    });

    return AuthLoginCallbackResponseSchema.parse({
      sessionHandle: sessionResult.sessionHandle,
      returnTo: transaction.returnTo,
    });
  });

  app.post("/v1/auth/test-login", async (request, reply) => {
    if (context.env.NODE_ENV === "production") {
      reply.code(404);
      return buildAuthErrorPayload("LOGIN_DENIED", "Test login is unavailable");
    }

    const input = AuthTestLoginInputSchema.parse(request.body);
    let organization = await findOrganizationBySlug(context.db, input.organizationSlug);
    if (!organization) {
      const organizationsByEmail = await listOrganizationsByMemberEmail(context.db, input.email);
      if (organizationsByEmail.length === 1) {
        organization = organizationsByEmail[0] ?? null;
      }
    }

    if (!organization) {
      reply.code(404);
      return buildAuthErrorPayload("LOGIN_DENIED", "Organization not found");
    }

    const identityProvider = await ensureTestIdentityProvider(context, {
      organizationId: organization.id,
    });
    const sessionResult = await createOperatorSession(context, request, {
      organizationId: organization.id,
      organizationSlug: organization.slug,
      identityProvider,
      subject: `test:${input.email.toLowerCase()}`,
      email: input.email.toLowerCase(),
      name: input.email.split("@")[0] ?? input.email,
      emailVerified: true,
      amr: ["test-login"],
      externalIssuer: "https://teamops.test.local/dev-login",
      auditMode: "test-login",
    });

    if (!sessionResult.ok) {
      reply.code(sessionResult.statusCode);
      await appendAuthAuditEvent(context.db, request, {
        organizationId: organization.id,
        actorType: "operator",
        actorId: input.email.toLowerCase(),
        action: "auth.login.failed",
        payload: {
          mode: "test-login",
          reason:
            sessionResult.message === "No active workspace membership was found for this login"
              ? "no-active-membership"
              : "test-login-failed",
        },
      });
      return buildAuthErrorPayload(sessionResult.code, sessionResult.message);
    }

    await appendAuthAuditEvent(context.db, request, {
      organizationId: organization.id,
      actorType: "operator",
      actorId: sessionResult.operator.email,
      action: "auth.login.succeeded",
      payload: {
        mode: "test-login",
        operatorId: sessionResult.operator.id,
        identityProviderId: identityProvider.id,
      },
    });

    return AuthLoginCallbackResponseSchema.parse({
      sessionHandle: sessionResult.sessionHandle,
      returnTo: input.returnTo,
    });
  });

  app.post("/v1/auth/logout", async (request, reply) => {
    const sessionPrincipal = await requireSessionOrReply(context, request, reply);
    if ("error" in sessionPrincipal) {
      return sessionPrincipal;
    }

    const revokedSessionIds = await revokeControlPlaneSessionsForOperator(context.db, {
      organizationId: sessionPrincipal.organizationId,
      operatorId: sessionPrincipal.operatorId,
      revokedAt: new Date().toISOString(),
      reason: "logout",
      actorType: "operator",
      actorId: sessionPrincipal.email,
    });

    await appendAuthAuditEvent(context.db, request, {
      organizationId: sessionPrincipal.organizationId,
      actorType: "operator",
      actorId: sessionPrincipal.email,
      action: "auth.session.revoked",
      payload: {
        revokedSessionCount: revokedSessionIds.length,
        reason: "logout",
      },
    });

    await appendAuthAuditEvent(context.db, request, {
      organizationId: sessionPrincipal.organizationId,
      actorType: "operator",
      actorId: sessionPrincipal.email,
      action: "auth.logout.completed",
      payload: {
        revokedSessionCount: revokedSessionIds.length,
      },
    });

    reply.code(204);
    return null;
  });

  app.get("/v1/auth/session", async (request, reply) => {
    const sessionPrincipal = await requireSessionOrReply(context, request, reply);
    if ("error" in sessionPrincipal) {
      return sessionPrincipal;
    }

    const operator = await findControlPlaneOperatorById(context.db, sessionPrincipal.operatorId);

    return AuthSessionSchema.parse({
      authenticated: true,
      organizationId: sessionPrincipal.organizationId,
      organizationSlug: sessionPrincipal.organizationSlug,
      operatorId: sessionPrincipal.operatorId,
      email: sessionPrincipal.email,
      name: sessionPrincipal.operatorName,
      guideExitedWorkspaceIds: operator?.guideExitedWorkspaceIds ?? [],
      expiresAt: sessionPrincipal.expiresAt,
      idleExpiresAt: sessionPrincipal.idleExpiresAt,
      activeMembershipId: sessionPrincipal.activeMembershipId,
      activeRole: sessionPrincipal.activeRole,
    });
  });

  app.get("/v1/auth/session/identities", async (request, reply) => {
    const sessionPrincipal = await requireSessionOrReply(context, request, reply);
    if ("error" in sessionPrincipal) {
      return sessionPrincipal;
    }

    const memberships = await listActiveMemberIdentitiesByEmail(
      context.db,
      sessionPrincipal.email,
    );

    return memberships
      .filter((membership) => membership.roles.length > 0)
      .map((membership) => ({
        membershipId: membership.id,
        workspaceId: membership.workspaceId,
        workspaceName: membership.workspaceName,
        roles: membership.roles,
      }));
  });

  app.post("/v1/auth/session/active-identity", async (request, reply) => {
    const sessionPrincipal = await requireSessionOrReply(context, request, reply);
    if ("error" in sessionPrincipal) {
      return sessionPrincipal;
    }

    const body =
      request.body && typeof request.body === "object"
        ? (request.body as { membershipId?: unknown; role?: unknown })
        : {};
    const membershipId = typeof body.membershipId === "string" ? body.membershipId.trim() : "";
    const parsedRole = normalizeMemberRole(typeof body.role === "string" ? body.role.trim() : "");

    if (!membershipId || !parsedRole) {
      reply.code(400);
      return buildAuthErrorPayload("LOGIN_DENIED", "membershipId and role are required");
    }

    const role = parsedRole;

    const memberships = await listActiveMemberIdentitiesByEmail(
      context.db,
      sessionPrincipal.email,
    );
    const membership = memberships.find((item) => item.id === membershipId);

    if (!membership) {
      reply.code(403);
      return buildAuthErrorPayload("LOGIN_DENIED", "The requested membership is not available in this session");
    }

    const availableRoles = membership.roles;

    if (!availableRoles.includes(role)) {
      reply.code(403);
      return buildAuthErrorPayload("LOGIN_DENIED", "The requested role is not available for this membership");
    }

    await updateControlPlaneSessionActiveIdentity(context.db, {
      sessionId: sessionPrincipal.sessionId,
      activeMembershipId: membership.id,
      activeRole: role,
    });

    reply.code(204);
    return null;
  });

  app.post("/v1/auth/session/guide-preferences", async (request, reply) => {
    const sessionPrincipal = await requireSessionOrReply(context, request, reply);
    if ("error" in sessionPrincipal) {
      return sessionPrincipal;
    }

    const input = UpdateWorkspaceGuidePreferenceInputSchema.parse(request.body);
    const operator = await updateControlPlaneOperatorGuidePreference(context.db, {
      operatorId: sessionPrincipal.operatorId,
      workspaceId: input.workspaceId,
      exited: input.exited,
    });

    if (!operator) {
      reply.code(404);
      return buildAuthErrorPayload("LOGIN_DENIED", "The current control-plane operator could not be found");
    }

    return {
      guideExitedWorkspaceIds: operator.guideExitedWorkspaceIds,
    };
  });
}
