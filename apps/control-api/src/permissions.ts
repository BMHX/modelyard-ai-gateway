import type { FastifyReply, FastifyRequest } from "fastify";

import { roleHasPermission, type Member, type WorkspacePermission } from "@teamops/contracts";
import {
  appendAuditLog,
  findMemberByWorkspaceAndEmail,
  hasOrganizationOwnerMembership,
  recordMemberActivity,
} from "@teamops/database";

import type { ControlApiContext } from "./context.js";
import { getBearerToken } from "./auth.js";
import { resolveRequestAuth } from "./request-auth.js";

export function hasAdminAccess(context: ControlApiContext, request: FastifyRequest) {
  const configuredAdminToken = context.env.CONTROL_API_ADMIN_TOKEN?.trim();
  if (!configuredAdminToken) {
    return false;
  }

  const token = getBearerToken(request.headers.authorization);
  return token === configuredAdminToken;
}

export function requireAdminAccess(context: ControlApiContext, request: FastifyRequest, reply: FastifyReply) {
  if (hasAdminAccess(context, request)) {
    return null;
  }

  reply.code(401);
  return {
    error: {
      message: "Control API admin access is required for this route",
    },
  };
}

export type WorkspaceAccess =
  | {
      isAdmin: true;
      member: null;
    }
  | {
      isAdmin: false;
      member: Member;
    };

export function canManageExportGovernance(access: WorkspaceAccess) {
  return access.isAdmin || access.member.role === "organization_owner" || access.member.role === "workspace_admin";
}

const memberActivityRefreshWindowMs = 5 * 60 * 1000;
const memberLoginGapWindowMs = 8 * 60 * 60 * 1000;

async function appendAccessDeniedAudit(
  context: ControlApiContext,
  request: FastifyRequest,
  args: {
    workspaceId?: string | null;
    organizationId?: string | null;
    actorId: string;
    message: string;
    permission?: string;
  },
) {
  try {
    await appendAuditLog(context.db, {
      workspaceId: args.workspaceId ?? null,
      actorType: "operator",
      actorId: args.actorId,
      action: "auth.access.denied",
      subjectType: args.organizationId ? "organization" : "workspace",
      subjectId: args.organizationId ?? String(args.workspaceId),
      payload: {
        message: args.message,
        permission: args.permission ?? null,
        route: request.url,
      },
    });
  } catch {
    // Denied requests should not fail because audit logging also failed.
  }
}

