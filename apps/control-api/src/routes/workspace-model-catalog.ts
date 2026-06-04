import type { FastifyInstance } from "fastify";

import {
  SyncWorkspaceModelAssignmentsInputSchema,
  UpsertCatalogModelInputSchema,
  WorkspaceModelCatalogResponseSchema,
} from "@teamops/contracts";
import {
  findProviderConnectionById,
  listCatalogModelsForOrganization,
  syncWorkspaceModelAssignments,
  upsertCatalogModel,
} from "@teamops/database";

import type { ControlApiContext } from "../context.js";
import { requireWorkspacePermission } from "../permissions.js";
import { requireWorkspace, validateResourceId } from "../resource-guards.js";
import { listWorkspaceModelCatalogAvailability } from "../workspace-model-catalog.js";

export async function registerWorkspaceModelCatalogRoutes(
  app: FastifyInstance,
  context: ControlApiContext,
) {
  function groupModelsBySource(
    models: Awaited<ReturnType<typeof listWorkspaceModelCatalogAvailability>>,
  ) {
    return Object.values(
      models.reduce<Record<string, {
        providerConnectionId: string;
        label: string;
        provider: typeof models[number]["sourceProvider"];
        protocol: typeof models[number]["protocol"];
        models: typeof models;
      }>>((groups, model) => {
        const key = model.sourceProviderConnectionId;
        const existing = groups[key];
        if (existing) {
          existing.models.push(model);
          return groups;
        }

        groups[key] = {
          providerConnectionId: model.sourceProviderConnectionId,
          label: model.sourceProviderConnectionLabel,
          provider: model.sourceProvider,
          protocol: model.protocol,
          models: [model],
        };
        return groups;
      }, {}),
    );
  }

  app.get("/v1/workspaces/:workspaceId/model-catalog", async (request, reply) => {
    const params = request.params as { workspaceId: string };
    const validationError = validateResourceId(reply, "workspace", params.workspaceId);
    if (validationError) {
      return validationError;
    }

    const permissionError = await requireWorkspacePermission(
      context,
      request,
      reply,
      "provider.write",
      params.workspaceId,
    );
    if (permissionError) {
      return permissionError;
    }

    const workspace = await requireWorkspace(context.db, reply, params.workspaceId);
    if ("error" in workspace) {
      return workspace;
    }

    const models = await listWorkspaceModelCatalogAvailability(context.db, params.workspaceId);
    return WorkspaceModelCatalogResponseSchema.parse({
      workspaceId: workspace.id,
      organizationId: workspace.organizationId,
      models,
      groupedBySource: groupModelsBySource(models),
    });
  });

  app.post("/v1/workspaces/:workspaceId/model-catalog/models", async (request, reply) => {
    const params = request.params as { workspaceId: string };
    const validationError = validateResourceId(reply, "workspace", params.workspaceId);
    if (validationError) {
      return validationError;
    }

    const permissionError = await requireWorkspacePermission(
      context,
      request,
      reply,
      "provider.write",
      params.workspaceId,
    );
    if (permissionError) {
      return permissionError;
    }

    const workspace = await requireWorkspace(context.db, reply, params.workspaceId);
    if ("error" in workspace) {
      return workspace;
    }

    const input = UpsertCatalogModelInputSchema.parse(request.body);
    const sourceProviderConnection = await findProviderConnectionById(
      context.db,
      input.sourceProviderConnectionId,
    );
    if (
      !sourceProviderConnection ||
      sourceProviderConnection.organizationId !== workspace.organizationId
    ) {
      reply.code(400);
      return {
        error: {
          message: "The selected source provider connection is not available in this organization",
        },
      };
    }

    const model = await upsertCatalogModel(context.db, workspace.organizationId, {
      ...input,
      protocol:
        sourceProviderConnection.provider === "anthropic"
          ? "anthropic"
          : "openai-compatible",
      sourceProviderConnectionLabel: sourceProviderConnection.label,
      sourceProvider: sourceProviderConnection.provider,
    });
    reply.code(201);
    return model;
  });

  app.post("/v1/workspaces/:workspaceId/model-catalog/assignments", async (request, reply) => {
    const params = request.params as { workspaceId: string };
    const validationError = validateResourceId(reply, "workspace", params.workspaceId);
    if (validationError) {
      return validationError;
    }

    const permissionError = await requireWorkspacePermission(
      context,
      request,
      reply,
      "provider.write",
      params.workspaceId,
    );
    if (permissionError) {
      return permissionError;
    }

    const workspace = await requireWorkspace(context.db, reply, params.workspaceId);
    if ("error" in workspace) {
      return workspace;
    }

    const input = SyncWorkspaceModelAssignmentsInputSchema.parse(request.body);
    const catalogModels = await listCatalogModelsForOrganization(context.db, workspace.organizationId);
    const allowedCatalogModelIds = new Set(catalogModels.map((model) => model.id));
    const invalidModelId = input.modelIds.find((modelId) => !allowedCatalogModelIds.has(modelId));
    if (invalidModelId) {
      reply.code(400);
      return {
        error: {
          message: `Catalog model ${invalidModelId} does not belong to this workspace organization`,
        },
      };
    }

    await syncWorkspaceModelAssignments(context.db, workspace.id, input);
    const models = await listWorkspaceModelCatalogAvailability(context.db, workspace.id);
    return WorkspaceModelCatalogResponseSchema.parse({
      workspaceId: workspace.id,
      organizationId: workspace.organizationId,
      models,
      groupedBySource: groupModelsBySource(models),
    });
  });
}
