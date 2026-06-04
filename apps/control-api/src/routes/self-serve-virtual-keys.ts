import type { FastifyInstance } from "fastify";

import {
  CreatedVirtualKeyResponseSchema,
  IssueSelfServeVirtualKeyInputSchema,
  normalizeProviderKindHint,
  normalizeProviderModel,
  VirtualKeySchema,
  type ProviderRoutingProtocol,
  SelfServeAvailableTargetSchema,
  SelfServeModelCatalogSchema,
  SelfServeProviderConnectionSummarySchema,
  SelfServeVirtualKeyBootstrapSchema,
  getProviderConfiguredModelCatalogItems,
  getUncoveredProviderModelIds,
  providerConnectionSupportsProtocol,
  roleHasPermission,
} from "@teamops/contracts";
import {
  appendAuditLog,
  findMemberById,
  findMemberByWorkspaceAndEmail,
  findProjectById,
  issueSelfServeVirtualKey,
  listAssignedProjectIdsForMember,
  listProjects,
  listProviderConnections,
  listActiveSelfServeVirtualKeysForMember,
  revokeSelfServeVirtualKey,
  rotateSelfServeVirtualKey,
} from "@teamops/database";

import type { ControlApiContext } from "../context.js";
import { loadWorkspaceDefaultVirtualKeyTtlHours } from "../console-settings.js";
import { resolveRequestAuth } from "../request-auth.js";
import { validateResourceId } from "../resource-guards.js";
import { listReadyAssignedWorkspaceModels } from "../workspace-model-catalog.js";

type ActiveProviderConnection = Awaited<ReturnType<typeof listProviderConnections>>[number];

function canSelfServeVirtualKeys(role: string) {
  return role === "developer";
}

function buildSelfServeForbiddenMessage() {
  return {
    error: {
      code: "SELF_SERVE_FORBIDDEN",
      message: "This member cannot self-serve virtual keys",
    },
  };
}

function buildNotFoundMessage(resource: string, code?: string) {
  return {
    error: {
      ...(code ? { code } : {}),
      message: `${resource} not found`,
    },
  };
}

function getProtocolLabel(protocol: ProviderRoutingProtocol) {
  return protocol === "anthropic" ? "Anthropic" : "OpenAI-compatible";
}

function listAvailableSelfServeTargets(
  providerConnections: ActiveProviderConnection[],
  protocol: ProviderRoutingProtocol,
) {
  return providerConnections
    .filter((connection) => providerConnectionSupportsProtocol(connection.provider, protocol))
    .flatMap((connection) => {
      const target = buildSelfServeAvailableTarget(connection, protocol);
      return target ? [target] : [];
    })
    .sort((left, right) => left.label.localeCompare(right.label));
}

function buildAvailableSelfServeSources(args: {
  models: Awaited<ReturnType<typeof listReadyAssignedWorkspaceModels>>;
  activeProviderConnections: ActiveProviderConnection[];
  protocol: ProviderRoutingProtocol;
}) {
  const activeConnectionsById = new Map(
    args.activeProviderConnections
      .filter((connection) => providerConnectionSupportsProtocol(connection.provider, args.protocol))
      .map((connection) => [connection.id, connection]),
  );

  return [...activeConnectionsById.values()]
    .map((connection) => {
      const models = [...new Map(
        args.models
          .filter((model) => model.candidateConnectionIds.includes(connection.id))
          .map((model) => [
            normalizeProviderModel(model.modelId),
            {
              id: model.modelId,
              label: model.label,
              ownedBy: null,
            },
          ]),
      ).values()];

      if (!models.length) {
        return null;
      }

      return {
        providerConnectionId: connection.id,
        label: connection.label,
        provider: normalizeProviderKindHint(connection.provider) ?? connection.provider,
        protocol: args.protocol,
        models,
      };
    })
    .filter((source): source is NonNullable<typeof source> => Boolean(source));
}

function buildSelfServeAvailableTarget(
  connection: ActiveProviderConnection,
  protocol: ProviderRoutingProtocol,
) {
  const configuredModels = getProviderConfiguredModelCatalogItems(
    connection.metadata,
    connection.pricingConfig,
  );
  const uncoveredModels = getUncoveredProviderModelIds({
    provider: connection.provider,
    modelIds: configuredModels.map((item) => item.id),
    pricingConfig: connection.pricingConfig,
    metadata: connection.metadata,
  });

  const status =
    configuredModels.length === 0
      ? "missing_configured_models"
      : uncoveredModels.length > 0
        ? "pricing_uncovered"
        : "ready";

  const parsed = SelfServeAvailableTargetSchema.safeParse({
    providerConnectionId: connection.id,
    label: connection.label,
    provider: connection.provider,
    protocol,
    status,
    reason: status === "ready" ? null : status,
    uncoveredModels,
  });

  return parsed.success ? parsed.data : null;
}

