import type { FastifyInstance } from "fastify";

import { CreateVirtualKeyInputSchema, VirtualKeyListQuerySchema } from "@teamops/contracts";
import { createVirtualKey, listVirtualKeys, revokeVirtualKey, rotateVirtualKey } from "@teamops/database";

import { appendRequestAuditLog, appendWorkspaceOnboardingMilestoneIfAbsent } from "../audit.js";
import type { ControlApiContext } from "../context.js";
import {
  getMemberSelfScopeFilters,
  isVirtualKeyVisibleWithinMemberSelfScope,
} from "../member-self-scope.js";
import { getWorkspaceAccess } from "../permissions.js";
import { getAssignedProjectIdSet } from "../project-scope.js";
import {
  requireEnvironmentInWorkspace,
  requireProjectInWorkspace,
  requireProviderConnectionInWorkspace,
  requireVirtualKey,
} from "../resource-guards.js";

function buildVirtualKeyScopeError(message: string) {
  return {
    error: {
      message,
    },
  };
}

function createEmptyVirtualKeyListResponse() {
  return {
    items: [],
    total: 0,
    summary: {
      total: 0,
      active: 0,
      revoked: 0,
      expired: 0,
      neverUsed: 0,
      environmentBound: 0,
    },
  };
}

function isExpiredVirtualKey(expiresAt: string | null, now = new Date()) {
  if (!expiresAt) {
    return false;
  }

  return Date.parse(expiresAt) <= now.getTime();
}

