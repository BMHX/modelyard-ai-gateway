import type { FastifyInstance } from "fastify";

import {
  AuditLogQuerySchema,
  CreateExportJobInputSchema,
  ReportGovernanceSchema,
  type UpdateExportJobInput,
  UpdateExportJobInputSchema,
  UsageEventDailyQuerySchema,
  UsageEventQuerySchema,
  UsageEventSummaryQuerySchema,
} from "@teamops/contracts";
import {
  createExportJob,
  findEnvironmentById,
  findMemberByWorkspaceAndEmail,
  getExportJobById,
  getExportJobDownloadDescriptor,
  getUsageEventDailySeries,
  getUsageEventById,
  getUsageEventSummary,
  findVirtualKeyById,
  listAuditLogs,
  listExportJobs,
  listUsageEvents,
  retryExportJob,
  updateExportJob,
} from "@teamops/database";

import { appendRequestAuditLog, appendWorkspaceOnboardingMilestoneIfAbsent } from "../audit.js";
import { getHeaderValue, getRequestMemberEmail } from "../auth.js";
import type { ControlApiContext } from "../context.js";
import { getExportDownloadFile, normalizeCreateExportJobInput } from "../export-service.js";
import {
  getMemberSelfScopeFilters,
  isVirtualKeyVisibleWithinMemberSelfScope,
} from "../member-self-scope.js";
import {
  canManageExportGovernance,
  getWorkspaceAccess,
  hasAdminAccess,
  type WorkspaceAccess,
} from "../permissions.js";
import { getAssignedProjectIdSet, shouldApplyAssignedProjectScopeToExport } from "../project-scope.js";
import { requireEnvironment, validateResourceId } from "../resource-guards.js";

function getDownloadContentType(fileName: string) {
  return fileName.endsWith(".csv")
    ? "text/csv; charset=utf-8"
    : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
}

function getRecordValue(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {} as Record<string, unknown>;
  }

  return value as Record<string, unknown>;
}

function getExportGovernance(filters: Record<string, unknown>) {
  try {
    return ReportGovernanceSchema.parse(getRecordValue(filters.governance));
  } catch {
    return ReportGovernanceSchema.parse({});
  }
}

function getEffectiveGovernanceApprovalState(
  currentGovernance: ReturnType<typeof getExportGovernance>,
  governancePatch: NonNullable<NonNullable<UpdateExportJobInput["filtersPatch"]>["governance"]>,
) {
  const approvalMode = governancePatch.approvalMode ?? currentGovernance.approvalMode;
  const approvalStatus =
    approvalMode === "required"
      ? (governancePatch.approvalStatus ?? currentGovernance.approvalStatus)
      : "not_required";

  return {
    approvalMode,
    approvalStatus,
  };
}

function getGovernanceTransitionError(
  exportJob: NonNullable<Awaited<ReturnType<typeof getExportJobById>>>,
  currentGovernance: ReturnType<typeof getExportGovernance>,
  governancePatch: NonNullable<NonNullable<UpdateExportJobInput["filtersPatch"]>["governance"]>,
) {
  const nextGovernance = getEffectiveGovernanceApprovalState(currentGovernance, governancePatch);

  if (
    exportJob.status === "completed" &&
    currentGovernance.approvalMode === "required" &&
    nextGovernance.approvalMode !== "required"
  ) {
    return "Completed exports cannot remove a required approval gate";
  }

  if (currentGovernance.approvalStatus === "approved" && nextGovernance.approvalStatus !== "approved") {
    return "Approved exports cannot be reverted to a non-approved state";
  }

  if (nextGovernance.approvalStatus === "approved" && nextGovernance.approvalMode !== "required") {
    return "Only approval-required exports can be marked approved";
  }

  if (nextGovernance.approvalStatus === "approved" && exportJob.status !== "completed") {
    return "Only completed exports can be approved";
  }

  return null;
}

function setExportDownloadSecurityHeaders(reply: {
  header: (name: string, value: string) => unknown;
}) {
  reply.header("cache-control", "private, no-store, max-age=0");
  reply.header("pragma", "no-cache");
  reply.header("x-content-type-options", "nosniff");
  reply.header("x-download-options", "noopen");
  reply.header("cross-origin-resource-policy", "same-origin");
}

