import type { FastifyInstance, FastifyReply } from "fastify";

import {
  CreateProviderConnectionInputSchema,
  type ProviderConnection,
  type ProviderPricingConfig,
  ProviderConnectionModelCatalogSchema,
  UpdateProviderConnectionInputSchema,
  getProviderConfiguredModelCatalogItems,
  getUncoveredProviderModelIds,
} from "@teamops/contracts";
import {
  createProviderConnection,
  DatabaseValidationError,
  ProviderConnectionCredentialKeyMismatchError,
  listProviderConnections,
  ProviderConnectionCredentialDecryptionError,
  recordProviderConnectionTestResult,
  resolveProviderCredentialsByConnectionId,
  revokeProviderConnection,
  syncCatalogModelsFromProviderConnection,
  updateProviderConnection,
} from "@teamops/database";

import { appendRequestAuditLog, appendWorkspaceOnboardingMilestoneIfAbsent } from "../audit.js";
import type { ControlApiContext } from "../context.js";
import {
  listManagedProviderConnectionModels,
  normalizeManagedProviderConnectionInput,
  normalizeManagedProviderConnectionUpdate,
  testManagedProviderConnection,
} from "../provider-connections.js";
import { requireWorkspacePermission } from "../permissions.js";
import { requireProviderConnection, requireWorkspace, validateResourceId } from "../resource-guards.js";

function replyWithValidationError(reply: FastifyReply, error: unknown) {
  if (!(error instanceof DatabaseValidationError)) {
    throw error;
  }

  reply.code(error.statusCode);
  return {
    error: {
      message: error.message,
    },
  };
}

function getProviderReadinessValidationError(args: {
  provider: ProviderConnection["provider"];
  metadata: Record<string, string>;
  pricingConfig: ProviderPricingConfig | null | undefined;
}) {
  const configuredModels = getProviderConfiguredModelCatalogItems(
    args.metadata,
    args.pricingConfig,
  );
  if (configuredModels.length === 0) {
    return null;
  }

  const uncoveredModels = getUncoveredProviderModelIds({
    provider: args.provider,
    modelIds: configuredModels.map((item) => item.id),
    pricingConfig: args.pricingConfig,
    metadata: args.metadata,
  });
  if (uncoveredModels.length === 0) {
    return null;
  }

  return {
    error: {
      message: `Selected models are missing pricing coverage: ${uncoveredModels.join(", ")}`,
    },
  };
}

