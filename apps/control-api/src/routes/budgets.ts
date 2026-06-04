import type { FastifyInstance, FastifyReply } from "fastify";

import { CreateBudgetPolicyInputSchema, UpdateBudgetPolicyInputSchema } from "@teamops/contracts";
import {
  createBudgetPolicy,
  findActiveBudgetPolicyConflict,
  deleteBudgetPolicy,
  getBudgetPolicySummaryById,
  listBudgetPolicySummaries,
  syncBudgetPolicyAlerts,
  updateBudgetPolicy,
} from "@teamops/database";

import { appendRequestAuditLog } from "../audit.js";
import type { ControlApiContext } from "../context.js";
import { getWorkspaceAccess } from "../permissions.js";
import { getAssignedProjectIdSet } from "../project-scope.js";
import { requireBudgetPolicy, requireEnvironmentInWorkspace, requireProjectInWorkspace, validateResourceId } from "../resource-guards.js";

async function normalizeBudgetScopeInput(
  context: ControlApiContext,
  reply: FastifyReply,
  workspaceId: string,
  scope: {
    projectId: string | null;
    environmentId: string | null;
    environment: "development" | "staging" | "production" | null;
  },
) {
  if (scope.projectId) {
    const project = await requireProjectInWorkspace(context.db, reply, scope.projectId, workspaceId);
    if ("error" in project) {
      return project;
    }
  }

  if (!scope.environmentId) {
    return scope;
  }

  const environment = await requireEnvironmentInWorkspace(context.db, reply, scope.environmentId, workspaceId);
  if ("error" in environment) {
    return environment;
  }

  if (scope.projectId && scope.projectId !== environment.projectId) {
    reply.code(400);
    return {
      error: {
        message: "Environment does not belong to the selected project",
      },
    };
  }

  return {
    ...scope,
    projectId: environment.projectId,
    environment: environment.runtime,
  };
}

function buildScopeConflictMessage() {
  return {
    error: {
      message: "An active budget policy already exists for this exact scope",
    },
  };
}

function buildProjectBudgetScopeError(message: string) {
  return {
    error: {
      message,
    },
  };
}

function getBudgetExceptionAuditAction(
  previousStatus: "none" | "requested" | "approved" | "rejected",
  nextStatus: "none" | "requested" | "approved" | "rejected",
) {
  if (previousStatus === nextStatus) {
    return null;
  }

  if (nextStatus === "requested") {
    return "budget.exception_requested";
  }

  if (nextStatus === "approved") {
    return "budget.exception_approved";
  }

  if (nextStatus === "rejected") {
    return "budget.exception_rejected";
  }

  return "budget.exception_cleared";
}

