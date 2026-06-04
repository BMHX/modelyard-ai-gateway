import { randomUUID } from "node:crypto";

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import {
  PromptBatchReviewInputSchema,
  PromptInspectionQuerySchema,
  PromptInspectionSummaryQuerySchema,
  PromptReviewInputSchema,
} from "@teamops/contracts";
import {
  batchUpdatePromptInspectionReview,
  getPromptInspectionById,
  getPromptInspectionSummary,
  listPromptInspections,
  listPromptInspectionsByIds,
  listPromptInspectionsForExport,
  updatePromptInspectionReview,
} from "@teamops/database";

import { appendRequestAuditLog, getAuditActor } from "../audit.js";
import type { ControlApiContext } from "../context.js";
import { getAssignedProjectIdSet } from "../project-scope.js";
import { getWorkspaceAccess, hasAdminAccess } from "../permissions.js";
import { requireEnvironment, validateResourceId } from "../resource-guards.js";

function sanitizeCsvCell(value: unknown) {
  const text =
    value === null || value === undefined
      ? ""
      : Array.isArray(value) || typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  const guarded = /^[=+\-@]/.test(text) ? `'${text}` : text;
  const escaped = guarded.replace(/"/g, '""');
  return /[",\r\n]/.test(escaped) ? `"${escaped}"` : escaped;
}

function toPromptInspectionCsv(
  rows: Awaited<ReturnType<typeof listPromptInspectionsForExport>>,
) {
  const headers = [
    "workspace_id",
    "project_id",
    "environment_id",
    "virtual_key_id",
    "provider_connection_id",
    "usage_event_id",
    "request_id",
    "provider",
    "model",
    "verdict",
    "score",
    "top_activity_label",
    "risk_categories",
    "hit_rule_ids",
    "redacted_evidence",
    "simhash",
    "truncated",
    "context_counts",
    "review_status",
    "reviewed_by",
    "review_note",
    "reviewed_at",
    "created_at",
  ];

  const lines = [
    headers.join(","),
    ...rows.map((row) =>
      [
        row.workspaceId,
        row.projectId,
        row.environmentId,
        row.virtualKeyId,
        row.providerConnectionId,
        row.usageEventId,
        row.requestId,
        row.provider,
        row.model,
        row.verdict,
        row.score,
        row.topActivityLabel,
        row.riskCategories,
        row.hitRuleIds,
        row.redactedEvidence,
        row.simhash,
        row.truncated,
        row.contextCounts,
        row.reviewStatus,
        row.reviewedBy,
        row.reviewNote,
        row.reviewedAt,
        row.createdAt,
      ]
        .map((value) => sanitizeCsvCell(value))
        .join(","),
    ),
  ];

  return `\uFEFF${lines.join("\r\n")}`;
}

async function resolvePromptInspectionScope(
  context: ControlApiContext,
  request: FastifyRequest,
  reply: FastifyReply,
  workspaceId: string,
  projectId?: string | null,
  environmentId?: string | null,
) {
  const access = await getWorkspaceAccess(
    context,
    request,
    reply,
    "prompt_inspection.read",
    workspaceId,
  );
  if ("error" in access) {
    return access;
  }

  const assignedProjectIdSet = await getAssignedProjectIdSet(context, access);
  if (assignedProjectIdSet) {
    if (projectId && !assignedProjectIdSet.has(projectId)) {
      reply.code(403);
      return {
        error: {
          message: "This project is outside the current assigned project scope",
        },
      };
    }

    if (environmentId) {
      const environment = await requireEnvironment(
        context.db,
        reply,
        environmentId,
      );
      if ("error" in environment) {
        return environment;
      }

      if (!assignedProjectIdSet.has(environment.projectId)) {
        reply.code(403);
        return {
          error: {
            message: "This environment is outside the current assigned project scope",
          },
        };
      }
    }
  }

  return {
    access,
    assignedProjectIds: assignedProjectIdSet ? [...assignedProjectIdSet] : null,
  };
}

export async function registerPromptInspectionRoutes(
  app: FastifyInstance,
  context: ControlApiContext,
) {
  app.get("/v1/prompt-inspections", async (request, reply) => {
    const query = PromptInspectionQuerySchema.parse(request.query);
    if (!query.workspaceId) {
      if (!hasAdminAccess(context, request)) {
        reply.code(400);
        return {
          error: {
            message: "workspaceId is required for member-scoped prompt inspection queries",
          },
        };
      }

      return listPromptInspections(context.db, query);
    }

    const scoped = await resolvePromptInspectionScope(
      context,
      request,
      reply,
      query.workspaceId,
      query.projectId,
      query.environmentId,
    );
    if ("error" in scoped) {
      return scoped;
    }

    if (
      scoped.assignedProjectIds &&
      !query.projectId &&
      !query.environmentId
    ) {
      if (!scoped.assignedProjectIds.length) {
        return { items: [], total: 0 };
      }

      return listPromptInspections(context.db, {
        ...query,
        projectIds: scoped.assignedProjectIds,
      });
    }

    return listPromptInspections(context.db, query);
  });

  app.get("/v1/prompt-inspections/summary", async (request, reply) => {
    const query = PromptInspectionSummaryQuerySchema.parse(request.query);
    if (!query.workspaceId) {
      if (!hasAdminAccess(context, request)) {
        reply.code(400);
        return {
          error: {
            message: "workspaceId is required for member-scoped prompt inspection summary queries",
          },
        };
      }

      return getPromptInspectionSummary(context.db, query);
    }

    const scoped = await resolvePromptInspectionScope(
      context,
      request,
      reply,
      query.workspaceId,
      query.projectId,
      query.environmentId,
    );
    if ("error" in scoped) {
      return scoped;
    }

    if (
      scoped.assignedProjectIds &&
      !query.projectId &&
      !query.environmentId
    ) {
      if (!scoped.assignedProjectIds.length) {
        return {
          total: 0,
          escalatedCount: 0,
          verdictBreakdown: [],
          reviewStatusBreakdown: [],
          riskCategoryBreakdown: [],
          activityBreakdown: [],
        };
      }

      return getPromptInspectionSummary(context.db, {
        ...query,
        projectIds: scoped.assignedProjectIds,
      });
    }

    return getPromptInspectionSummary(context.db, query);
  });

  app.get("/v1/prompt-inspections/export", async (request, reply) => {
    const query = PromptInspectionSummaryQuerySchema.parse(request.query);
    if (!query.workspaceId) {
      reply.code(400);
      return {
        error: {
          message: "workspaceId is required for prompt inspection exports",
        },
      };
    }

    const access = await getWorkspaceAccess(
      context,
      request,
      reply,
      "prompt_inspection.read",
      query.workspaceId,
    );
    if ("error" in access) {
      return access;
    }

    const assignedProjectIdSet = await getAssignedProjectIdSet(context, access);
    if (assignedProjectIdSet) {
      if (query.projectId && !assignedProjectIdSet.has(query.projectId)) {
        reply.code(403);
        return {
          error: {
            message: "This project is outside the current assigned project scope",
          },
        };
      }

      if (query.environmentId) {
        const environment = await requireEnvironment(
          context.db,
          reply,
          query.environmentId,
        );
        if ("error" in environment) {
          return environment;
        }

        if (!assignedProjectIdSet.has(environment.projectId)) {
          reply.code(403);
          return {
            error: {
              message: "This environment is outside the current assigned project scope",
            },
          };
        }
      }
    }

    const rows = await listPromptInspectionsForExport(context.db, {
      ...query,
      ...(!query.projectId &&
      !query.environmentId &&
      assignedProjectIdSet
        ? { projectIds: [...assignedProjectIdSet] }
        : {}),
    });

    await appendRequestAuditLog(context.db, request, {
      workspaceId: query.workspaceId,
      projectId: query.projectId ?? null,
      environmentId: query.environmentId ?? null,
      action: "prompt_inspection.exported",
      subjectType: "workspace",
      subjectId: query.workspaceId,
      payload: {
        rowCount: rows.length,
        filters: query,
        format: "csv",
      },
    });

    reply.header("content-type", "text/csv; charset=utf-8");
    reply.header(
      "content-disposition",
      'attachment; filename="prompt-inspections.csv"',
    );
    return reply.send(toPromptInspectionCsv(rows));
  });

  app.get("/v1/prompt-inspections/:promptInspectionId", async (request, reply) => {
    const params = request.params as { promptInspectionId: string };
    const validationError = validateResourceId(
      reply,
      "prompt inspection",
      params.promptInspectionId,
    );
    if (validationError) {
      return validationError;
    }

    const inspection = await getPromptInspectionById(
      context.db,
      params.promptInspectionId,
    );
    if (!inspection) {
      reply.code(404);
      return {
        error: {
          message: "Prompt inspection not found",
        },
      };
    }

    const access = await getWorkspaceAccess(
      context,
      request,
      reply,
      "prompt_inspection.read",
      inspection.workspaceId,
    );
    if ("error" in access) {
      return access;
    }

    const assignedProjectIdSet = await getAssignedProjectIdSet(context, access);
    if (assignedProjectIdSet) {
      if (!inspection.projectId || !assignedProjectIdSet.has(inspection.projectId)) {
        reply.code(403);
        return {
          error: {
            message: "This prompt inspection is outside the current assigned project scope",
          },
        };
      }
    }

    return inspection;
  });

  app.patch(
    "/v1/prompt-inspections/:promptInspectionId/review",
    async (request, reply) => {
      const params = request.params as { promptInspectionId: string };
      const validationError = validateResourceId(
        reply,
        "prompt inspection",
        params.promptInspectionId,
      );
      if (validationError) {
        return validationError;
      }

      const input = PromptReviewInputSchema.parse(request.body);
      const inspection = await getPromptInspectionById(
        context.db,
        params.promptInspectionId,
      );
      if (!inspection) {
        reply.code(404);
        return {
          error: {
            message: "Prompt inspection not found",
          },
        };
      }

      const access = await getWorkspaceAccess(
        context,
        request,
        reply,
        "prompt_inspection.write",
        inspection.workspaceId,
      );
      if ("error" in access) {
        return access;
      }

      const actor = await getAuditActor(context.db, request, inspection.workspaceId);
      const updated = await updatePromptInspectionReview(context.db, inspection.id, {
        ...input,
        reviewedBy: actor.actorId,
      });
      if (!updated) {
        reply.code(404);
        return {
          error: {
            message: "Prompt inspection not found",
          },
        };
      }

      await appendRequestAuditLog(context.db, request, {
        workspaceId: updated.workspaceId,
        projectId: updated.projectId,
        environmentId: updated.environmentId,
        action: "prompt_inspection.reviewed",
        subjectType: "prompt-inspection",
        subjectId: updated.id,
        payload: {
          reviewStatus: updated.reviewStatus,
          reviewNote: updated.reviewNote,
        },
      });

      return updated;
    },
  );

  app.post("/v1/prompt-inspections/batch-review", async (request, reply) => {
    const input = PromptBatchReviewInputSchema.parse(request.body);
    const access = await getWorkspaceAccess(
      context,
      request,
      reply,
      "prompt_inspection.write",
      input.workspaceId,
    );
    if ("error" in access) {
      return access;
    }

    const inspections = await listPromptInspectionsByIds(
      context.db,
      input.inspectionIds,
    );
    if (inspections.length !== input.inspectionIds.length) {
      reply.code(400);
      return {
        error: {
          message: "One or more prompt inspections could not be found",
        },
      };
    }

    if (inspections.some((item) => item.workspaceId !== input.workspaceId)) {
      reply.code(400);
      return {
        error: {
          message: "All prompt inspections must belong to the requested workspace",
        },
      };
    }

    const actor = await getAuditActor(context.db, request, input.workspaceId);
    const updated = await batchUpdatePromptInspectionReview(context.db, {
      ...input,
      reviewedBy: actor.actorId,
    });

    const batchId = randomUUID();
    for (const inspection of updated) {
      await appendRequestAuditLog(context.db, request, {
        workspaceId: inspection.workspaceId,
        projectId: inspection.projectId,
        environmentId: inspection.environmentId,
        action: "prompt_inspection.reviewed",
        subjectType: "prompt-inspection",
        subjectId: inspection.id,
        payload: {
          batchId,
          reviewStatus: inspection.reviewStatus,
          reviewNote: inspection.reviewNote,
        },
      });
    }

    await appendRequestAuditLog(context.db, request, {
      workspaceId: input.workspaceId,
      action: "prompt_inspection.batch_reviewed",
      subjectType: "workspace",
      subjectId: input.workspaceId,
      payload: {
        batchId,
        inspectionIds: updated.map((item) => item.id),
        reviewedCount: updated.length,
        reviewStatus: input.reviewStatus,
      },
    });

    return {
      batchId,
      reviewedCount: updated.length,
      inspectionIds: updated.map((item) => item.id),
      reviewStatus: input.reviewStatus,
    };
  });
}
