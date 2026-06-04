import type { FastifyInstance } from "fastify";

import { CreateScheduledReportInputSchema, ScheduledReportListQuerySchema, UpdateScheduledReportInputSchema } from "@teamops/contracts";
import {
  createScheduledReport,
  deleteScheduledReport,
  findEnvironmentById,
  getScheduledReportById,
  listScheduledReports,
  normalizeExportFilters,
  triggerScheduledReport,
  updateScheduledReport,
} from "@teamops/database";

import { appendRequestAuditLog } from "../audit.js";
import type { ControlApiContext } from "../context.js";
import { getWorkspaceAccess } from "../permissions.js";
import { getAssignedProjectIdSet } from "../project-scope.js";
import { requireEnvironment, validateResourceId } from "../resource-guards.js";

function isDuplicateScheduledReportNameError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "string" &&
    (error as { code: string }).code === "23505"
  );
}

function readExportProjectIds(filters: Record<string, unknown>) {
  const projectIds = new Set<string>();

  if (typeof filters.projectId === "string" && filters.projectId.trim()) {
    projectIds.add(filters.projectId.trim());
  }

  if (Array.isArray(filters.projectIds)) {
    for (const value of filters.projectIds) {
      if (typeof value === "string" && value.trim()) {
        projectIds.add(value.trim());
      }
    }
  }

  return [...projectIds];
}

function normalizeScheduledReportRequestBody(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return body;
  }

  const record = body as Record<string, unknown>;
  if (!("filters" in record)) {
    return body;
  }

  return {
    ...record,
    filters: normalizeExportFilters(
      record.filters && typeof record.filters === "object" && !Array.isArray(record.filters)
        ? (record.filters as Record<string, unknown>)
        : {},
    ),
  };
}

async function resolveExportProjectIds(db: ControlApiContext["db"], filters: Record<string, unknown>) {
  const projectIds = readExportProjectIds(filters);
  if (!projectIds.length) {
    const environmentId = typeof filters.environmentId === "string" ? filters.environmentId.trim() : "";
    if (!environmentId) {
      return [];
    }

    const environment = await findEnvironmentById(db, environmentId);
    if (!environment) {
      return [];
    }

    return [environment.projectId];
  }

  return projectIds;
}

async function scheduledReportFitsProjectScope(
  db: ControlApiContext["db"],
  filters: Record<string, unknown>,
  assignedProjectIds: Set<string>,
) {
  const projectIds = await resolveExportProjectIds(db, filters);
  if (!projectIds.length) {
    return false;
  }

  return projectIds.every((projectId) => assignedProjectIds.has(projectId));
}