function resolveSelfServeProviderConnection(
  providerConnections: ActiveProviderConnection[],
  providerConnectionId: string,
  protocol: ProviderRoutingProtocol,
) {
  const connection = providerConnections.find((item) => item.id === providerConnectionId) ?? null;
  if (!connection) {
    return {
      code: "SELF_SERVE_PROVIDER_CONNECTION_NOT_FOUND",
      message: "The selected provider connection is not available for this workspace",
      statusCode: 404 as const,
      connection: null,
    };
  }

  if (!providerConnectionSupportsProtocol(connection.provider, protocol)) {
    return {
      code: "SELF_SERVE_PROVIDER_PROTOCOL_UNSUPPORTED",
      message: `The selected provider connection does not support ${getProtocolLabel(protocol)} traffic`,
      statusCode: 409 as const,
      connection: null,
    };
  }

  return {
    code: null,
    message: null,
    statusCode: 200 as const,
    connection,
  };
}

function getSelfServeExpiryIso(ttlHours: number, now = new Date()) {
  return new Date(now.getTime() + ttlHours * 60 * 60 * 1000).toISOString();
}

function buildSelfServeLabel(projectSlug: string, email: string) {
  const localPart = (email.split("@")[0] ?? email).trim().toLowerCase().replace(/[^a-z0-9._-]/g, "-");
  return `self-serve-${projectSlug}-${localPart}`.slice(0, 120);
}

async function resolveSelfServeMember(
  context: ControlApiContext,
  workspaceId: string,
  auth: Awaited<ReturnType<typeof resolveRequestAuth>>,
) {
  if (auth.kind === "session" && auth.activeMembershipId) {
    const activeMember = await findMemberById(context.db, auth.activeMembershipId);
    if (activeMember && activeMember.workspaceId === workspaceId) {
      return activeMember;
    }

    return null;
  }

  if (auth.kind === "member-header") {
    return findMemberByWorkspaceAndEmail(context.db, workspaceId, auth.email);
  }

  return null;
}

async function requireSelfServeMember(
  context: ControlApiContext,
  request: Parameters<FastifyInstance["get"]>[1] extends never ? never : any,
  workspaceId: string,
) {
  const auth = await resolveRequestAuth(context, request);
  if (auth.kind === "none" || auth.kind === "admin") {
    return {
      error: {
        code: "AUTH_REQUIRED",
        message: "Authentication is required for this route",
      },
      statusCode: 401,
    };
  }

  const member = await resolveSelfServeMember(context, workspaceId, auth);
  if (!member) {
    return {
      error: {
        code: "SELF_SERVE_MEMBERSHIP_REQUIRED",
        message: "No active workspace membership was found for this request",
      },
      statusCode: 403,
    };
  }

  const effectiveRole =
    auth.kind === "session"
      ? !auth.activeRole
        ? null
        : member.roles.includes(auth.activeRole)
          ? auth.activeRole
          : null
      : member.role;

  if (
    member.status !== "active" ||
    !effectiveRole ||
    !canSelfServeVirtualKeys(effectiveRole) ||
    !roleHasPermission(effectiveRole, "workspace.read") ||
    !roleHasPermission(effectiveRole, "virtual_key.read")
  ) {
    return {
      error: buildSelfServeForbiddenMessage().error,
      statusCode: 403,
    };
  }

  return {
    member: {
      ...member,
      role: effectiveRole,
    },
    statusCode: 200,
  };
}

async function appendSelfServeAudit(
  context: ControlApiContext,
  args: {
    workspaceId: string;
    projectId: string | null;
    actorId: string;
    action: string;
    subjectId: string;
    payload: Record<string, unknown>;
  },
) {
  await appendAuditLog(context.db, {
    workspaceId: args.workspaceId,
    projectId: args.projectId,
    environmentId: null,
    actorType: "operator",
    actorId: args.actorId,
    action: args.action,
    subjectType: "virtual-key",
    subjectId: args.subjectId,
    payload: args.payload,
  });
}