export async function registerBudgetRoutes(app: FastifyInstance, context: ControlApiContext) {
  app.get("/v1/budgets", async (request, reply) => {
    const query = request.query as { workspaceId?: string };
    if (!query.workspaceId) {
      return { items: [] };
    }

    const validationError = validateResourceId(reply, "workspace", query.workspaceId);
    if (validationError) {
      return validationError;
    }

    const access = await getWorkspaceAccess(context, request, reply, "budget.read", query.workspaceId);
    if ("error" in access) {
      return access;
    }

    const scopedProjectIds = await getAssignedProjectIdSet(context, access);
    const items = await listBudgetPolicySummaries(context.db, query.workspaceId);

    return {
      items: scopedProjectIds ? items.filter((budget) => budget.projectId && scopedProjectIds.has(budget.projectId)) : items,
    };
  });

  app.post("/v1/budgets", async (request, reply) => {
    const input = CreateBudgetPolicyInputSchema.parse(request.body);
    const access = await getWorkspaceAccess(context, request, reply, "budget.write", input.workspaceId);
    if ("error" in access) {
      return access;
    }

    const normalizedScope = await normalizeBudgetScopeInput(context, reply, input.workspaceId, {
      projectId: input.projectId,
      environmentId: input.environmentId,
      environment: input.environment,
    });
    if ("error" in normalizedScope) {
      return normalizedScope;
    }

    const scopedProjectIds = await getAssignedProjectIdSet(context, access);
    if (scopedProjectIds) {
      if (!normalizedScope.projectId) {
        reply.code(403);
        return buildProjectBudgetScopeError("Assignment-scoped members can only create project-scoped budgets");
      }

      if (!scopedProjectIds.has(normalizedScope.projectId)) {
        reply.code(403);
        return buildProjectBudgetScopeError("This budget scope is outside the current assigned project scope");
      }
    }

    const conflictingBudget = await findActiveBudgetPolicyConflict(context.db, {
      workspaceId: input.workspaceId,
      projectId: normalizedScope.projectId,
      environmentId: normalizedScope.environmentId,
      environment: normalizedScope.environment,
    });
    if (conflictingBudget) {
      reply.code(409);
      return buildScopeConflictMessage();
    }

    const normalizedInput = {
      ...input,
      ...normalizedScope,
    };

    const budget = await createBudgetPolicy(context.db, normalizedInput);

    await appendRequestAuditLog(context.db, request, {
      workspaceId: budget.workspaceId,
      projectId: budget.projectId,
      environmentId: budget.environmentId,
      action: "budget.created",
      subjectType: "budget-policy",
      subjectId: budget.id,
      payload: {
        monthlyUsdLimit: budget.monthlyUsdLimit,
        softLimitPercent: budget.softLimitPercent,
      },
    });

    reply.code(201);
    return budget;
  });

  app.patch("/v1/budgets/:budgetPolicyId", async (request, reply) => {
    const params = request.params as { budgetPolicyId: string };
    const input = UpdateBudgetPolicyInputSchema.parse(request.body);
    const existingBudget = await requireBudgetPolicy(context.db, reply, params.budgetPolicyId);
    if ("error" in existingBudget) {
      return existingBudget;
    }

    const access = await getWorkspaceAccess(
      context,
      request,
      reply,
      "budget.write",
      existingBudget.workspaceId,
    );
    if ("error" in access) {
      return access;
    }

    const scopedProjectIds = await getAssignedProjectIdSet(context, access);
    if (scopedProjectIds && (!existingBudget.projectId || !scopedProjectIds.has(existingBudget.projectId))) {
      reply.code(403);
      return buildProjectBudgetScopeError("This budget is outside the current assigned project scope");
    }

    if (input.projectId === null && input.environmentId === undefined && existingBudget.environmentId) {
      reply.code(400);
      return {
        error: {
          message: "Cannot clear project scope while an environment scope is still attached",
        },
      };
    }

    const normalizedScope = await normalizeBudgetScopeInput(context, reply, existingBudget.workspaceId, {
      projectId: input.projectId === undefined ? existingBudget.projectId : input.projectId,
      environmentId: input.environmentId === undefined ? existingBudget.environmentId : input.environmentId,
      environment:
        input.environmentId === null && input.environment === undefined
          ? null
          : input.environment === undefined
            ? existingBudget.environment
            : input.environment,
    });
    if ("error" in normalizedScope) {
      return normalizedScope;
    }

    if (scopedProjectIds) {
      if (!normalizedScope.projectId) {
        reply.code(403);
        return buildProjectBudgetScopeError("Assignment-scoped members can only keep project-scoped budgets");
      }

      if (!scopedProjectIds.has(normalizedScope.projectId)) {
        reply.code(403);
        return buildProjectBudgetScopeError("This budget scope is outside the current assigned project scope");
      }
    }

    if ((input.status ?? existingBudget.status) === "active") {
      const conflictingBudget = await findActiveBudgetPolicyConflict(
        context.db,
        {
          workspaceId: existingBudget.workspaceId,
          projectId: normalizedScope.projectId,
          environmentId: normalizedScope.environmentId,
          environment: normalizedScope.environment,
        },
        existingBudget.id,
      );
      if (conflictingBudget) {
        reply.code(409);
        return buildScopeConflictMessage();
      }
    }

    const budget = await updateBudgetPolicy(context.db, params.budgetPolicyId, {
      ...input,
      projectId:
        input.projectId !== undefined || input.environmentId !== undefined ? normalizedScope.projectId : input.projectId,
      environmentId: input.environmentId !== undefined ? normalizedScope.environmentId : input.environmentId,
      environment:
        input.environment !== undefined || input.environmentId !== undefined ? normalizedScope.environment : input.environment,
    });

    if (!budget) {
      reply.code(404);
      return {
        error: {
          message: "Budget policy not found",
        },
      };
    }

    await appendRequestAuditLog(context.db, request, {
      workspaceId: budget.workspaceId,
      projectId: budget.projectId,
      environmentId: budget.environmentId,
      action:
        getBudgetExceptionAuditAction(existingBudget.exceptionStatus, budget.exceptionStatus) ?? "budget.updated",
      subjectType: "budget-policy",
      subjectId: budget.id,
      payload: {
        ...input,
        previousExceptionStatus: existingBudget.exceptionStatus,
        nextExceptionStatus: budget.exceptionStatus,
      },
    });

    const scopeChanged =
      budget.projectId !== existingBudget.projectId ||
      budget.environmentId !== existingBudget.environmentId ||
      budget.environment !== existingBudget.environment;
    const budgetSummary = scopeChanged ? null : await getBudgetPolicySummaryById(context.db, budget.id);

    await syncBudgetPolicyAlerts(context.db, {
      budgetPolicyId: budget.id,
      summary: budgetSummary,
    });

    return budget;
  });

  app.delete("/v1/budgets/:budgetPolicyId", async (request, reply) => {
    const params = request.params as { budgetPolicyId: string };
    const existingBudget = await requireBudgetPolicy(context.db, reply, params.budgetPolicyId);
    if ("error" in existingBudget) {
      return existingBudget;
    }

    const access = await getWorkspaceAccess(
      context,
      request,
      reply,
      "budget.write",
      existingBudget.workspaceId,
    );
    if ("error" in access) {
      return access;
    }

    const scopedProjectIds = await getAssignedProjectIdSet(context, access);
    if (scopedProjectIds && (!existingBudget.projectId || !scopedProjectIds.has(existingBudget.projectId))) {
      reply.code(403);
      return buildProjectBudgetScopeError("This budget is outside the current assigned project scope");
    }

    const budget = await deleteBudgetPolicy(context.db, params.budgetPolicyId);
    if (!budget) {
      reply.code(404);
      return {
        error: {
          message: "Budget policy not found",
        },
      };
    }

    await appendRequestAuditLog(context.db, request, {
      workspaceId: budget.workspaceId,
      projectId: budget.projectId,
      environmentId: budget.environmentId,
      action: "budget.deleted",
      subjectType: "budget-policy",
      subjectId: budget.id,
      payload: {
        monthlyUsdLimit: budget.monthlyUsdLimit,
        softLimitPercent: budget.softLimitPercent,
        status: budget.status,
      },
    });

    await syncBudgetPolicyAlerts(context.db, {
      budgetPolicyId: budget.id,
      summary: null,
    });

    reply.code(204);
    return null;
  });
}