export async function registerScheduledReportRoutes(app: FastifyInstance, context: ControlApiContext) {
  app.get("/v1/scheduled-reports", async (request, reply) => {
    const query = ScheduledReportListQuerySchema.parse(request.query);
    const access = await getWorkspaceAccess(context, request, reply, "export.read", query.workspaceId);
    if ("error" in access) {
      return access;
    }

    const assignedProjectIdSet = await getAssignedProjectIdSet(context, access);
    const items = await listScheduledReports(context.db, query.workspaceId);
    if (assignedProjectIdSet) {
      const visibleItems = [];
      for (const item of items) {
        const isVisible = await scheduledReportFitsProjectScope(context.db, item.filters, assignedProjectIdSet);
        if (isVisible) {
          visibleItems.push(item);
        }
      }

      return {
        items: visibleItems,
      };
    }

    return {
      items,
    };
  });

  app.post("/v1/scheduled-reports", async (request, reply) => {
    const input = CreateScheduledReportInputSchema.parse(normalizeScheduledReportRequestBody(request.body));
    const access = await getWorkspaceAccess(context, request, reply, "export.write", input.workspaceId);
    if ("error" in access) {
      return access;
    }

    const assignedProjectIdSet = await getAssignedProjectIdSet(context, access);
    let normalizedInput = input;
    if (assignedProjectIdSet) {
      const inputFilters = input.filters as Record<string, unknown>;
      const requestedProjectIds = readExportProjectIds(inputFilters);
      if (requestedProjectIds.some((projectId) => !assignedProjectIdSet.has(projectId))) {
        reply.code(403);
        return {
          error: {
            message: "One or more requested projects are outside the current assigned project scope",
          },
        };
      }

      let scopedEnvironmentProjectId: string | null = null;
      const environmentId = typeof inputFilters.environmentId === "string" ? inputFilters.environmentId : "";
      if (environmentId) {
        const environment = await requireEnvironment(context.db, reply, environmentId);
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

        scopedEnvironmentProjectId = environment.projectId;
      }

      const projectId = typeof inputFilters.projectId === "string" ? inputFilters.projectId : null;
      if (projectId && !assignedProjectIdSet.has(projectId)) {
        reply.code(403);
        return {
          error: {
            message: "This project is outside the current assigned project scope",
          },
        };
      }

      normalizedInput = {
        ...input,
        filters: {
          ...input.filters,
          projectIds: projectId
            ? [projectId]
            : scopedEnvironmentProjectId
              ? [scopedEnvironmentProjectId]
              : requestedProjectIds.length
                ? requestedProjectIds
                : [...assignedProjectIdSet],
        },
      } as typeof input;
    }

    try {
      const scheduledReport = await createScheduledReport(context.db, normalizedInput);

      await appendRequestAuditLog(context.db, request, {
        workspaceId: scheduledReport.workspaceId,
        projectId:
          typeof scheduledReport.filters.projectId === "string" ? scheduledReport.filters.projectId : null,
        environmentId:
          typeof scheduledReport.filters.environmentId === "string"
            ? scheduledReport.filters.environmentId
            : null,
        action: "scheduled_report.created",
        subjectType: "scheduled-report",
        subjectId: scheduledReport.id,
        payload: {
          cadence: scheduledReport.cadence,
          kind: scheduledReport.kind,
          format: scheduledReport.format,
          name: scheduledReport.name,
          nextRunAt: scheduledReport.nextRunAt,
        },
      });

      reply.code(201);
      return scheduledReport;
    } catch (error) {
      if (isDuplicateScheduledReportNameError(error)) {
        reply.code(409);
        return {
          error: {
            message: "A scheduled report with this name already exists for this workspace",
          },
        };
      }

      throw error;
    }
  });

  app.post("/v1/scheduled-reports/:scheduledReportId/trigger", async (request, reply) => {
    const params = request.params as { scheduledReportId: string };
    const validationError = validateResourceId(reply, "scheduled report", params.scheduledReportId);
    if (validationError) {
      return validationError;
    }

    const scheduledReport = await getScheduledReportById(context.db, params.scheduledReportId);
    if (!scheduledReport) {
      reply.code(404);
      return {
        error: {
          message: "Scheduled report not found",
        },
      };
    }

    const access = await getWorkspaceAccess(context, request, reply, "export.write", scheduledReport.workspaceId);
    if ("error" in access) {
      return access;
    }

    const assignedProjectIdSet = await getAssignedProjectIdSet(context, access);
    if (assignedProjectIdSet) {
      const isVisible = await scheduledReportFitsProjectScope(context.db, scheduledReport.filters, assignedProjectIdSet);
      if (!isVisible) {
        reply.code(403);
        return {
          error: {
            message: "This scheduled report is outside the current assigned project scope",
          },
        };
      }
    }

    const triggeredReport = await triggerScheduledReport(context.db, scheduledReport.id);
    if (!triggeredReport) {
      reply.code(404);
      return {
        error: {
          message: "Scheduled report not found",
        },
      };
    }

    await appendRequestAuditLog(context.db, request, {
      workspaceId: triggeredReport.scheduledReport.workspaceId,
      projectId:
        typeof triggeredReport.scheduledReport.filters.projectId === "string"
          ? triggeredReport.scheduledReport.filters.projectId
          : null,
      environmentId:
        typeof triggeredReport.scheduledReport.filters.environmentId === "string"
          ? triggeredReport.scheduledReport.filters.environmentId
          : null,
      action: triggeredReport.deduplicated ? "scheduled_report.trigger_deduplicated" : "scheduled_report.triggered",
      subjectType: "scheduled-report",
      subjectId: triggeredReport.scheduledReport.id,
      payload: {
        cadence: triggeredReport.scheduledReport.cadence,
        kind: triggeredReport.scheduledReport.kind,
        format: triggeredReport.scheduledReport.format,
        name: triggeredReport.scheduledReport.name,
        exportJobId: triggeredReport.exportJob.id,
        nextRunAt: triggeredReport.scheduledReport.nextRunAt,
        lastRunAt: triggeredReport.scheduledReport.lastRunAt,
        triggerSource: "manual",
        advancedSchedule: triggeredReport.advancedSchedule,
        deduplicated: triggeredReport.deduplicated,
      },
    });

    reply.code(202);
    return {
      scheduledReport: triggeredReport.scheduledReport,
      exportJob: triggeredReport.exportJob,
    };
  });

  app.delete("/v1/scheduled-reports/:scheduledReportId", async (request, reply) => {
    const params = request.params as { scheduledReportId: string };
    const validationError = validateResourceId(reply, "scheduled report", params.scheduledReportId);
    if (validationError) {
      return validationError;
    }

    const scheduledReport = await getScheduledReportById(context.db, params.scheduledReportId);
    if (!scheduledReport) {
      reply.code(404);
      return {
        error: {
          message: "Scheduled report not found",
        },
      };
    }

    const access = await getWorkspaceAccess(context, request, reply, "export.write", scheduledReport.workspaceId);
    if ("error" in access) {
      return access;
    }

    const assignedProjectIdSet = await getAssignedProjectIdSet(context, access);
    if (assignedProjectIdSet) {
      const isVisible = await scheduledReportFitsProjectScope(context.db, scheduledReport.filters, assignedProjectIdSet);
      if (!isVisible) {
        reply.code(403);
        return {
          error: {
            message: "This scheduled report is outside the current assigned project scope",
          },
        };
      }
    }

    const deletedScheduledReport = await deleteScheduledReport(context.db, scheduledReport.id);
    if (!deletedScheduledReport) {
      reply.code(404);
      return {
        error: {
          message: "Scheduled report not found",
        },
      };
    }

    await appendRequestAuditLog(context.db, request, {
      workspaceId: deletedScheduledReport.workspaceId,
      projectId:
        typeof deletedScheduledReport.filters.projectId === "string"
          ? deletedScheduledReport.filters.projectId
          : null,
      environmentId:
        typeof deletedScheduledReport.filters.environmentId === "string"
          ? deletedScheduledReport.filters.environmentId
          : null,
      action: "scheduled_report.deleted",
      subjectType: "scheduled-report",
      subjectId: deletedScheduledReport.id,
      payload: {
        cadence: deletedScheduledReport.cadence,
        kind: deletedScheduledReport.kind,
        format: deletedScheduledReport.format,
        name: deletedScheduledReport.name,
      },
    });

    reply.code(204);
    return null;
  });

  app.patch("/v1/scheduled-reports/:scheduledReportId", async (request, reply) => {
    const params = request.params as { scheduledReportId: string };
    const validationError = validateResourceId(reply, "scheduled report", params.scheduledReportId);
    if (validationError) {
      return validationError;
    }

    const input = UpdateScheduledReportInputSchema.parse(normalizeScheduledReportRequestBody(request.body));
    const scheduledReport = await getScheduledReportById(context.db, params.scheduledReportId);
    if (!scheduledReport) {
      reply.code(404);
      return {
        error: {
          message: "Scheduled report not found",
        },
      };
    }

    const access = await getWorkspaceAccess(context, request, reply, "export.write", scheduledReport.workspaceId);
    if ("error" in access) {
      return access;
    }

    const assignedProjectIdSet = await getAssignedProjectIdSet(context, access);
    if (assignedProjectIdSet) {
      const filters = (input.filters ?? scheduledReport.filters) as Record<string, unknown>;
      const isVisible = await scheduledReportFitsProjectScope(context.db, filters, assignedProjectIdSet);
      if (!isVisible) {
        reply.code(403);
        return {
          error: {
            message: "This scheduled report is outside the current assigned project scope",
          },
        };
      }
    }

    try {
      const updatedScheduledReport = await updateScheduledReport(context.db, scheduledReport.id, input);
      if (!updatedScheduledReport) {
        reply.code(404);
        return {
          error: {
            message: "Scheduled report not found",
          },
        };
      }

      await appendRequestAuditLog(context.db, request, {
        workspaceId: updatedScheduledReport.workspaceId,
        projectId:
          typeof updatedScheduledReport.filters.projectId === "string"
            ? updatedScheduledReport.filters.projectId
            : null,
        environmentId:
          typeof updatedScheduledReport.filters.environmentId === "string"
            ? updatedScheduledReport.filters.environmentId
            : null,
        action: "scheduled_report.updated",
        subjectType: "scheduled-report",
        subjectId: updatedScheduledReport.id,
        payload: {
          previousName: scheduledReport.name,
          nextName: updatedScheduledReport.name,
          previousCadence: scheduledReport.cadence,
          nextCadence: updatedScheduledReport.cadence,
          previousFormat: scheduledReport.format,
          nextFormat: updatedScheduledReport.format,
        },
      });

      return updatedScheduledReport;
    } catch (error) {
      if (isDuplicateScheduledReportNameError(error)) {
        reply.code(409);
        return {
          error: {
            message: "A scheduled report with this name already exists for this workspace",
          },
        };
      }

      throw error;
    }
  });
}
