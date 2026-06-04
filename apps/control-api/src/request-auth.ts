import type { FastifyRequest } from "fastify";

import { normalizeMemberRole, type MemberRole } from "@teamops/contracts";
import {
  appendAuditLog,
  findControlPlaneSessionByHandleHash,
  listActiveMemberIdentitiesByEmail,
  recordControlPlaneOperatorActivity,
  revokeControlPlaneSession,
  touchControlPlaneSession,
  updateControlPlaneSessionActiveIdentity,
} from "@teamops/database";

import { getBearerToken, getRequestMemberEmail, getWebAdminSessionHandle, hashControlPlaneSessionHandle } from "./auth.js";
import type { ControlApiContext } from "./context.js";

export type ResolvedRequestAuth =
  | {
      kind: "admin";
    }
  | {
      kind: "member-header";
      email: string;
    }
  | {
      kind: "session";
      email: string;
      organizationId: string;
      organizationSlug: string;
      operatorId: string;
      operatorName: string;
      sessionId: string;
      expiresAt: string;
      idleExpiresAt: string;
      activeMembershipId: string | null;
      activeRole: MemberRole | null;
    }
  | {
      kind: "none";
      errorCode: "AUTH_REQUIRED" | "SESSION_EXPIRED" | "SESSION_REVOKED";
    };

const authCache = new WeakMap<FastifyRequest, Promise<ResolvedRequestAuth>>();
const sessionTouchWindowMs = 5 * 60 * 1000;

function resolveDefaultActiveIdentity(args: {
  memberships: Awaited<ReturnType<typeof listActiveMemberIdentitiesByEmail>>;
  activeMembershipId: string | null;
  activeRole: MemberRole | null;
  preferredOrganizationId: string | null;
}) {
  const eligibleMemberships = args.memberships.filter(
    (membership) => membership.roles.length > 0,
  );
  const matchedMembership = args.activeMembershipId
    ? eligibleMemberships.find((membership) => membership.id === args.activeMembershipId) ?? null
    : null;

  if (matchedMembership) {
    const matchedRole =
      args.activeRole && matchedMembership.roles.includes(args.activeRole)
        ? args.activeRole
        : matchedMembership.roles[0] ?? null;

    return {
      activeMembershipId: matchedMembership.id,
      activeRole: matchedRole,
      organizationId: matchedMembership.organizationId,
      organizationSlug: matchedMembership.organizationSlug,
    };
  }

  const fallbackMembership =
    (args.preferredOrganizationId
      ? eligibleMemberships.find(
          (membership) => membership.organizationId === args.preferredOrganizationId,
        ) ?? null
      : null) ??
    eligibleMemberships[0] ??
    null;
  if (!fallbackMembership) {
    return {
      activeMembershipId: null,
      activeRole: null,
      organizationId: null,
      organizationSlug: null,
    };
  }

  return {
    activeMembershipId: fallbackMembership.id,
    activeRole: fallbackMembership.roles[0] ?? null,
    organizationId: fallbackMembership.organizationId,
    organizationSlug: fallbackMembership.organizationSlug,
  };
}

function parseSessionActiveRole(role: string | null) {
  return role ? normalizeMemberRole(role) : null;
}

function hasValidAdminToken(context: ControlApiContext, request: FastifyRequest) {
  const configuredAdminToken = context.env.CONTROL_API_ADMIN_TOKEN?.trim();
  if (!configuredAdminToken) {
    return false;
  }

  const token = getBearerToken(request.headers.authorization);
  return token === configuredAdminToken;
}

async function appendSessionAuditEvent(
  context: ControlApiContext,
  request: FastifyRequest,
  input: {
    action: "auth.session.expired" | "auth.session.revoked";
    organizationId: string;
    actorId: string;
    sessionId: string;
    reason: string;
  },
) {
  try {
    await appendAuditLog(context.db, {
      workspaceId: null,
      actorType: "operator",
      actorId: input.actorId,
      action: input.action,
      subjectType: "organization",
      subjectId: input.organizationId,
      payload: {
        sessionId: input.sessionId,
        reason: input.reason,
        route: request.url,
      },
    });
  } catch {
    // Preserve the underlying auth result even if the audit trail fails.
  }
}

async function revokeExpiredSession(
  context: ControlApiContext,
  request: FastifyRequest,
  input: {
    sessionId: string;
    organizationId: string;
    actorId: string;
  },
) {
  await revokeControlPlaneSession(context.db, {
    sessionId: input.sessionId,
    revokedAt: new Date().toISOString(),
    reason: "expired",
    actorType: "system",
    actorId: "control-api",
  });
  await appendSessionAuditEvent(context, request, {
    action: "auth.session.expired",
    organizationId: input.organizationId,
    actorId: input.actorId,
    sessionId: input.sessionId,
    reason: "expired",
  });
}