export async function registerProviderRoutes(app: FastifyInstance, context: ControlApiContext) {
  function toModelCatalogResponse(
    result:
      | {
          ok: true;
          providerConnectionId: string | null;
          fetchedAt: string;
          items: Array<{ id: string; label: string; ownedBy: string | null }>;
        }
      | {
          ok: false;
          providerConnectionId: string | null;
          fetchedAt: string;
          statusCode: number | null;
          message: string;
        },
  ) {
    if (result.ok) {
      return ProviderConnectionModelCatalogSchema.parse({
        providerConnectionId: result.providerConnectionId,
        fetchedAt: result.fetchedAt,
        status: result.items.length > 0 ? "ready" : "empty",
        errorCode: null,
        message: result.items.length > 0 ? null : "The upstream provider returned no models.",
        items: result.items,
      });
    }

    return ProviderConnectionModelCatalogSchema.parse({
      providerConnectionId: result.providerConnectionId,
      fetchedAt: result.fetchedAt,
      status: "error",
      errorCode: null,
      message: result.message,
      items: [],
    });
  }

  async function resolveSharedProviderWorkspaceContext(
    reply: FastifyReply,
    providerConnectionId: string,
    requestedWorkspaceId?: string,
  ) {
    const providerConnection = await requireProviderConnection(context.db, reply, providerConnectionId);
    if ("error" in providerConnection) {
      return providerConnection;
    }

    const workspaceId = requestedWorkspaceId?.trim() || providerConnection.workspaceId;
    if (!providerConnection.organizationId) {
      if (workspaceId === providerConnection.workspaceId) {
        return {
          providerConnection,
          workspace: {
            id: providerConnection.workspaceId,
          },
        };
      }

      const [providerWorkspace, workspace] = await Promise.all([
        requireWorkspace(context.db, reply, providerConnection.workspaceId),
        requireWorkspace(context.db, reply, workspaceId),
      ]);
      if ("error" in providerWorkspace) {
        return providerWorkspace;
      }
      if ("error" in workspace) {
        return workspace;
      }

      if (providerWorkspace.organizationId !== workspace.organizationId) {
        reply.code(400);
        return {
          error: {
            message: "Provider connection does not belong to the requested organization",
          },
        };
      }

      return {
        providerConnection,
        workspace,
      };
    }

    const workspace = await requireWorkspace(context.db, reply, workspaceId);
    if ("error" in workspace) {
      return workspace;
    }

    if (workspace.organizationId !== providerConnection.organizationId) {
      reply.code(400);
      return {
        error: {
          message: "Provider connection does not belong to the requested organization",
        },
      };
    }

    return {
      providerConnection,
      workspace,
    };
  }

  app.get("/v1/provider-connections", async (request, reply) => {
    const query = request.query as { workspaceId?: string };
    if (!query.workspaceId) {
      return { items: [] };
    }

    const validationError = validateResourceId(reply, "workspace", query.workspaceId);
    if (validationError) {
      return validationError;
    }

    const permissionError = await requireWorkspacePermission(context, request, reply, "provider.read", query.workspaceId);
    if (permissionError) {
      return permissionError;
    }

    return {
      items: await listProviderConnections(context.db, query.workspaceId),
    };
  });

  app.post("/v1/provider-connections", async (request, reply) => {
    const parsedInput = CreateProviderConnectionInputSchema.parse(request.body);
    const input = (() => {
      try {
        return normalizeManagedProviderConnectionInput(parsedInput);
      } catch (error) {
        return replyWithValidationError(reply, error);
      }
    })();

    if ("error" in input) {
      return input;
    }

    const permissionError = await requireWorkspacePermission(context, request, reply, "provider.write", input.workspaceId);
    if (permissionError) {
      return permissionError;
    }

    const readinessValidationError = getProviderReadinessValidationError({
      provider: input.provider,
      metadata: input.metadata,
      pricingConfig: input.pricingConfig,
    });
    if (readinessValidationError) {
      reply.code(400);
      return readinessValidationError;
    }

    let connection;
    try {
      connection = await createProviderConnection(context.db, input, context.env.ENCRYPTION_KEY_BASE64);
      await syncCatalogModelsFromProviderConnection(context.db, connection);
    } catch (error) {
      return replyWithValidationError(reply, error);
    }

    await appendRequestAuditLog(context.db, request, {
      workspaceId: connection.workspaceId,
      action: "provider-connection.created",
      subjectType: "provider-connection",
      subjectId: connection.id,
      payload: {
        provider: connection.provider,
        label: connection.label,
      },
    });

    await appendWorkspaceOnboardingMilestoneIfAbsent(context.db, request, {
      workspaceId: connection.workspaceId,
      action: "workspace.onboarding.first_provider_connected",
      payload: {
        providerConnectionId: connection.id,
        provider: connection.provider,
        label: connection.label,
      },
    });

    reply.code(201);
    return connection;
  });

  app.post("/v1/provider-connections/test", async (request, reply) => {
    const parsedInput = CreateProviderConnectionInputSchema.parse(request.body);
    const input = (() => {
      try {
        return normalizeManagedProviderConnectionInput(parsedInput);
      } catch (error) {
        return replyWithValidationError(reply, error);
      }
    })();

    if ("error" in input) {
      return input;
    }

    const permissionError = await requireWorkspacePermission(context, request, reply, "provider.write", input.workspaceId);
    if (permissionError) {
      return permissionError;
    }

    const result = await testManagedProviderConnection({
      connection: {
        id: null,
        provider: input.provider,
      },
      apiKey: input.apiKey,
      metadata: input.metadata,
    });

    await appendRequestAuditLog(context.db, request, {
      workspaceId: input.workspaceId,
      action: "provider-connection.draft-tested",
      subjectType: "provider-connection-draft",
      subjectId: `${input.workspaceId}:${input.provider}`,
      payload: {
        label: input.label,
        provider: input.provider,
        ok: result.ok,
        statusCode: result.statusCode,
        latencyMs: result.latencyMs,
      },
    });

    return result;
  });

  app.post("/v1/provider-connections/models/preview", async (request, reply) => {
    const parsedInput = CreateProviderConnectionInputSchema.parse(request.body);
    const input = (() => {
      try {
        return normalizeManagedProviderConnectionInput(parsedInput);
      } catch (error) {
        return replyWithValidationError(reply, error);
      }
    })();

    if ("error" in input) {
      return input;
    }

    const permissionError = await requireWorkspacePermission(context, request, reply, "provider.write", input.workspaceId);
    if (permissionError) {
      return permissionError;
    }

    const result = await listManagedProviderConnectionModels({
      connection: {
        id: null,
        provider: input.provider,
      },
      apiKey: input.apiKey,
      metadata: input.metadata,
    });

    await appendRequestAuditLog(context.db, request, {
      workspaceId: input.workspaceId,
      action: "provider-connection.model-catalog-previewed",
      subjectType: "provider-connection-draft",
      subjectId: `${input.workspaceId}:${input.provider}`,
      payload: {
        label: input.label,
        provider: input.provider,
        status: result.ok ? (result.items.length > 0 ? "ready" : "empty") : "error",
        itemCount: result.ok ? result.items.length : 0,
      },
    });

    return toModelCatalogResponse(result);
  });

  app.post("/v1/provider-connections/:providerConnectionId/test", async (request, reply) => {
    const params = request.params as { providerConnectionId: string };
    const query = request.query as { workspaceId?: string };
    const resolvedContext = await resolveSharedProviderWorkspaceContext(
      reply,
      params.providerConnectionId,
      query.workspaceId,
    );
    if ("error" in resolvedContext) {
      return resolvedContext;
    }

    const permissionError = await requireWorkspacePermission(
      context,
      request,
      reply,
      "provider.write",
      resolvedContext.workspace.id,
    );
    if (permissionError) {
      return permissionError;
    }

    const { providerConnection, workspace } = resolvedContext;

    if (providerConnection.status !== "active") {
      reply.code(409);
      return {
        error: {
          message: "Only active provider connections can be tested",
        },
      };
    }

    let resolvedProvider;
    try {
      resolvedProvider = await resolveProviderCredentialsByConnectionId(
        context.db,
        providerConnection.id,
        context.env.ENCRYPTION_KEY_BASE64,
      );
    } catch (error) {
      if (error instanceof ProviderConnectionCredentialKeyMismatchError) {
        reply.code(424);
        return {
          error: {
            code: "PROVIDER_CONNECTION_CREDENTIAL_KEY_MISMATCH",
            message:
              "The stored upstream API key for this provider connection was encrypted with a different runtime key. Re-enter the provider credential, then run the test again.",
          },
        };
      }

      if (error instanceof ProviderConnectionCredentialDecryptionError) {
        reply.code(424);
        return {
          error: {
            code: "PROVIDER_CONNECTION_CREDENTIAL_UNREADABLE",
            message:
              "The stored upstream API key for this provider connection could not be read. Re-enter the provider credential, then run the test again.",
          },
        };
      }

      throw error;
    }
    if (!resolvedProvider) {
      reply.code(404);
      return {
        error: {
          message: "Provider connection not found",
        },
      };
    }

    const result = await testManagedProviderConnection({
      connection: resolvedProvider.connection,
      apiKey: resolvedProvider.apiKey,
      metadata: resolvedProvider.metadata,
    });

    await recordProviderConnectionTestResult(context.db, providerConnection.id, {
      testedAt: result.testedAt,
      status: result.ok ? "passed" : "failed",
      error: result.ok ? null : result.message,
      statusCode: result.statusCode,
      latencyMs: result.latencyMs,
    });

    await appendRequestAuditLog(context.db, request, {
      workspaceId: workspace.id,
      action: "provider-connection.tested",
      subjectType: "provider-connection",
      subjectId: providerConnection.id,
      payload: {
        label: providerConnection.label,
        provider: providerConnection.provider,
        ok: result.ok,
        statusCode: result.statusCode,
        latencyMs: result.latencyMs,
      },
    });

    await appendWorkspaceOnboardingMilestoneIfAbsent(context.db, request, {
      workspaceId: workspace.id,
      action: "workspace.onboarding.first_provider_tested",
      payload: {
        providerConnectionId: providerConnection.id,
        provider: providerConnection.provider,
        label: providerConnection.label,
        ok: result.ok,
        statusCode: result.statusCode,
        latencyMs: result.latencyMs,
      },
    });

    return result;
  });

  app.get("/v1/provider-connections/:providerConnectionId/models", async (request, reply) => {
    const params = request.params as { providerConnectionId: string };
    const query = request.query as { workspaceId?: string };
    const resolvedContext = await resolveSharedProviderWorkspaceContext(
      reply,
      params.providerConnectionId,
      query.workspaceId,
    );
    if ("error" in resolvedContext) {
      return resolvedContext;
    }

    const permissionError = await requireWorkspacePermission(
      context,
      request,
      reply,
      "provider.write",
      resolvedContext.workspace.id,
    );
    if (permissionError) {
      return permissionError;
    }

    const { providerConnection, workspace } = resolvedContext;
    if (providerConnection.status !== "active") {
      reply.code(409);
      return {
        error: {
          message: "Only active provider connections can load a model catalog",
        },
      };
    }

    let resolvedProvider;
    try {
      resolvedProvider = await resolveProviderCredentialsByConnectionId(
        context.db,
        providerConnection.id,
        context.env.ENCRYPTION_KEY_BASE64,
      );
    } catch (error) {
      if (error instanceof ProviderConnectionCredentialKeyMismatchError) {
        return ProviderConnectionModelCatalogSchema.parse({
          providerConnectionId: providerConnection.id,
          fetchedAt: new Date().toISOString(),
          status: "error",
          errorCode: "credential_key_mismatch",
          message:
            "The stored upstream API key for this provider connection was encrypted with a different runtime key. Re-enter the provider credential, then refresh the catalog.",
          items: [],
        });
      }

      if (error instanceof ProviderConnectionCredentialDecryptionError) {
        return ProviderConnectionModelCatalogSchema.parse({
          providerConnectionId: providerConnection.id,
          fetchedAt: new Date().toISOString(),
          status: "error",
          errorCode: "credential_unreadable",
          message:
            "The stored upstream API key for this provider connection could not be read. Re-enter the provider credential, then refresh the catalog.",
          items: [],
        });
      }

      throw error;
    }

    if (!resolvedProvider) {
      reply.code(404);
      return {
        error: {
          message: "Provider connection not found",
        },
      };
    }

    const result = await listManagedProviderConnectionModels({
      connection: resolvedProvider.connection,
      apiKey: resolvedProvider.apiKey,
      metadata: resolvedProvider.metadata,
    });

    await appendRequestAuditLog(context.db, request, {
      workspaceId: workspace.id,
      action: "provider-connection.model-catalog-read",
      subjectType: "provider-connection",
      subjectId: providerConnection.id,
      payload: {
        label: providerConnection.label,
        provider: providerConnection.provider,
        status: result.ok ? (result.items.length > 0 ? "ready" : "empty") : "error",
        itemCount: result.ok ? result.items.length : 0,
      },
    });

    return toModelCatalogResponse(result);
  });

  app.post("/v1/provider-connections/:providerConnectionId/revoke", async (request, reply) => {
    const params = request.params as { providerConnectionId: string };
    const query = request.query as { workspaceId?: string };
    const resolvedContext = await resolveSharedProviderWorkspaceContext(
      reply,
      params.providerConnectionId,
      query.workspaceId,
    );
    if ("error" in resolvedContext) {
      return resolvedContext;
    }

    const permissionError = await requireWorkspacePermission(
      context,
      request,
      reply,
      "provider.write",
      resolvedContext.workspace.id,
    );
    if (permissionError) {
      return permissionError;
    }

    const { providerConnection, workspace } = resolvedContext;

    if (providerConnection.status === "revoked") {
      reply.code(409);
      return {
        error: {
          message: "Provider connection is already revoked",
        },
      };
    }

    const revokedConnection = await revokeProviderConnection(context.db, providerConnection.id);
    if (!revokedConnection) {
      reply.code(404);
      return {
        error: {
          message: "Provider connection not found",
        },
      };
    }

    await appendRequestAuditLog(context.db, request, {
      workspaceId: workspace.id,
      action: "provider-connection.revoked",
      subjectType: "provider-connection",
      subjectId: revokedConnection.id,
      payload: {
        label: revokedConnection.label,
        provider: revokedConnection.provider,
        previousStatus: providerConnection.status,
        nextStatus: revokedConnection.status,
      },
    });

    return revokedConnection;
  });

  app.patch("/v1/provider-connections/:providerConnectionId", async (request, reply) => {
    const params = request.params as { providerConnectionId: string };
    const query = request.query as { workspaceId?: string };
    const resolvedContext = await resolveSharedProviderWorkspaceContext(
      reply,
      params.providerConnectionId,
      query.workspaceId,
    );
    if ("error" in resolvedContext) {
      return resolvedContext;
    }

    const permissionError = await requireWorkspacePermission(
      context,
      request,
      reply,
      "provider.write",
      resolvedContext.workspace.id,
    );
    if (permissionError) {
      return permissionError;
    }

    const { providerConnection, workspace } = resolvedContext;
    const parsedInput = UpdateProviderConnectionInputSchema.parse(request.body);
    const input = (() => {
      try {
        return normalizeManagedProviderConnectionUpdate(providerConnection.provider, parsedInput);
      } catch (error) {
        return replyWithValidationError(reply, error);
      }
    })();

    if ("error" in input) {
      return input;
    }

    if (input.metadata === undefined && providerConnection.provider === "openai-compatible" && !providerConnection.baseUrl) {
      reply.code(400);
      return {
        error: {
          message: "OpenAI-compatible provider connections require a base URL",
        },
      };
    }

    const readinessValidationError = getProviderReadinessValidationError({
      provider: providerConnection.provider,
      metadata: input.metadata ?? providerConnection.metadata,
      pricingConfig:
        input.pricingConfig !== undefined ? input.pricingConfig : providerConnection.pricingConfig,
    });
    if (readinessValidationError) {
      reply.code(400);
      return readinessValidationError;
    }

    let updatedConnection;
    try {
      updatedConnection = await updateProviderConnection(
        context.db,
        providerConnection.id,
        input,
        context.env.ENCRYPTION_KEY_BASE64,
      );
      if (updatedConnection) {
        await syncCatalogModelsFromProviderConnection(context.db, updatedConnection);
      }
    } catch (error) {
      return replyWithValidationError(reply, error);
    }

    if (!updatedConnection) {
      reply.code(404);
      return {
        error: {
          message: "Provider connection not found",
        },
      };
    }

    await appendRequestAuditLog(context.db, request, {
      workspaceId: workspace.id,
      action: input.apiKey !== undefined ? "provider-connection.rotated" : "provider-connection.updated",
      subjectType: "provider-connection",
      subjectId: updatedConnection.id,
      payload: {
        label: updatedConnection.label,
        provider: updatedConnection.provider,
        rotatedApiKey: input.apiKey !== undefined,
        updatedMetadataKeys: input.metadata ? Object.keys(input.metadata).sort() : [],
      },
    });

    return updatedConnection;
  });
}