function getExportAuditScope(filters: Record<string, unknown>) {
  return {
    projectId: typeof filters.projectId === "string" ? filters.projectId : null,
    environmentId: typeof filters.environmentId === "string" ? filters.environmentId : null,
  };
}

function sanitizeDownloadFileName(fileName: string) {
  const normalized = fileName
    .trim()
    .replace(/[\u0000-\u001F\u007F]+/g, "")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .replace(/\.+$/g, "")
    .trim();

  return normalized || "export";
}

function buildAttachmentContentDisposition(fileName: string) {
  const safeFileName = sanitizeDownloadFileName(fileName);
  const asciiFallback =
    safeFileName
      .normalize("NFKD")
      .replace(/[^\x20-\x7E]+/g, "")
      .replace(/["\\]/g, "_")
      .trim() || "export";
  const encodedFileName = encodeURIComponent(safeFileName).replace(/['()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );

  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodedFileName}`;
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

async function resolveExportProjectIds(
  db: ControlApiContext["db"],
  filters: Record<string, unknown>,
) {
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

async function exportFitsProjectScope(
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

async function exportAccessibleWithinProjectScope(
  db: ControlApiContext["db"],
  access: WorkspaceAccess,
  filters: Record<string, unknown>,
  assignedProjectIds: Set<string> | null,
) {
  if (!assignedProjectIds || !shouldApplyAssignedProjectScopeToExport(access, filters)) {
    return true;
  }

  return exportFitsProjectScope(db, filters, assignedProjectIds);
}

function isSameAuditActor(
  left: {
    actorType: string;
    actorId: string;
  },
  right: {
    actorType: string;
    actorId: string;
  },
) {
  return (
    left.actorType.trim().toLowerCase() === right.actorType.trim().toLowerCase() &&
    left.actorId.trim().toLowerCase() === right.actorId.trim().toLowerCase()
  );
}

async function getExportApprovalActor(
  db: ControlApiContext["db"],
  access: WorkspaceAccess,
  request: {
    headers: Record<string, string | string[] | undefined>;
  },
  workspaceId: string,
) {
  const explicitActorType = getHeaderValue(request.headers["x-actor-type"])?.trim();
  const explicitActorId = getHeaderValue(request.headers["x-actor-id"])?.trim();

  if (explicitActorType && explicitActorId) {
    return {
      actorType: explicitActorType,
      actorId: explicitActorId,
      label: explicitActorId,
    };
  }

  if (!access.isAdmin) {
    return {
      actorType: "member",
      actorId: access.member.email,
      label: access.member.email,
    };
  }

  const memberEmail = getRequestMemberEmail(request.headers);
  if (memberEmail) {
    const member = await findMemberByWorkspaceAndEmail(db, workspaceId, memberEmail);
    if (member) {
      return {
        actorType: "member",
        actorId: member.email,
        label: member.email,
      };
    }
  }

  return {
    actorType: explicitActorType || "system",
    actorId: explicitActorId || "bootstrap",
    label: explicitActorId || "control-api-admin",
  };
}

async function getExportRequestActor(
  db: ControlApiContext["db"],
  workspaceId: string,
  exportJobId: string,
) {
  const { items } = await listAuditLogs(db, {
    workspaceId,
    action: "export.requested",
    subjectType: "export-job",
    subjectId: exportJobId,
    limit: 1,
    offset: 0,
  });

  const requestAuditLog = items[0];
  if (!requestAuditLog) {
    return null;
  }

  return {
    actorType: requestAuditLog.actorType,
    actorId: requestAuditLog.actorId,
  };
}

export async function registerUsageRoutes(app: FastifyInstance, context: ControlApiContext) {
  app.get("/v1/usage-events", async (request, reply) => {
    const query = UsageEventQuerySchema.parse(request.query);
    if (!query.workspaceId) {
      if (!hasAdminAccess(context, request)) {
        reply.code(400);
        return {
          error: {
            message: "workspaceId is required for member-scoped usage queries",
          },
        };
      }

      return listUsageEvents(context.db, query);
    }

    const access = await getWorkspaceAccess(context, request, reply, "usage.read", query.workspaceId);
    if ("error" in access) {
      return access;
    }

    const memberSelfScopeFilters = getMemberSelfScopeFilters(access);
    const assignedProjectIdSet = await getAssignedProjectIdSet(context, access);
    if (assignedProjectIdSet) {
      const assignedProjectIds = [...assignedProjectIdSet];

      if (query.projectId && !assignedProjectIdSet.has(query.projectId)) {
        reply.code(403);
        return {
          error: {
            message: "This project is outside the current assigned project scope",
          },
        };
      }

      if (query.environmentId) {
        const environment = await requireEnvironment(context.db, reply, query.environmentId);
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

      if (!query.projectId && !query.environmentId) {
        if (!assignedProjectIds.length) {
          return {
            items: [],
            total: 0,
          };
        }

        return listUsageEvents(context.db, {
          ...query,
          projectIds: assignedProjectIds,
          virtualKeyOwner: memberSelfScopeFilters?.owner,
          issuedByMemberId: memberSelfScopeFilters?.issuedByMemberId,
        });
      }
    }

    return listUsageEvents(context.db, {
      ...query,
      virtualKeyOwner: memberSelfScopeFilters?.owner,
      issuedByMemberId: memberSelfScopeFilters?.issuedByMemberId,
    });
  });

  app.get("/v1/usage-events/summary", async (request, reply) => {
    const query = UsageEventSummaryQuerySchema.parse(request.query);
    if (!query.workspaceId) {
      if (!hasAdminAccess(context, request)) {
        reply.code(400);
        return {
          error: {
            message: "workspaceId is required for member-scoped usage summary queries",
          },
        };
      }

      return getUsageEventSummary(context.db, query);
    }

    const access = await getWorkspaceAccess(context, request, reply, "usage.read", query.workspaceId);
    if ("error" in access) {
      return access;
    }

    const memberSelfScopeFilters = getMemberSelfScopeFilters(access);
    const assignedProjectIdSet = await getAssignedProjectIdSet(context, access);
    if (assignedProjectIdSet) {
      const assignedProjectIds = [...assignedProjectIdSet];

      if (query.projectId && !assignedProjectIdSet.has(query.projectId)) {
        reply.code(403);
        return {
          error: {
            message: "This project is outside the current assigned project scope",
          },
        };
      }

      if (query.environmentId) {
        const environment = await requireEnvironment(context.db, reply, query.environmentId);
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

      if (!query.projectId && !query.environmentId) {
        if (!assignedProjectIds.length) {
          return {
            totalEvents: 0,
            totalPromptTokens: 0,
            totalCompletionTokens: 0,
            totalTokens: 0,
            totalCostUsd: 0,
            averageLatencyMs: null,
            successRate: null,
            statusBreakdown: [],
            providerBreakdown: [],
            modelBreakdown: [],
          };
        }

        return getUsageEventSummary(context.db, {
          ...query,
          projectIds: assignedProjectIds,
          virtualKeyOwner: memberSelfScopeFilters?.owner,
          issuedByMemberId: memberSelfScopeFilters?.issuedByMemberId,
        });
      }
    }

    return getUsageEventSummary(context.db, {
      ...query,
      virtualKeyOwner: memberSelfScopeFilters?.owner,
      issuedByMemberId: memberSelfScopeFilters?.issuedByMemberId,
    });
  });

  app.get("/v1/usage-events/daily", async (request, reply) => {
    const query = UsageEventDailyQuerySchema.parse(request.query);
    const windowDays = Number(query.window ?? "30");
    const now = new Date();
    const from = new Date(now);
    from.setUTCDate(from.getUTCDate() - (windowDays - 1));
    from.setUTCHours(0, 0, 0, 0);

    if (!query.workspaceId) {
      if (!hasAdminAccess(context, request)) {
        reply.code(400);
        return {
          error: {
            message: "workspaceId is required for member-scoped usage daily queries",
          },
        };
      }

      const items = await getUsageEventDailySeries(context.db, {
        projectId: query.projectId,
        environmentId: query.environmentId,
        from,
      });

      return {
        window: windowDays,
        items,
      };
    }

    const access = await getWorkspaceAccess(context, request, reply, "usage.read", query.workspaceId);
    if ("error" in access) {
      return access;
    }

    const memberSelfScopeFilters = getMemberSelfScopeFilters(access);
    const assignedProjectIdSet = await getAssignedProjectIdSet(context, access);
    const assignedProjectIds = assignedProjectIdSet ? [...assignedProjectIdSet] : null;

    if (query.projectId && assignedProjectIdSet && !assignedProjectIdSet.has(query.projectId)) {
      reply.code(403);
      return {
        error: {
          message: "This project is outside the current assigned project scope",
        },
      };
    }

    if (query.environmentId) {
      const environment = await requireEnvironment(context.db, reply, query.environmentId);
      if ("error" in environment) {
        return environment;
      }

      if (environment.workspaceId !== query.workspaceId) {
        reply.code(400);
        return {
          error: {
            message: "Environment does not belong to the requested workspace",
          },
        };
      }

      if (assignedProjectIdSet && !assignedProjectIdSet.has(environment.projectId)) {
        reply.code(403);
        return {
          error: {
            message: "This environment is outside the current assigned project scope",
          },
        };
      }
    }

    if (assignedProjectIdSet && !query.projectId && !query.environmentId && assignedProjectIds && !assignedProjectIds.length) {
      return {
        window: windowDays,
        items: [],
      };
    }

    const filters: Parameters<typeof getUsageEventDailySeries>[1] = {
      workspaceId: query.workspaceId,
      virtualKeyOwner: memberSelfScopeFilters?.owner,
      issuedByMemberId: memberSelfScopeFilters?.issuedByMemberId,
      from,
    };

    if (query.projectId) {
      filters.projectId = query.projectId;
    } else if (assignedProjectIds && assignedProjectIds.length) {
      filters.projectIds = assignedProjectIds;
    }

    if (query.environmentId) {
      filters.environmentId = query.environmentId;
    }

    const items = await getUsageEventDailySeries(context.db, filters);

    return {
      window: windowDays,
      items,
    };
  });

  app.get("/v1/usage-events/:usageEventId", async (request, reply) => {
    const params = request.params as { usageEventId: string };
    const validationError = validateResourceId(reply, "usage event", params.usageEventId);
    if (validationError) {
      return validationError;
    }

    const usageEvent = await getUsageEventById(context.db, params.usageEventId);
    if (!usageEvent) {
      reply.code(404);
      return {
        error: {
          message: "Usage event not found",
        },
      };
    }

    if (!usageEvent.workspaceId) {
      if (!hasAdminAccess(context, request)) {
        reply.code(403);
        return {
          error: {
            message: "Only admins can inspect global usage events",
          },
        };
      }

      return usageEvent;
    }

    const access = await getWorkspaceAccess(context, request, reply, "usage.read", usageEvent.workspaceId);
    if ("error" in access) {
      return access;
    }

    const assignedProjectIdSet = await getAssignedProjectIdSet(context, access);
    if (assignedProjectIdSet) {
      if (!usageEvent.projectId || !assignedProjectIdSet.has(usageEvent.projectId)) {
        reply.code(403);
        return {
          error: {
            message: "This usage event is outside the current assigned project scope",
          },
        };
      }
    }

    if (getMemberSelfScopeFilters(access)) {
      const virtualKey =
        usageEvent.virtualKeyId === null ? null : await findVirtualKeyById(context.db, usageEvent.virtualKeyId);
      if (!virtualKey || !isVirtualKeyVisibleWithinMemberSelfScope(access, virtualKey)) {
        reply.code(403);
        return {
          error: {
            message: "This usage event is outside the current member scope",
          },
        };
      }
    }

    return usageEvent;
  });

  app.get("/v1/audit-logs", async (request, reply) => {
    const query = AuditLogQuerySchema.parse(request.query);
    if (!query.workspaceId) {
      if (!hasAdminAccess(context, request)) {
        reply.code(400);
        return {
          error: {
            message: "workspaceId is required for member-scoped audit log queries",
          },
        };
      }

      return listAuditLogs(context.db, query);
    }

    const access = await getWorkspaceAccess(context, request, reply, "audit_log.read", query.workspaceId);
    if ("error" in access) {
      return access;
    }

    const memberSelfScopeFilters = getMemberSelfScopeFilters(access);
    const assignedProjectIdSet = await getAssignedProjectIdSet(context, access);
    if (assignedProjectIdSet) {
      const assignedProjectIds = [...assignedProjectIdSet];

      if (query.projectId && !assignedProjectIdSet.has(query.projectId)) {
        reply.code(403);
        return {
          error: {
            message: "This project is outside the current assigned project scope",
          },
        };
      }

      if (query.environmentId) {
        const environment = await requireEnvironment(context.db, reply, query.environmentId);
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

      if (!query.projectId && !query.environmentId) {
        if (!assignedProjectIds.length) {
          return {
            items: [],
            total: 0,
          };
        }

        return listAuditLogs(context.db, {
          ...query,
          projectIds: assignedProjectIds,
          actorId: memberSelfScopeFilters?.owner ?? query.actorId,
        });
      }
    }

    return listAuditLogs(context.db, {
      ...query,
      actorId: memberSelfScopeFilters?.owner ?? query.actorId,
    });
  });

  app.get("/v1/export-jobs", async (request, reply) => {
    const query = request.query as { workspaceId?: string };
    if (!query.workspaceId) {
      return { items: [] };
    }

    const validationError = validateResourceId(reply, "workspace", query.workspaceId);
    if (validationError) {
      return validationError;
    }

    const access = await getWorkspaceAccess(context, request, reply, "export.read", query.workspaceId);
    if ("error" in access) {
      return access;
    }

    const items = await listExportJobs(context.db, query.workspaceId);
    const assignedProjectIdSet = await getAssignedProjectIdSet(context, access);
    if (assignedProjectIdSet) {
      const visibleItems = [];
      for (const job of items) {
        const isVisible = await exportAccessibleWithinProjectScope(
          context.db,
          access,
          job.filters,
          assignedProjectIdSet,
        );

        if (isVisible) {
          visibleItems.push(job);
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

  app.post("/v1/export-jobs/:exportJobId/retry", async (request, reply) => {
    const params = request.params as { exportJobId: string };
    const validationError = validateResourceId(reply, "export job", params.exportJobId);
    if (validationError) {
      return validationError;
    }

    const exportJob = await getExportJobById(context.db, params.exportJobId);
    if (!exportJob) {
      reply.code(404);
      return {
        error: {
          message: "Export job not found",
        },
      };
    }

    const access = await getWorkspaceAccess(context, request, reply, "export.write", exportJob.workspaceId);
    if ("error" in access) {
      return access;
    }

    const assignedProjectIdSet = await getAssignedProjectIdSet(context, access);
    if (assignedProjectIdSet) {
      if (
        !(await exportAccessibleWithinProjectScope(
          context.db,
          access,
          exportJob.filters,
          assignedProjectIdSet,
        ))
      ) {
        reply.code(403);
        return {
          error: {
            message: "This export is outside the current assigned project scope",
          },
        };
      }
    }

    if (exportJob.status !== "failed") {
      reply.code(409);
      return {
        error: {
          message: "Only failed export jobs can be retried",
        },
      };
    }

    const retriedJob = await retryExportJob(context.db, exportJob.id);
    if (!retriedJob) {
      reply.code(409);
      return {
        error: {
          message: "This export job is no longer retryable",
        },
      };
    }

    await appendRequestAuditLog(context.db, request, {
      workspaceId: retriedJob.workspaceId,
      projectId: typeof retriedJob.filters.projectId === "string" ? retriedJob.filters.projectId : null,
      environmentId: typeof retriedJob.filters.environmentId === "string" ? retriedJob.filters.environmentId : null,
      action: "export.requeued",
      subjectType: "export-job",
      subjectId: retriedJob.id,
      payload: {
        kind: retriedJob.kind,
        format: retriedJob.format,
        fileName: retriedJob.fileName,
        previousStatus: exportJob.status,
        triggerSource: "manual_retry",
      },
    });

    reply.code(202);
    return retriedJob;
  });

  app.patch("/v1/export-jobs/:exportJobId", async (request, reply) => {
    const params = request.params as { exportJobId: string };
    const validationError = validateResourceId(reply, "export job", params.exportJobId);
    if (validationError) {
      return validationError;
    }

    const input = UpdateExportJobInputSchema.parse(request.body);
    const exportJob = await getExportJobById(context.db, params.exportJobId);
    if (!exportJob) {
      reply.code(404);
      return {
        error: {
          message: "Export job not found",
        },
      };
    }

    const access = await getWorkspaceAccess(context, request, reply, "export.write", exportJob.workspaceId);
    if ("error" in access) {
      return access;
    }

    const assignedProjectIdSet = await getAssignedProjectIdSet(context, access);
    if (assignedProjectIdSet) {
      if (
        !(await exportAccessibleWithinProjectScope(
          context.db,
          access,
          exportJob.filters,
          assignedProjectIdSet,
        ))
      ) {
        reply.code(403);
        return {
          error: {
            message: "This export is outside the current assigned project scope",
          },
        };
      }
    }

    const currentGovernance = getExportGovernance(exportJob.filters);
    const exportAuditScope = getExportAuditScope(exportJob.filters);
    let normalizedInput = input;
    if (input.filtersPatch?.governance) {
      if (!canManageExportGovernance(access)) {
        reply.code(403);
        return {
          error: {
            message: "Only workspace admins can update export governance",
          },
        };
      }

      const {
        approverLabel: _ignoredApproverLabel,
        approvedAt: _ignoredApprovedAt,
        ...governancePatch
      } = input.filtersPatch.governance;
      const normalizedGovernancePatch =
        governancePatch as NonNullable<NonNullable<typeof input.filtersPatch>["governance"]>;
      const governanceTransitionError = getGovernanceTransitionError(
        exportJob,
        currentGovernance,
        normalizedGovernancePatch,
      );
      if (governanceTransitionError) {
        await appendRequestAuditLog(context.db, request, {
          workspaceId: exportJob.workspaceId,
          projectId: exportAuditScope.projectId,
          environmentId: exportAuditScope.environmentId,
          action: "export.governance_update_blocked",
          subjectType: "export-job",
          subjectId: exportJob.id,
          payload: {
            reason: governanceTransitionError,
            attemptedApprovalMode: normalizedGovernancePatch.approvalMode ?? null,
            attemptedApprovalStatus: normalizedGovernancePatch.approvalStatus ?? null,
            currentApprovalMode: currentGovernance.approvalMode,
            currentApprovalStatus: currentGovernance.approvalStatus,
          },
        });
        reply.code(409);
        return {
          error: {
            message: governanceTransitionError,
          },
        };
      }

      if (normalizedGovernancePatch.approvalStatus === "approved") {
        const [approvalActor, requestActor] = await Promise.all([
          getExportApprovalActor(context.db, access, request, exportJob.workspaceId),
          getExportRequestActor(context.db, exportJob.workspaceId, exportJob.id),
        ]);

        if (!requestActor) {
          await appendRequestAuditLog(context.db, request, {
            workspaceId: exportJob.workspaceId,
            projectId: exportAuditScope.projectId,
            environmentId: exportAuditScope.environmentId,
            action: "export.governance_update_blocked",
            subjectType: "export-job",
            subjectId: exportJob.id,
            payload: {
              reason: "missing_request_audit_actor",
              attemptedApprovalMode: normalizedGovernancePatch.approvalMode ?? currentGovernance.approvalMode,
              attemptedApprovalStatus: normalizedGovernancePatch.approvalStatus ?? null,
              currentApprovalMode: currentGovernance.approvalMode,
              currentApprovalStatus: currentGovernance.approvalStatus,
            },
          });
          reply.code(409);
          return {
            error: {
              message: "This export cannot be approved without a recorded requester audit actor",
            },
          };
        }

        if (requestActor && isSameAuditActor(approvalActor, requestActor)) {
          await appendRequestAuditLog(context.db, request, {
            workspaceId: exportJob.workspaceId,
            projectId: exportAuditScope.projectId,
            environmentId: exportAuditScope.environmentId,
            action: "export.governance_update_blocked",
            subjectType: "export-job",
            subjectId: exportJob.id,
            payload: {
              reason: "self_approval_blocked",
              attemptedApprovalMode: normalizedGovernancePatch.approvalMode ?? currentGovernance.approvalMode,
              attemptedApprovalStatus: normalizedGovernancePatch.approvalStatus ?? null,
              currentApprovalMode: currentGovernance.approvalMode,
              currentApprovalStatus: currentGovernance.approvalStatus,
            },
          });
          reply.code(409);
          return {
            error: {
              message: "The export requester cannot approve the same export",
            },
          };
        }

        normalizedGovernancePatch.approverLabel = approvalActor.label;
        normalizedGovernancePatch.approvedAt = new Date().toISOString();
      } else if (normalizedGovernancePatch.approvalStatus) {
        normalizedGovernancePatch.approverLabel = null;
        normalizedGovernancePatch.approvedAt = null;
      }

      normalizedInput = {
        ...input,
        filtersPatch: {
          ...input.filtersPatch,
          governance: normalizedGovernancePatch,
        },
      };
    }

    const updatedJob = await updateExportJob(context.db, exportJob.id, normalizedInput);
    if (!updatedJob) {
      reply.code(404);
      return {
        error: {
          message: "Export job not found",
        },
      };
    }

    await appendRequestAuditLog(context.db, request, {
      workspaceId: updatedJob.workspaceId,
      projectId: exportAuditScope.projectId,
      environmentId: exportAuditScope.environmentId,
      action:
        normalizedInput.filtersPatch?.governance && normalizedInput.filtersPatch?.workflow
          ? "export.followup_updated"
          : normalizedInput.filtersPatch?.governance
            ? "export.governance_updated"
            : "export.workflow_updated",
      subjectType: "export-job",
      subjectId: updatedJob.id,
      payload: {
        updatedFilterKeys: Object.keys(normalizedInput.filtersPatch ?? {}).sort(),
        previousApprovalMode: input.filtersPatch?.governance ? currentGovernance.approvalMode : null,
        previousApprovalStatus: input.filtersPatch?.governance ? currentGovernance.approvalStatus : null,
        nextApprovalMode: getRecordValue(updatedJob.filters.governance).approvalMode ?? null,
        workflowStatus: getRecordValue(updatedJob.filters.workflow).status ?? null,
        approvalStatus: getRecordValue(updatedJob.filters.governance).approvalStatus ?? null,
        approverLabel: getRecordValue(updatedJob.filters.governance).approverLabel ?? null,
      },
    });

    return updatedJob;
  });

  app.get("/v1/export-jobs/:exportJobId/download", async (request, reply) => {
    const params = request.params as { exportJobId: string };
    const validationError = validateResourceId(reply, "export job", params.exportJobId);
    if (validationError) {
      return validationError;
    }

    const descriptor = await getExportJobDownloadDescriptor(context.db, params.exportJobId);
    if (!descriptor) {
      reply.code(404);
      return {
        error: {
          message: "Export file not found",
        },
      };
    }

    const access = await getWorkspaceAccess(
      context,
      request,
      reply,
      "export.read",
      descriptor.workspaceId,
    );
    if ("error" in access) {
      return access;
    }

    const assignedProjectIdSet = await getAssignedProjectIdSet(context, access);
    if (assignedProjectIdSet) {
      if (
        !(await exportAccessibleWithinProjectScope(
          context.db,
          access,
          descriptor.filters,
          assignedProjectIdSet,
        ))
      ) {
        reply.code(403);
        return {
          error: {
            message: "This export is outside the current assigned project scope",
          },
        };
      }
    }

    const governance = getExportGovernance(descriptor.filters);
    if (governance.approvalMode === "required" && governance.approvalStatus !== "approved") {
      await appendRequestAuditLog(context.db, request, {
        workspaceId: descriptor.workspaceId,
        projectId: typeof descriptor.filters.projectId === "string" ? descriptor.filters.projectId : null,
        environmentId:
          typeof descriptor.filters.environmentId === "string" ? descriptor.filters.environmentId : null,
        action: "export.download_blocked",
        subjectType: "export-job",
        subjectId: descriptor.id,
        payload: {
          kind: descriptor.kind,
          fileName: descriptor.fileName,
          approvalMode: governance.approvalMode,
          approvalStatus: governance.approvalStatus,
        },
      });

      reply.code(403);
      return {
        error: {
          message: "This export requires approval before it can be downloaded",
        },
      };
    }

    try {
      const file = await getExportDownloadFile(context.db, params.exportJobId);
      if (!file) {
        reply.code(404);
        return {
          error: {
            message: "Export file not found",
          },
        };
      }

      await appendRequestAuditLog(context.db, request, {
        workspaceId: descriptor.workspaceId,
        projectId: typeof descriptor.filters.projectId === "string" ? descriptor.filters.projectId : null,
        environmentId:
          typeof descriptor.filters.environmentId === "string" ? descriptor.filters.environmentId : null,
        action: "export.downloaded",
        subjectType: "export-job",
        subjectId: descriptor.id,
        payload: {
          kind: descriptor.kind,
          fileName: descriptor.fileName,
          requestedDownloadPath: request.url,
        },
      });

      setExportDownloadSecurityHeaders(reply);
      reply.header("content-type", getDownloadContentType(file.fileName));
      reply.header("content-disposition", buildAttachmentContentDisposition(file.fileName));
      reply.header("x-teamops-report-approval-status", governance.approvalStatus);
      reply.header("x-teamops-report-approval-mode", governance.approvalMode);
      reply.header("x-teamops-report-signed-snapshot", governance.signedSnapshot ? "true" : "false");
      if (governance.watermarkLabel) {
        reply.header("x-teamops-report-watermark", governance.watermarkLabel);
      }
      if (governance.retentionDays !== null) {
        reply.header("x-teamops-report-retention-days", String(governance.retentionDays));
      }
      return reply.send(file.stream);
    } catch (error) {
      reply.code(500);
      return {
        error: {
          message: "Unable to read export file",
        },
      };
    }
  });

  app.post("/v1/export-jobs", async (request, reply) => {
    const input = normalizeCreateExportJobInput(CreateExportJobInputSchema.parse(request.body));
    const access = await getWorkspaceAccess(context, request, reply, "export.write", input.workspaceId);
    if ("error" in access) {
      return access;
    }

    const assignedProjectIdSet = await getAssignedProjectIdSet(context, access);
    let normalizedInput = input;
    if (assignedProjectIdSet && shouldApplyAssignedProjectScopeToExport(access, input.filters)) {
      const requestedProjectIds = readExportProjectIds(input.filters);
      if (requestedProjectIds.some((projectId) => !assignedProjectIdSet.has(projectId))) {
        reply.code(403);
        return {
          error: {
            message: "One or more requested projects are outside the current assigned project scope",
          },
        };
      }

      let scopedEnvironmentProjectId: string | null = null;
      if (input.filters.environmentId) {
        const environment = await requireEnvironment(context.db, reply, input.filters.environmentId);
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

      if (input.filters.projectId && !assignedProjectIdSet.has(input.filters.projectId)) {
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
          projectIds: input.filters.projectId
            ? [input.filters.projectId]
            : scopedEnvironmentProjectId
              ? [scopedEnvironmentProjectId]
              : requestedProjectIds.length
                ? requestedProjectIds
                : [...assignedProjectIdSet],
        },
      };
    }

    const job = await createExportJob(context.db, normalizedInput);

    await appendRequestAuditLog(context.db, request, {
      workspaceId: normalizedInput.workspaceId,
      projectId:
        typeof normalizedInput.filters.projectId === "string" ? normalizedInput.filters.projectId : null,
      environmentId:
        typeof normalizedInput.filters.environmentId === "string" ? normalizedInput.filters.environmentId : null,
      action: "export.requested",
      subjectType: "export-job",
      subjectId: job.id,
      payload: {
        kind: normalizedInput.kind,
        format: normalizedInput.format,
        fileName: job.fileName,
        filters: job.filters,
      },
    });

    await appendWorkspaceOnboardingMilestoneIfAbsent(context.db, request, {
      workspaceId: normalizedInput.workspaceId,
      projectId:
        typeof normalizedInput.filters.projectId === "string" ? normalizedInput.filters.projectId : null,
      environmentId:
        typeof normalizedInput.filters.environmentId === "string" ? normalizedInput.filters.environmentId : null,
      action: "workspace.onboarding.first_export_requested",
      payload: {
        exportJobId: job.id,
        kind: normalizedInput.kind,
        format: normalizedInput.format,
        fileName: job.fileName,
      },
    });

    reply.code(201);
    return job;
  });
}
