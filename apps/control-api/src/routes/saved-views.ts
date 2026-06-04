import type { FastifyInstance } from "fastify";

import {
  CreateSavedViewInputSchema,
  SavedViewListQuerySchema,
  UpdateSavedViewInputSchema,
  type SavedViewSurface,
  type WorkspacePermission,
} from "@teamops/contracts";
import {
  createSavedView,
  deleteSavedView,
  getSavedViewById,
  listSavedViews,
  markSavedViewOpened,
  updateSavedView,
} from "@teamops/database";

import { appendRequestAuditLog } from "../audit.js";
import type { ControlApiContext } from "../context.js";
import { getWorkspaceAccess } from "../permissions.js";
import { validateResourceId } from "../resource-guards.js";

const savedViewSurfacePermissionMap: Record<SavedViewSurface, WorkspacePermission> = {
  "usage-events": "usage.read",
  "audit-logs": "audit_log.read",
  "prompt-inspections": "prompt_inspection.read",
};

function getSavedViewPermission(surface: SavedViewSurface) {
  return savedViewSurfacePermissionMap[surface];
}

function isDuplicateSavedViewNameError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "string" &&
    (error as { code: string }).code === "23505"
  );
}

export async function registerSavedViewRoutes(app: FastifyInstance, context: ControlApiContext) {
  app.get("/v1/saved-views", async (request, reply) => {
    const query = SavedViewListQuerySchema.parse(request.query);
    const access = await getWorkspaceAccess(
      context,
      request,
      reply,
      getSavedViewPermission(query.surface),
      query.workspaceId,
    );
    if ("error" in access) {
      return access;
    }

    return {
      items: await listSavedViews(context.db, query),
    };
  });

  app.post("/v1/saved-views", async (request, reply) => {
    const input = CreateSavedViewInputSchema.parse(request.body);
    const access = await getWorkspaceAccess(
      context,
      request,
      reply,
      getSavedViewPermission(input.surface),
      input.workspaceId,
    );
    if ("error" in access) {
      return access;
    }

    try {
      const savedView = await createSavedView(context.db, input);

      await appendRequestAuditLog(context.db, request, {
        workspaceId: savedView.workspaceId,
        action: "saved_view.created",
        subjectType: "saved-view",
        subjectId: savedView.id,
        payload: {
          surface: savedView.surface,
          name: savedView.name,
        },
      });

      reply.code(201);
      return savedView;
    } catch (error) {
      if (isDuplicateSavedViewNameError(error)) {
        reply.code(409);
        return {
          error: {
            message: "A saved view with this name already exists for this workspace surface",
          },
        };
      }

      throw error;
    }
  });

  app.delete("/v1/saved-views/:savedViewId", async (request, reply) => {
    const params = request.params as { savedViewId: string };
    const validationError = validateResourceId(reply, "saved view", params.savedViewId);
    if (validationError) {
      return validationError;
    }

    const savedView = await getSavedViewById(context.db, params.savedViewId);
    if (!savedView) {
      reply.code(404);
      return {
        error: {
          message: "Saved view not found",
        },
      };
    }

    const access = await getWorkspaceAccess(
      context,
      request,
      reply,
      getSavedViewPermission(savedView.surface),
      savedView.workspaceId,
    );
    if ("error" in access) {
      return access;
    }

    const deletedSavedView = await deleteSavedView(context.db, savedView.id);
    if (!deletedSavedView) {
      reply.code(404);
      return {
        error: {
          message: "Saved view not found",
        },
      };
    }

    await appendRequestAuditLog(context.db, request, {
      workspaceId: deletedSavedView.workspaceId,
      action: "saved_view.deleted",
      subjectType: "saved-view",
      subjectId: deletedSavedView.id,
      payload: {
        surface: deletedSavedView.surface,
        name: deletedSavedView.name,
      },
    });

    reply.code(204);
    return null;
  });

  app.patch("/v1/saved-views/:savedViewId", async (request, reply) => {
    const params = request.params as { savedViewId: string };
    const validationError = validateResourceId(reply, "saved view", params.savedViewId);
    if (validationError) {
      return validationError;
    }

    const input = UpdateSavedViewInputSchema.parse(request.body);
    const savedView = await getSavedViewById(context.db, params.savedViewId);
    if (!savedView) {
      reply.code(404);
      return {
        error: {
          message: "Saved view not found",
        },
      };
    }

    const access = await getWorkspaceAccess(
      context,
      request,
      reply,
      getSavedViewPermission(savedView.surface),
      savedView.workspaceId,
    );
    if ("error" in access) {
      return access;
    }

    try {
      const updatedSavedView = await updateSavedView(context.db, savedView.id, input);
      if (!updatedSavedView) {
        reply.code(404);
        return {
          error: {
            message: "Saved view not found",
          },
        };
      }

      await appendRequestAuditLog(context.db, request, {
        workspaceId: updatedSavedView.workspaceId,
        action: "saved_view.updated",
        subjectType: "saved-view",
        subjectId: updatedSavedView.id,
        payload: {
          previousName: savedView.name,
          nextName: updatedSavedView.name,
          filtersUpdated: input.filters !== undefined,
          surface: updatedSavedView.surface,
        },
      });

      return updatedSavedView;
    } catch (error) {
      if (isDuplicateSavedViewNameError(error)) {
        reply.code(409);
        return {
          error: {
            message: "A saved view with this name already exists for this workspace surface",
          },
        };
      }

      throw error;
    }
  });

  app.post("/v1/saved-views/:savedViewId/open", async (request, reply) => {
    const params = request.params as { savedViewId: string };
    const validationError = validateResourceId(reply, "saved view", params.savedViewId);
    if (validationError) {
      return validationError;
    }

    const savedView = await getSavedViewById(context.db, params.savedViewId);
    if (!savedView) {
      reply.code(404);
      return {
        error: {
          message: "Saved view not found",
        },
      };
    }

    const access = await getWorkspaceAccess(
      context,
      request,
      reply,
      getSavedViewPermission(savedView.surface),
      savedView.workspaceId,
    );
    if ("error" in access) {
      return access;
    }

    const openedSavedView = await markSavedViewOpened(context.db, savedView.id);
    if (!openedSavedView) {
      reply.code(404);
      return {
        error: {
          message: "Saved view not found",
        },
      };
    }

    return openedSavedView;
  });
}
