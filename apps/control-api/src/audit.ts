import type { FastifyRequest } from "fastify";

import {
  appendAuditLog,
  findControlPlaneSessionByHandleHash,
  findMemberByWorkspaceAndEmail,
  type Database,
} from "@teamops/database";

import {
  getHeaderValue,
  getRequestCorrelationId,
  getRequestExplicitActor,
  getRequestMemberEmail,
  getRequestOriginService,
  getRequestSourceRequestId,
  getWebAdminSessionHandle,
  hashControlPlaneSessionHandle,
} from "./auth.js";

export type WorkspaceOnboardingMilestoneAction =
  | "workspace.onboarding.first_provider_connected"
  | "workspace.onboarding.first_virtual_key_created"
  | "workspace.onboarding.first_provider_tested"
  | "workspace.onboarding.first_export_requested";

type AuditActor = {
  actorType: string;
  actorId: string;
  attributionSource:
    | "workspace-member"
    | "session"
    | "member-header"
    | "explicit-header"
    | "origin-service"
    | "system-fallback";
};

export async function getAuditActor(db: Database, request: FastifyRequest, workspaceId: string | null) {
  const explicitActor = getRequestExplicitActor(request.headers);
  const memberEmail = getRequestMemberEmail(request.headers);
  const sessionHandle = getWebAdminSessionHandle(request.headers);
  const originService = getRequestOriginService(request.headers);

  if (sessionHandle) {
    const session = await findControlPlaneSessionByHandleHash(db, hashControlPlaneSessionHandle(sessionHandle));
    if (session && !session.revokedAt) {
      return {
        actorType: "operator",
        actorId: session.operatorEmail,
        attributionSource: "session",
      } satisfies AuditActor;
    }
  }

  if (workspaceId && memberEmail) {
    const member = await findMemberByWorkspaceAndEmail(db, workspaceId, memberEmail);
    if (member) {
      return {
        actorType: "member",
        actorId: member.email,
        attributionSource: "workspace-member",
      } satisfies AuditActor;
    }
  }

  if (memberEmail) {
    return {
      actorType: "operator",
      actorId: memberEmail,
      attributionSource: "member-header",
    } satisfies AuditActor;
  }

  if (explicitActor) {
    return {
      ...explicitActor,
      attributionSource: "explicit-header",
    } satisfies AuditActor;
  }

  if (originService) {
    return {
      actorType: "service",
      actorId: originService,
      attributionSource: "origin-service",
    } satisfies AuditActor;
  }

  return {
    actorType: "system",
    actorId: "bootstrap",
    attributionSource: "system-fallback",
  } satisfies AuditActor;
}

function buildAuditPayload(request: FastifyRequest, actor: AuditActor, payload: Record<string, unknown>) {
  const explicitActor = getRequestExplicitActor(request.headers);
  const memberEmail = getRequestMemberEmail(request.headers);
  const correlationId = getRequestCorrelationId(request.headers, request.id);
  const sourceRequestId = getRequestSourceRequestId(request.headers);
  const originService = getRequestOriginService(request.headers);

  const requestContext: Record<string, unknown> = {
    requestId: request.id,
    ip: request.ip,
    userAgent: getHeaderValue(request.headers["user-agent"]),
  };

  if (correlationId && correlationId !== request.id) {
    requestContext.correlationId = correlationId;
  }

  if (sourceRequestId) {
    requestContext.sourceRequestId = sourceRequestId;
  }

  if (originService) {
    requestContext.originService = originService;
  }

  const actorContext =
    actor.attributionSource !== "system-fallback" || memberEmail || explicitActor
      ? {
          attributionSource: actor.attributionSource,
          memberEmail,
          explicitActorType: explicitActor?.actorType ?? null,
          explicitActorId: explicitActor?.actorId ?? null,
        }
      : null;

  return {
    ...payload,
    requestContext,
    ...(actorContext ? { actorContext } : {}),
  };
}

export async function appendRequestAuditLog(
  db: Database,
  request: FastifyRequest,
  input: {
    workspaceId: string | null;
    projectId?: string | null;
    environmentId?: string | null;
    customerId?: string | null;
    deploymentId?: string | null;
    releaseId?: string | null;
    fingerprintId?: string | null;
    action: string;
    subjectType: string;
    subjectId: string;
    payload: Record<string, unknown>;
  },
) {
  const actor = await getAuditActor(db, request, input.workspaceId);

  return appendAuditLog(db, {
    workspaceId: input.workspaceId,
    projectId: input.projectId ?? null,
    environmentId: input.environmentId ?? null,
    actorType: actor.actorType,
    actorId: actor.actorId,
    action: input.action,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    payload: buildAuditPayload(request, actor, input.payload),
  });
}

export async function appendWorkspaceOnboardingMilestoneIfAbsent(
  db: Database,
  request: FastifyRequest,
  input: {
    workspaceId: string;
    action: WorkspaceOnboardingMilestoneAction;
    projectId?: string | null;
    environmentId?: string | null;
    payload: Record<string, unknown>;
  },
) {
  const existingMilestone = await db.query(
    `
      select id
      from audit_logs
      where workspace_id = $1
        and action = $2
      limit 1
    `,
    [input.workspaceId, input.action],
  );

  if (existingMilestone.rowCount) {
    return null;
  }

  return appendRequestAuditLog(db, request, {
    workspaceId: input.workspaceId,
    projectId: input.projectId ?? null,
    environmentId: input.environmentId ?? null,
    action: input.action,
    subjectType: "workspace",
    subjectId: input.workspaceId,
    payload: input.payload,
  });
}