export async function registerSelfServeVirtualKeyRoutes(app: FastifyInstance, context: ControlApiContext) {
  app.get("/v1/workspaces/:workspaceId/self-serve-virtual-keys/bootstrap", async (request, reply) => {
    const params = request.params as { workspaceId: string };
    const validationError = validateResourceId(reply, "workspace", params.workspaceId);
    if (validationError) {
      return validationError;
    }

    const memberResult = await requireSelfServeMember(context, request, params.workspaceId);
    if ("error" in memberResult) {
      reply.code(memberResult.statusCode);
      return memberResult;
    }

    const assignedProjectIds = await listAssignedProjectIdsForMember(context.db, memberResult.member.id);
    const allProjects = await listProjects(context.db, params.workspaceId);
    const allowedProjects = allProjects.filter((project) => assignedProjectIds.includes(project.id) && project.status === "active");
    const activeProviderConnections = (await listProviderConnections(context.db, params.workspaceId)).filter(
      (connection) => connection.status === "active",
    );
    const providerConnections = activeProviderConnections.flatMap((connection) => {
        const parsed = SelfServeProviderConnectionSummarySchema.safeParse({
          id: connection.id,
          label: connection.label,
          provider: connection.provider,
          configuredModels: getProviderConfiguredModelCatalogItems(
            connection.metadata,
            connection.pricingConfig,
          ),
        });
        return parsed.success ? [parsed.data] : [];
      });
    const availableTargets = listAvailableSelfServeTargets(activeProviderConnections, "openai-compatible");
    const readyAssignedModels = await listReadyAssignedWorkspaceModels(
      context.db,
      params.workspaceId,
      "openai-compatible",
    );
    const availableModels = [...new Map(
      readyAssignedModels.map((model) => [
        model.modelId,
        {
          id: model.modelId,
          label: model.label,
          ownedBy: null,
        },
      ]),
    ).values()];
    const availableSources = buildAvailableSelfServeSources({
      models: readyAssignedModels,
      activeProviderConnections,
      protocol: "openai-compatible",
    });
    const activeTokens = await listActiveSelfServeVirtualKeysForMember(context.db, {
      workspaceId: params.workspaceId,
      memberId: memberResult.member.id,
    });
    const selfServeTtlHours = await loadWorkspaceDefaultVirtualKeyTtlHours(params.workspaceId);
    const validActiveTokens = activeTokens.flatMap((token) => {
      const parsed = VirtualKeySchema.safeParse(token);
      return parsed.success ? [parsed.data] : [];
    });

    return SelfServeVirtualKeyBootstrapSchema.parse({
      allowed: true,
      allowedProjects,
      availableTargets,
      providerConnections,
      availableModels,
      availableSources,
      activeTokens: validActiveTokens,
      defaults: {
        ttlHours: selfServeTtlHours,
        environmentRuntime: "development",
        projectId: allowedProjects[0]?.id ?? null,
      },
    });
  });

  app.post("/v1/workspaces/:workspaceId/self-serve-virtual-keys/issue", async (request, reply) => {
    const params = request.params as { workspaceId: string };
    const validationError = validateResourceId(reply, "workspace", params.workspaceId);
    if (validationError) {
      return validationError;
    }

    const memberResult = await requireSelfServeMember(context, request, params.workspaceId);
    if ("error" in memberResult) {
      reply.code(memberResult.statusCode);
      return memberResult;
    }

    const input = IssueSelfServeVirtualKeyInputSchema.parse(request.body);
    const assignedProjectIds = await listAssignedProjectIdsForMember(context.db, memberResult.member.id);
    if (!assignedProjectIds.includes(input.projectId)) {
      reply.code(403);
      return {
        error: {
          code: "SELF_SERVE_PROJECT_SCOPE_FORBIDDEN",
          message: "This project is outside the current assigned project scope",
        },
      };
    }

    const project = await findProjectById(context.db, input.projectId);
    if (!project || project.workspaceId !== params.workspaceId || project.status !== "active") {
      reply.code(404);
      return buildNotFoundMessage("Project", "SELF_SERVE_PROJECT_NOT_FOUND");
    }

    const availableModels = await listReadyAssignedWorkspaceModels(
      context.db,
      params.workspaceId,
      input.protocol,
    );
    const selfServeTtlHours = await loadWorkspaceDefaultVirtualKeyTtlHours(params.workspaceId);
    if (availableModels.length === 0) {
      reply.code(409);
      return {
        error: {
          code: "SELF_SERVE_PROVIDER_CONNECTION_NOT_READY",
          message:
            "This organization does not currently have any approved models ready for developer access. Publish a model in Providers before issuing a personal key.",
        },
      };
    }

    const created = await issueSelfServeVirtualKey(context.db, {
      workspaceId: params.workspaceId,
      memberId: memberResult.member.id,
      memberEmail: memberResult.member.email,
      providerConnectionId: null,
      projectId: project.id,
      label: buildSelfServeLabel(project.slug, memberResult.member.email),
      expiresAt: getSelfServeExpiryIso(selfServeTtlHours),
    });

    await appendSelfServeAudit(context, {
      workspaceId: params.workspaceId,
      projectId: project.id,
      actorId: memberResult.member.email,
      action: "virtual-key.self-serve-issued",
      subjectId: created.record.id,
      payload: {
        protocol: input.protocol,
        routeMode: "workspace-unified",
        projectId: project.id,
        keyPrefix: created.record.keyPrefix,
        expiresAt: created.record.expiresAt,
      },
    });

    reply.code(201);
    return CreatedVirtualKeyResponseSchema.parse({
      ...created.record,
      token: created.token,
    });
  });

  app.get("/v1/workspaces/:workspaceId/self-serve-virtual-keys/models", async (request, reply) => {
    const params = request.params as { workspaceId: string };
    const query = request.query as { providerConnectionId?: string };
    const validationError = validateResourceId(reply, "workspace", params.workspaceId);
    if (validationError) {
      return validationError;
    }

    const providerConnectionId = query.providerConnectionId?.trim();
    if (!providerConnectionId) {
      reply.code(400);
      return {
        error: {
          message: "providerConnectionId is required",
        },
      };
    }

    const providerConnectionValidationError = validateResourceId(
      reply,
      "provider connection",
      providerConnectionId,
    );
    if (providerConnectionValidationError) {
      return providerConnectionValidationError;
    }

    const memberResult = await requireSelfServeMember(context, request, params.workspaceId);
    if ("error" in memberResult) {
      reply.code(memberResult.statusCode);
      return memberResult;
    }

    return SelfServeModelCatalogSchema.parse({
      providerConnectionId,
      fetchedAt: new Date().toISOString(),
      items: (await listReadyAssignedWorkspaceModels(
        context.db,
        params.workspaceId,
        "openai-compatible",
      )).map((model) => ({
        id: model.modelId,
        label: model.label,
        ownedBy: null,
      })),
    });
  });

  app.post("/v1/workspaces/:workspaceId/self-serve-virtual-keys/:virtualKeyId/rotate", async (request, reply) => {
    const params = request.params as { workspaceId: string; virtualKeyId: string };
    const workspaceValidationError = validateResourceId(reply, "workspace", params.workspaceId);
    if (workspaceValidationError) {
      return workspaceValidationError;
    }
    const virtualKeyValidationError = validateResourceId(reply, "virtual key", params.virtualKeyId);
    if (virtualKeyValidationError) {
      return virtualKeyValidationError;
    }

    const memberResult = await requireSelfServeMember(context, request, params.workspaceId);
    if ("error" in memberResult) {
      reply.code(memberResult.statusCode);
      return memberResult;
    }
    const selfServeTtlHours = await loadWorkspaceDefaultVirtualKeyTtlHours(params.workspaceId);

    const created = await rotateSelfServeVirtualKey(context.db, {
      virtualKeyId: params.virtualKeyId,
      memberId: memberResult.member.id,
      expiresAt: getSelfServeExpiryIso(selfServeTtlHours),
    });

    if (!created) {
      reply.code(404);
      return buildNotFoundMessage("Self-serve virtual key");
    }

    await appendSelfServeAudit(context, {
      workspaceId: params.workspaceId,
      projectId: created.record.projectId,
      actorId: memberResult.member.email,
      action: "virtual-key.self-serve-rotated",
      subjectId: created.record.id,
      payload: {
        keyPrefix: created.record.keyPrefix,
        expiresAt: created.record.expiresAt,
      },
    });

    return CreatedVirtualKeyResponseSchema.parse({
      ...created.record,
      token: created.token,
    });
  });

  app.post("/v1/workspaces/:workspaceId/self-serve-virtual-keys/:virtualKeyId/revoke", async (request, reply) => {
    const params = request.params as { workspaceId: string; virtualKeyId: string };
    const workspaceValidationError = validateResourceId(reply, "workspace", params.workspaceId);
    if (workspaceValidationError) {
      return workspaceValidationError;
    }
    const virtualKeyValidationError = validateResourceId(reply, "virtual key", params.virtualKeyId);
    if (virtualKeyValidationError) {
      return virtualKeyValidationError;
    }

    const memberResult = await requireSelfServeMember(context, request, params.workspaceId);
    if ("error" in memberResult) {
      reply.code(memberResult.statusCode);
      return memberResult;
    }

    const revoked = await revokeSelfServeVirtualKey(context.db, {
      virtualKeyId: params.virtualKeyId,
      memberId: memberResult.member.id,
    });

    if (!revoked) {
      reply.code(404);
      return buildNotFoundMessage("Self-serve virtual key");
    }

    await appendSelfServeAudit(context, {
      workspaceId: params.workspaceId,
      projectId: revoked.projectId,
      actorId: memberResult.member.email,
      action: "virtual-key.self-serve-revoked",
      subjectId: revoked.id,
      payload: {
        keyPrefix: revoked.keyPrefix,
      },
    });

    return revoked;
  });
}