function isExpiredIsoTimestamp(value: string | null | undefined, now = Date.now()) {
  if (!value) {
    return false;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed <= now;
}

function shouldRefreshMemberActivity(member: Member, now = Date.now()) {
  if (!member.lastActiveAt) {
    return true;
  }

  const parsed = Date.parse(member.lastActiveAt);
  return !Number.isFinite(parsed) || now - parsed >= memberActivityRefreshWindowMs;
}

function shouldMarkMemberLogin(member: Member, now = Date.now()) {
  if (!member.lastLoginAt || !member.lastActiveAt) {
    return true;
  }

  const lastActiveAt = Date.parse(member.lastActiveAt);
  return !Number.isFinite(lastActiveAt) || now - lastActiveAt >= memberLoginGapWindowMs;
}

export async function getWorkspaceAccess(
  context: ControlApiContext,
  request: FastifyRequest,
  reply: FastifyReply,
  permission: WorkspacePermission,
  workspaceId: string,
): Promise<WorkspaceAccess | { error: { message: string; code?: string } }> {
  if (hasAdminAccess(context, request)) {
    return {
      isAdmin: true,
      member: null,
    };
  }

  const auth = await resolveRequestAuth(context, request);
  if (auth.kind === "admin") {
    return {
      isAdmin: true,
      member: null,
    };
  }

  if (auth.kind === "none") {
    reply.code(401);
    return {
      error: {
        code: auth.errorCode,
        message:
          auth.errorCode === "AUTH_REQUIRED"
            ? "Authentication is required for this route"
            : auth.errorCode === "SESSION_EXPIRED"
              ? "The current control-plane session has expired"
              : "The current control-plane session has been revoked",
      },
    };
  }

  const member = await findMemberByWorkspaceAndEmail(context.db, workspaceId, auth.email);
  if (!member) {
    reply.code(403);
    await appendAccessDeniedAudit(context, request, {
      workspaceId,
      actorId: auth.email,
      message: "No active workspace membership was found for this request",
      permission,
    });
    return {
      error: {
        message: "No active workspace membership was found for this request",
      },
    };
  }

  const effectiveMember =
    auth.kind === "session"
      ? (() => {
          const availableRoles = member.roles.length ? member.roles : [member.role];
          if (auth.activeMembershipId !== member.id) {
            return null;
          }

          if (!auth.activeRole || !availableRoles.includes(auth.activeRole)) {
            return null;
          }

          return {
            ...member,
            role: auth.activeRole,
          };
        })()
      : member;

  if (!effectiveMember) {
    reply.code(403);
    await appendAccessDeniedAudit(context, request, {
      workspaceId,
      actorId: auth.email,
      message: "The current active identity does not have access to this workspace",
      permission,
    });
    return {
      error: {
        message: "The current active identity does not have access to this workspace",
      },
    };
  }

  if (effectiveMember.status !== "active") {
    reply.code(403);
    await appendAccessDeniedAudit(context, request, {
      workspaceId,
      actorId: auth.email,
      message: `Member status ${effectiveMember.status} is not allowed to access the control API`,
      permission,
    });
    return {
      error: {
        message: `Member status ${effectiveMember.status} is not allowed to access the control API`,
      },
    };
  }

  if (isExpiredIsoTimestamp(effectiveMember.temporaryAccessExpiresAt)) {
    reply.code(403);
    await appendAccessDeniedAudit(context, request, {
      workspaceId,
      actorId: auth.email,
      message: "Temporary access has expired for this member",
      permission,
    });
    return {
      error: {
        message: "Temporary access has expired for this member",
      },
    };
  }

  if (!effectiveMember.roles.length) {
    reply.code(403);
    await appendAccessDeniedAudit(context, request, {
      workspaceId,
      actorId: auth.email,
      message: "No permission is assigned to this membership",
      permission,
    });
    return {
      error: {
        message: "No permission is assigned to this membership",
      },
    };
  }

  if (!roleHasPermission(effectiveMember.role, permission)) {
    reply.code(403);
    await appendAccessDeniedAudit(context, request, {
      workspaceId,
      actorId: auth.email,
      message: `Role ${effectiveMember.role} does not have permission ${permission}`,
      permission,
    });
    return {
      error: {
        message: `Role ${effectiveMember.role} does not have permission ${permission}`,
      },
    };
  }

  const now = new Date();
  const refreshActivity = shouldRefreshMemberActivity(effectiveMember, now.getTime());
  const markLogin = shouldMarkMemberLogin(effectiveMember, now.getTime());
  const hydratedMember =
    refreshActivity || markLogin
      ? (await recordMemberActivity(context.db, effectiveMember.id, {
          recordedAt: now.toISOString(),
          markLogin,
        })) ?? effectiveMember
      : effectiveMember;

  return {
    isAdmin: false,
    member: {
      ...hydratedMember,
      role: effectiveMember.role,
    },
  };
}

export async function requireWorkspacePermission(
  context: ControlApiContext,
  request: FastifyRequest,
  reply: FastifyReply,
  permission: WorkspacePermission,
  workspaceId: string,
) {
  const access = await getWorkspaceAccess(context, request, reply, permission, workspaceId);
  if ("error" in access) {
    return access;
  }

  return null;
}

export async function requireOrganizationOwnerAccess(
  context: ControlApiContext,
  request: FastifyRequest,
  reply: FastifyReply,
  organizationId: string,
) {
  if (hasAdminAccess(context, request)) {
    return null;
  }

  const auth = await resolveRequestAuth(context, request);
  if (auth.kind === "admin") {
    return null;
  }

  if (auth.kind === "none") {
    reply.code(401);
    return {
      error: {
        code: auth.errorCode,
        message:
          auth.errorCode === "AUTH_REQUIRED"
            ? "Authentication is required for this route"
            : auth.errorCode === "SESSION_EXPIRED"
              ? "The current control-plane session has expired"
              : "The current control-plane session has been revoked",
      },
    };
  }

  const hasAccess = await hasOrganizationOwnerMembership(context.db, organizationId, auth.email);
  if (hasAccess) {
    return null;
  }

  reply.code(403);
  await appendAccessDeniedAudit(context, request, {
    organizationId,
    actorId: auth.email,
    message: "Organization owner access is required for this route",
  });
  return {
    error: {
      message: "Organization owner access is required for this route",
    },
  };
}