async function resolveRequestAuthUncached(
  context: ControlApiContext,
  request: FastifyRequest,
): Promise<ResolvedRequestAuth> {
  if (hasValidAdminToken(context, request)) {
    return {
      kind: "admin",
    };
  }

  const sessionHandle = getWebAdminSessionHandle(request.headers);
  if (sessionHandle) {
    const session = await findControlPlaneSessionByHandleHash(
      context.db,
      hashControlPlaneSessionHandle(sessionHandle),
    );

    if (!session) {
      return {
        kind: "none",
        errorCode: "SESSION_REVOKED",
      };
    }

    if (session.revokedAt) {
      return {
        kind: "none",
        errorCode: "SESSION_REVOKED",
      };
    }

    const now = Date.now();
    if (Date.parse(session.expiresAt) <= now || Date.parse(session.idleExpiresAt) <= now) {
      await revokeExpiredSession(context, request, {
        sessionId: session.id,
        organizationId: session.organizationId,
        actorId: session.operatorEmail,
      });
      return {
        kind: "none",
        errorCode: "SESSION_EXPIRED",
      };
    }

    if (session.operatorStatus !== "active") {
      await revokeControlPlaneSession(context.db, {
        sessionId: session.id,
        revokedAt: new Date().toISOString(),
        reason: "operator-disabled",
        actorType: "system",
        actorId: "control-api",
      });
      await appendSessionAuditEvent(context, request, {
        action: "auth.session.revoked",
        organizationId: session.organizationId,
        actorId: session.operatorEmail,
        sessionId: session.id,
        reason: "operator-disabled",
      });
      return {
        kind: "none",
        errorCode: "SESSION_REVOKED",
      };
    }

    const lastSeenAt = Date.parse(session.lastSeenAt);
    const memberships = await listActiveMemberIdentitiesByEmail(
      context.db,
      session.operatorEmail,
    );
    const sessionActiveRole = parseSessionActiveRole(session.activeRole);
    const resolvedActiveIdentity = resolveDefaultActiveIdentity({
      memberships,
      activeMembershipId: session.activeMembershipId,
      activeRole: sessionActiveRole,
      preferredOrganizationId: session.organizationId,
    });

    if (
      resolvedActiveIdentity.activeMembershipId !== session.activeMembershipId ||
      resolvedActiveIdentity.activeRole !== session.activeRole
    ) {
      await updateControlPlaneSessionActiveIdentity(context.db, {
        sessionId: session.id,
        activeMembershipId: resolvedActiveIdentity.activeMembershipId,
        activeRole: resolvedActiveIdentity.activeRole,
      });
    }

    if (!Number.isFinite(lastSeenAt) || now - lastSeenAt >= sessionTouchWindowMs) {
      const seenAt = new Date(now).toISOString();
      await Promise.all([
        touchControlPlaneSession(context.db, session.id, {
          seenAt,
          idleExpiresAt: new Date(now + 60 * 60 * 1000).toISOString(),
        }),
        recordControlPlaneOperatorActivity(context.db, session.operatorId, {
          recordedAt: seenAt,
          markLogin: false,
        }),
      ]);
    }

    return {
      kind: "session",
      email: session.operatorEmail,
      organizationId:
        resolvedActiveIdentity.organizationId ?? session.organizationId,
      organizationSlug:
        resolvedActiveIdentity.organizationSlug ?? session.organizationSlug,
      operatorId: session.operatorId,
      operatorName: session.operatorName,
      sessionId: session.id,
      expiresAt: session.expiresAt,
      idleExpiresAt: session.idleExpiresAt,
      activeMembershipId: resolvedActiveIdentity.activeMembershipId,
      activeRole: resolvedActiveIdentity.activeRole,
    };
  }

  const memberEmail = getRequestMemberEmail(request.headers);
  if (memberEmail) {
    return {
      kind: "member-header",
      email: memberEmail,
    };
  }

  return {
    kind: "none",
    errorCode: "AUTH_REQUIRED",
  };
}

export function resolveRequestAuth(context: ControlApiContext, request: FastifyRequest) {
  const cached = authCache.get(request);
  if (cached) {
    return cached;
  }

  const promise = resolveRequestAuthUncached(context, request);
  authCache.set(request, promise);
  return promise;
}

export async function getRequestScopedEmail(context: ControlApiContext, request: FastifyRequest) {
  const auth = await resolveRequestAuth(context, request);
  if (auth.kind === "session" || auth.kind === "member-header") {
    return auth.email;
  }

  return null;
}

export async function requireSessionPrincipal(context: ControlApiContext, request: FastifyRequest) {
  const auth = await resolveRequestAuth(context, request);
  return auth.kind === "session" ? auth : null;
}