export async function registerVirtualKeyRoutes(app: FastifyInstance, context: ControlApiContext) {
  app.get("/v1/virtual-keys", async (request, reply) => {
    const query = VirtualKeyListQuerySchema.parse(request.query);
    if (!query.workspaceId) {
      return createEmptyVirtualKeyListResponse();
    }

    const access = await getWorkspaceAccess(
      context,
      request,
      reply,
      "virtual_key.read",
      query.workspaceId,
    );
    if ("error" in access) {
      return access;
    }

    const scopedProjectIds = await getAssignedProjectIdSet(context, access);
    const memberSelfScopeFilters = getMemberSelfScopeFilters(access);
    if (scopedProjectIds && !scopedProjectIds.size) {
      return createEmptyVirtualKeyListResponse();
    }

    return listVirtualKeys(context.db, {
      workspaceId: query.workspaceId,
      projectIds: scopedProjectIds ? [...scopedProjectIds] : undefined,
      owner: memberSelfScopeFilters?.owner,
      issuedByMemberId: memberSelfScopeFilters?.issuedByMemberId,
      limit: query.limit,
      offset: query.offset,
    });
  });

  app.post("/v1/virtual-keys", async (request, reply) => {
    const input = CreateVirtualKeyInputSchema.parse(request.body);
    const access = await getWorkspaceAccess(
      context,
      request,
      reply,
      "virtual_key.write",
      input.workspaceId,
    );
    if ("error" in access) {
      return access;
    }

    if (isExpiredVirtualKey(input.expiresAt)) {
      reply.code(400);
      return {
        error: {
          message: "expiresAt must be in the future",
        },
      };
    }

    const scopedProjectIds = await getAssignedProjectIdSet(context, access);
    const providerConnection = input.providerConnectionId
      ? await requireProviderConnectionInWorkspace(
          context.db,
          reply,
          input.providerConnectionId,
          input.workspaceId,
        )
      : null;
    if (providerConnection && "error" in providerConnection) {
      return providerConnection;
    }

    if (providerConnection && providerConnection.status !== "active") {
      reply.code(409);
      return {
        error: {
          message: "Only active provider connections can issue virtual keys",
        },
      };
    }

    if (input.projectId) {
      const project = await requireProjectInWorkspace(context.db, reply, input.projectId, input.workspaceId);
      if ("error" in project) {
        return project;
      }

      if (scopedProjectIds && !scopedProjectIds.has(project.id)) {
        reply.code(403);
        return buildVirtualKeyScopeError("This project is outside the current assigned project scope");
      }
    } else if (scopedProjectIds && !input.environmentId) {
      reply.code(403);
      return buildVirtualKeyScopeError("Assignment-scoped members can only create project-scoped virtual keys");
    }

    let normalizedInput = input;
    if (input.environmentId) {
      const environment = await requireEnvironmentInWorkspace(context.db, reply, input.environmentId, input.workspaceId);
      if ("error" in environment) {
        return environment;
      }

      if (input.projectId && input.projectId !== environment.projectId) {
        reply.code(400);
        return {
          error: {
            message: "Selected environment does not belong to the requested project",
          },
        };
      }

      if (scopedProjectIds && !scopedProjectIds.has(environment.projectId)) {
        reply.code(403);
        return buildVirtualKeyScopeError("This environment is outside the current assigned project scope");
      }

      normalizedInput = {
        ...input,
        projectId: environment.projectId,
        environment: environment.runtime,
      };
    }

    const created = await createVirtualKey(context.db, normalizedInput);

    await appendRequestAuditLog(context.db, request, {
      workspaceId: created.record.workspaceId,
      projectId: created.record.projectId,
      environmentId: created.record.environmentId,
      action: "virtual-key.created",
      subjectType: "virtual-key",
      subjectId: created.record.id,
      payload: {
        label: created.record.label,
        owner: created.record.owner,
        team: created.record.team,
        service: created.record.service,
        providerConnectionId: created.record.providerConnectionId,
        provider: providerConnection ? providerConnection.provider : null,
        environment: created.record.environment,
        keyPrefix: created.record.keyPrefix,
      },
    });

    await appendWorkspaceOnboardingMilestoneIfAbsent(context.db, request, {
      workspaceId: created.record.workspaceId,
      projectId: created.record.projectId,
      environmentId: created.record.environmentId,
      action: "workspace.onboarding.first_virtual_key_created",
      payload: {
        virtualKeyId: created.record.id,
        label: created.record.label,
        providerConnectionId: created.record.providerConnectionId,
        provider: providerConnection ? providerConnection.provider : null,
        environment: created.record.environment,
        keyPrefix: created.record.keyPrefix,
      },
    });

    reply.code(201);
    return {
      token: created.token,
      ...created.record,
    };
  });

  app.post("/v1/virtual-keys/:virtualKeyId/revoke", async (request, reply) => {
    const params = request.params as { virtualKeyId: string };
    const virtualKey = await requireVirtualKey(context.db, reply, params.virtualKeyId);
    if ("error" in virtualKey) {
      return virtualKey;
    }

    const access = await getWorkspaceAccess(
      context,
      request,
      reply,
      "virtual_key.write",
      virtualKey.workspaceId,
    );
    if ("error" in access) {
      return access;
    }

    const scopedProjectIds = await getAssignedProjectIdSet(context, access);
    if (scopedProjectIds && (!virtualKey.projectId || !scopedProjectIds.has(virtualKey.projectId))) {
      reply.code(403);
      return buildVirtualKeyScopeError("This virtual key is outside the current assigned project scope");
    }
    if (!isVirtualKeyVisibleWithinMemberSelfScope(access, virtualKey)) {
      reply.code(403);
      return buildVirtualKeyScopeError("This virtual key is outside the current member scope");
    }

    if (virtualKey.status === "revoked") {
      return virtualKey;
    }

    const revokedVirtualKey = await revokeVirtualKey(context.db, virtualKey.id);
    if (!revokedVirtualKey) {
      reply.code(404);
      return {
        error: {
          message: "Virtual key not found",
        },
      };
    }

    await appendRequestAuditLog(context.db, request, {
      workspaceId: revokedVirtualKey.workspaceId,
      projectId: revokedVirtualKey.projectId,
      environmentId: revokedVirtualKey.environmentId,
      action: "virtual-key.revoked",
      subjectType: "virtual-key",
      subjectId: revokedVirtualKey.id,
      payload: {
        label: revokedVirtualKey.label,
        keyPrefix: revokedVirtualKey.keyPrefix,
        previousStatus: virtualKey.status,
        nextStatus: revokedVirtualKey.status,
      },
    });

    return revokedVirtualKey;
  });

  app.post("/v1/virtual-keys/:virtualKeyId/rotate", async (request, reply) => {
    const params = request.params as { virtualKeyId: string };
    const virtualKey = await requireVirtualKey(context.db, reply, params.virtualKeyId);
    if ("error" in virtualKey) {
      return virtualKey;
    }

    const access = await getWorkspaceAccess(
      context,
      request,
      reply,
      "virtual_key.write",
      virtualKey.workspaceId,
    );
    if ("error" in access) {
      return access;
    }

    const scopedProjectIds = await getAssignedProjectIdSet(context, access);
    if (scopedProjectIds && (!virtualKey.projectId || !scopedProjectIds.has(virtualKey.projectId))) {
      reply.code(403);
      return buildVirtualKeyScopeError("This virtual key is outside the current assigned project scope");
    }
    if (!isVirtualKeyVisibleWithinMemberSelfScope(access, virtualKey)) {
      reply.code(403);
      return buildVirtualKeyScopeError("This virtual key is outside the current member scope");
    }

    if (virtualKey.status !== "active") {
      reply.code(409);
      return {
        error: {
          message: "Only active virtual keys can be rotated",
        },
      };
    }

    if (isExpiredVirtualKey(virtualKey.expiresAt)) {
      reply.code(409);
      return {
        error: {
          message: "Expired virtual keys cannot be rotated; create a new key instead",
        },
      };
    }

    const rotatedVirtualKey = await rotateVirtualKey(context.db, virtualKey.id);
    if (!rotatedVirtualKey) {
      reply.code(409);
      return {
        error: {
          message: "Virtual key is no longer active; refresh and try again",
        },
      };
    }

    await appendRequestAuditLog(context.db, request, {
      workspaceId: virtualKey.workspaceId,
      action: "virtual-key.rotated",
      subjectType: "virtual-key",
      subjectId: virtualKey.id,
      payload: {
        previousVirtualKeyId: virtualKey.id,
        previousKeyPrefix: virtualKey.keyPrefix,
        nextVirtualKeyId: rotatedVirtualKey.record.id,
        nextKeyPrefix: rotatedVirtualKey.record.keyPrefix,
        providerConnectionId: virtualKey.providerConnectionId,
      },
    });

    reply.code(201);
    return {
      token: rotatedVirtualKey.token,
      ...rotatedVirtualKey.record,
    };
  });
}
