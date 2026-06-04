import type { FastifyInstance, FastifyReply } from "fastify";

import {
  CreateWorkspaceInputSchema,
  PromptPolicySchema,
  UpdateWorkspaceInputSchema,
  UpdatePromptPolicyInputSchema,
  WorkspaceOptionSchema,
  WorkspaceHomeSnapshotSchema,
  WorkspaceHomeOverviewSchema,
  memberUsesProjectAssignments,
  roleHasPermission,
  WorkspaceSetupSummarySchema,
} from "@teamops/contracts";
import {
  createWorkspace,
  deleteWorkspace,
  getPromptPolicyByWorkspaceId,
  getUsageEventDailySeries,
  getUsageEventSummary,
  listAlerts,
  listAuditLogs,
  listBudgetPolicySummaries,
  listEnvironmentsByWorkspace,
  listMemberProjectAssignments,
  listMembers,
  listOrganizationSummariesByMemberEmail,
  listProviderConnections,
  listProjects,
  listUsageEvents,
  listVirtualKeys,
  listWorkspaces,
  listWorkspaceOptions,
  listWorkspacesByOrganizationAndMemberEmail,
  upsertPromptPolicy,
  updateWorkspace,
} from "@teamops/database";

import { appendRequestAuditLog } from "../audit.js";
import type { ControlApiContext } from "../context.js";
import { getMemberSelfScopeFilters } from "../member-self-scope.js";
import { getWorkspaceAccess, hasAdminAccess, requireAdminAccess } from "../permissions.js";
import { getAssignedProjectIdSet } from "../project-scope.js";
import { getRequestScopedEmail } from "../request-auth.js";
import { isUuidLike, requireOrganization, requireWorkspace } from "../resource-guards.js";

function invalidQueryParameter(reply: FastifyReply, parameter: string) {
  reply.code(400);
  return {
    error: {
      message: `Invalid ${parameter}`,
    },
  };
}

function getCurrentMonthStartIso(now = new Date()) {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  ).toISOString();
}

function getAlertBudgetPolicyId(alert: { metadata: Record<string, unknown> }) {
  const value = alert.metadata.budgetPolicyId;
  return typeof value === "string" && value.trim() ? value : null;
}

function isBlockingBudgetAlert(alert: { code: string }) {
  return (
    alert.code === "budget.hard-limit" ||
    alert.code === "budget.preflight-block" ||
    alert.code === "budget.pricing-unavailable"
  );
}

function createEmptyUsageSummary() {
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

function buildWorkspaceSetupStepDefinitions(workspaceId: string) {
  const workspaceQuery = `workspaceId=${workspaceId}`;
  return [
    {
      id: "project_environment",
      title: "Project & environment",
      description: "Create at least one active project and environment.",
      primaryHref: `/projects?${workspaceQuery}`,
    },
    {
      id: "provider_connection",
      title: "Provider connection",
      description: "Connect and test at least one provider.",
      primaryHref: `/providers?${workspaceQuery}`,
    },
    {
      id: "virtual_key",
      title: "Virtual key",
      description: "Issue at least one active virtual key.",
      primaryHref: `/virtual-keys?${workspaceQuery}`,
    },
    {
      id: "members",
      title: "Members",
      description: "Invite at least one member to the workspace.",
      primaryHref: `/members?${workspaceQuery}`,
    },
    {
      id: "project_assignment",
      title: "Project assignment",
      description: "Assign all scoped members to at least one project.",
      primaryHref: `/members?${workspaceQuery}&task=assign-projects`,
    },
    {
      id: "ready_for_handoff",
      title: "Ready for handoff",
      description: "Confirm the workspace is ready for daily operations.",
      primaryHref: `/?${workspaceQuery}`,
    },
  ] as const;
}

async function listWorkspaceOptionsForMember(context: ControlApiContext, memberEmail: string) {
  const organizations = await listOrganizationSummariesByMemberEmail(context.db, memberEmail);
  const workspacesByOrganization = await Promise.all(
    organizations.map(async (organization) => ({
      organizationName: organization.name,
      workspaces: await listWorkspacesByOrganizationAndMemberEmail(context.db, organization.id, memberEmail),
    })),
  );

  return workspacesByOrganization.flatMap(({ organizationName, workspaces }) =>
    workspaces.map((workspace) =>
      WorkspaceOptionSchema.parse({
        ...workspace,
        organizationName,
      }),
    ),
  );
}

export async function registerWorkspaceRoutes(app: FastifyInstance, context: ControlApiContext) {
  app.get("/v1/workspace-options", async (request, reply) => {
    try {
      if (hasAdminAccess(context, request)) {
        return {
          items: await listWorkspaceOptions(context.db),
        };
      }

      const memberEmail = await getRequestScopedEmail(context, request);
      if (!memberEmail) {
        reply.code(401);
        return {
          error: {
            code: "AUTH_REQUIRED",
            message: "Authentication is required for this route",
          },
        };
      }

      return {
        items: await listWorkspaceOptionsForMember(context, memberEmail),
      };
    } catch (error) {
      request.log.error(error);
      reply.code(503);
      return {
        error: {
          message: "Workspace options are temporarily unavailable",
        },
      };
    }
  });

  app.get("/v1/workspaces/:workspaceId/home-overview", async (request, reply) => {
    const params = request.params as { workspaceId: string };
    const validationError = isUuidLike(params.workspaceId)
      ? null
      : invalidQueryParameter(reply, "workspace id");
    if (validationError) {
      return validationError;
    }

    const access = await getWorkspaceAccess(
      context,
      request,
      reply,
      "workspace.read",
      params.workspaceId,
    );
    if ("error" in access) {
      return access;
    }

    const canReadProjects =
      access.isAdmin ||
      (roleHasPermission(access.member.role, "project.read") &&
        roleHasPermission(access.member.role, "environment.read"));
    const canReadBudgets =
      access.isAdmin ||
      (roleHasPermission(access.member.role, "budget.read") &&
        roleHasPermission(access.member.role, "alert.read"));
    const canReadUsage =
      access.isAdmin || roleHasPermission(access.member.role, "usage.read");
    const canReadProviders =
      access.isAdmin || roleHasPermission(access.member.role, "provider.read");
    const canReadVirtualKeys =
      access.isAdmin || roleHasPermission(access.member.role, "virtual_key.read");
    const canReadAudit =
      access.isAdmin || roleHasPermission(access.member.role, "audit_log.read");
    const canReadExports =
      access.isAdmin ||
      roleHasPermission(access.member.role, "export.read") ||
      roleHasPermission(access.member.role, "export.write");
    const canReadMembers =
      access.isAdmin || roleHasPermission(access.member.role, "member.read");
    const canSelfServeVirtualKeys =
      !access.isAdmin &&
      access.member.role === "developer";
    const canReadPromptInspections =
      access.isAdmin || roleHasPermission(access.member.role, "prompt_inspection.read");
    const canReviewPromptInspections =
      access.isAdmin || roleHasPermission(access.member.role, "prompt_inspection.write");
    const canWritePromptPolicy =
      access.isAdmin || roleHasPermission(access.member.role, "prompt_policy.write");
    const assignedProjectIds = await getAssignedProjectIdSet(context, access);
    const memberSelfScopeFilters = getMemberSelfScopeFilters(access);

    const [
      projectData,
      budgetData,
      usageSummary,
    ] = await Promise.all([
      canReadProjects
        ? Promise.all([
            listProjects(context.db, params.workspaceId),
            listEnvironmentsByWorkspace(context.db, params.workspaceId),
          ])
        : Promise.resolve(null),
      canReadBudgets
        ? Promise.all([
            listBudgetPolicySummaries(context.db, params.workspaceId),
            listAlerts(context.db, {
              workspaceId: params.workspaceId,
              status: "open",
            }),
          ])
        : Promise.resolve(null),
      canReadUsage
        ? assignedProjectIds
          ? !assignedProjectIds.size
            ? Promise.resolve({
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
              })
            : getUsageEventSummary(context.db, {
                workspaceId: params.workspaceId,
                projectIds: [...assignedProjectIds],
                virtualKeyOwner: memberSelfScopeFilters?.owner,
                issuedByMemberId: memberSelfScopeFilters?.issuedByMemberId,
                from: new Date(getCurrentMonthStartIso()),
              })
          : getUsageEventSummary(context.db, {
              workspaceId: params.workspaceId,
              virtualKeyOwner: memberSelfScopeFilters?.owner,
              issuedByMemberId: memberSelfScopeFilters?.issuedByMemberId,
              from: new Date(getCurrentMonthStartIso()),
            })
        : Promise.resolve(null),
    ]);

    const projects = projectData?.[0] ?? [];
    const environments = projectData?.[1] ?? [];
    const visibleProjects = assignedProjectIds
      ? projects.filter((project) => assignedProjectIds.has(project.id))
      : projects;
    const visibleEnvironments = assignedProjectIds
      ? environments.filter((environment) =>
          assignedProjectIds.has(environment.projectId),
        )
      : environments;

    const budgets = budgetData?.[0] ?? [];
    const alerts = budgetData?.[1] ?? [];
    const visibleBudgets = assignedProjectIds
      ? budgets.filter(
          (budget) => budget.projectId && assignedProjectIds.has(budget.projectId),
        )
      : budgets;
    const activeBudgetIds = new Set(
      visibleBudgets
        .filter((budget) => budget.status === "active")
        .map((budget) => budget.id),
    );
    const visibleOpenBudgetAlerts = alerts.filter((alert) => {
      const budgetPolicyId = getAlertBudgetPolicyId(alert);
      return budgetPolicyId ? activeBudgetIds.has(budgetPolicyId) : false;
    });

    return WorkspaceHomeOverviewSchema.parse({
      workspaceId: params.workspaceId,
      permissions: {
        projects: canReadProjects,
        budgets: canReadBudgets,
        usage: canReadUsage,
        providers: canReadProviders,
        virtualKeys: canReadVirtualKeys,
        selfServeVirtualKeys: canSelfServeVirtualKeys,
        auditLogs: canReadAudit,
        exports: canReadExports,
        members: canReadMembers,
        promptInspections: canReadPromptInspections,
        promptInspectionReview: canReviewPromptInspections,
        promptPolicyWrite: canWritePromptPolicy,
      },
      projectCount: canReadProjects ? visibleProjects.length : null,
      environmentCount: canReadProjects ? visibleEnvironments.length : null,
      budgetSummary: canReadBudgets
        ? {
            activeBudgetCount: visibleBudgets.filter(
              (budget) => budget.status === "active",
            ).length,
            openBudgetAlertCount: visibleOpenBudgetAlerts.length,
            blockingBudgetAlertCount: visibleOpenBudgetAlerts.filter(
              isBlockingBudgetAlert,
            ).length,
          }
        : null,
      usageSummary,
    });
  });

  app.get("/v1/workspaces/:workspaceId/home-snapshot", async (request, reply) => {
    const params = request.params as { workspaceId: string };
    const validationError = isUuidLike(params.workspaceId)
      ? null
      : invalidQueryParameter(reply, "workspace id");
    if (validationError) {
      return validationError;
    }

    const access = await getWorkspaceAccess(
      context,
      request,
      reply,
      "workspace.read",
      params.workspaceId,
    );
    if ("error" in access) {
      return access;
    }

    const canReadProjects =
      access.isAdmin ||
      (roleHasPermission(access.member.role, "project.read") &&
        roleHasPermission(access.member.role, "environment.read"));
    const canReadBudgets =
      access.isAdmin ||
      (roleHasPermission(access.member.role, "budget.read") &&
        roleHasPermission(access.member.role, "alert.read"));
    const canReadUsage =
      access.isAdmin || roleHasPermission(access.member.role, "usage.read");
    const canReadProviders =
      access.isAdmin || roleHasPermission(access.member.role, "provider.read");
    const canReadVirtualKeys =
      access.isAdmin || roleHasPermission(access.member.role, "virtual_key.read");
    const canSelfServeVirtualKeys =
      !access.isAdmin &&
      access.member.role === "developer";
    const canReadAudit =
      access.isAdmin || roleHasPermission(access.member.role, "audit_log.read");
    const canReadExports =
      access.isAdmin ||
      roleHasPermission(access.member.role, "export.read") ||
      roleHasPermission(access.member.role, "export.write");
    const canReadMembers =
      access.isAdmin || roleHasPermission(access.member.role, "member.read");
    const canReadPromptInspections =
      access.isAdmin || roleHasPermission(access.member.role, "prompt_inspection.read");
    const canReviewPromptInspections =
      access.isAdmin || roleHasPermission(access.member.role, "prompt_inspection.write");
    const canWritePromptPolicy =
      access.isAdmin || roleHasPermission(access.member.role, "prompt_policy.write");
    const assignedProjectIds = await getAssignedProjectIdSet(context, access);
    const memberSelfScopeFilters = getMemberSelfScopeFilters(access);
    const scopedProjectIds =
      assignedProjectIds && assignedProjectIds.size ? [...assignedProjectIds] : [];
    const noAssignedProjectScope =
      assignedProjectIds !== null && assignedProjectIds.size === 0;

    const [
      projectData,
      budgetData,
      usageSummary,
      providerConnections,
      virtualKeys,
      recentUsage,
      recentAudit,
      dailyUsageItems,
      activationAuditEntries,
    ] = await Promise.all([
      canReadProjects
        ? Promise.all([
            listProjects(context.db, params.workspaceId),
            listEnvironmentsByWorkspace(context.db, params.workspaceId),
          ])
        : Promise.resolve(null),
      canReadBudgets
        ? Promise.all([
            listBudgetPolicySummaries(context.db, params.workspaceId),
            listAlerts(context.db, {
              workspaceId: params.workspaceId,
              status: "open",
            }),
          ])
        : Promise.resolve(null),
      canReadUsage
        ? noAssignedProjectScope
          ? Promise.resolve(createEmptyUsageSummary())
          : assignedProjectIds
            ? getUsageEventSummary(context.db, {
                workspaceId: params.workspaceId,
                projectIds: scopedProjectIds,
                virtualKeyOwner: memberSelfScopeFilters?.owner,
                issuedByMemberId: memberSelfScopeFilters?.issuedByMemberId,
                from: new Date(getCurrentMonthStartIso()),
              })
            : getUsageEventSummary(context.db, {
                workspaceId: params.workspaceId,
                virtualKeyOwner: memberSelfScopeFilters?.owner,
                issuedByMemberId: memberSelfScopeFilters?.issuedByMemberId,
                from: new Date(getCurrentMonthStartIso()),
              })
        : Promise.resolve(null),
      canReadProviders
        ? listProviderConnections(context.db, params.workspaceId)
        : Promise.resolve([]),
      canReadVirtualKeys
        ? noAssignedProjectScope
          ? Promise.resolve({
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
            })
          : listVirtualKeys(context.db, {
              workspaceId: params.workspaceId,
              projectIds: assignedProjectIds ? scopedProjectIds : undefined,
              owner: memberSelfScopeFilters?.owner,
              issuedByMemberId: memberSelfScopeFilters?.issuedByMemberId,
              limit: 50,
              offset: 0,
            })
        : Promise.resolve({
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
          }),
      canReadUsage
        ? noAssignedProjectScope
          ? Promise.resolve({ items: [], total: 0 })
          : listUsageEvents(context.db, {
              workspaceId: params.workspaceId,
              projectIds: assignedProjectIds ? scopedProjectIds : undefined,
              virtualKeyOwner: memberSelfScopeFilters?.owner,
              issuedByMemberId: memberSelfScopeFilters?.issuedByMemberId,
              limit: 6,
              offset: 0,
            })
        : Promise.resolve({ items: [], total: 0 }),
      canReadAudit
        ? noAssignedProjectScope
          ? Promise.resolve({ items: [], total: 0 })
          : listAuditLogs(context.db, {
              workspaceId: params.workspaceId,
              projectIds: assignedProjectIds ? scopedProjectIds : undefined,
              actorId: memberSelfScopeFilters?.owner,
              limit: 6,
              offset: 0,
            })
        : Promise.resolve({ items: [], total: 0 }),
      canReadUsage
        ? noAssignedProjectScope
          ? Promise.resolve([])
          : getUsageEventDailySeries(context.db, {
              workspaceId: params.workspaceId,
              projectIds: assignedProjectIds ? scopedProjectIds : undefined,
              virtualKeyOwner: memberSelfScopeFilters?.owner,
              issuedByMemberId: memberSelfScopeFilters?.issuedByMemberId,
            })
        : Promise.resolve([]),
      canReadAudit
        ? Promise.all(
            [
              "workspace.onboarding.first_provider_connected",
              "workspace.onboarding.first_provider_tested",
              "workspace.onboarding.first_virtual_key_created",
              "workspace.onboarding.first_export_requested",
            ].map(async (action) => ({
              action,
              entry: noAssignedProjectScope
                ? null
                : (
                    await listAuditLogs(context.db, {
                      workspaceId: params.workspaceId,
                      projectIds: assignedProjectIds ? scopedProjectIds : undefined,
                      actorId: memberSelfScopeFilters?.owner,
                      action,
                      limit: 1,
                      offset: 0,
                    })
                  ).items[0] ?? null,
            })),
          )
        : Promise.resolve(
            [
              "workspace.onboarding.first_provider_connected",
              "workspace.onboarding.first_provider_tested",
              "workspace.onboarding.first_virtual_key_created",
              "workspace.onboarding.first_export_requested",
            ].map((action) => ({
              action,
              entry: null,
            })),
          ),
    ]);

    const projects = projectData?.[0] ?? [];
    const environments = projectData?.[1] ?? [];
    const visibleProjects = assignedProjectIds
      ? projects.filter((project) => assignedProjectIds.has(project.id))
      : projects;
    const visibleEnvironments = assignedProjectIds
      ? environments.filter((environment) =>
          assignedProjectIds.has(environment.projectId),
        )
      : environments;

    const budgets = budgetData?.[0] ?? [];
    const alerts = budgetData?.[1] ?? [];
    const visibleBudgets = assignedProjectIds
      ? budgets.filter(
          (budget) => budget.projectId && assignedProjectIds.has(budget.projectId),
        )
      : budgets;
    const activeBudgetIds = new Set(
      visibleBudgets
        .filter((budget) => budget.status === "active")
        .map((budget) => budget.id),
    );
    const visibleOpenBudgetAlerts = alerts.filter((alert) => {
      const budgetPolicyId = getAlertBudgetPolicyId(alert);
      return budgetPolicyId ? activeBudgetIds.has(budgetPolicyId) : false;
    });

    return WorkspaceHomeSnapshotSchema.parse({
      workspaceId: params.workspaceId,
      overview: WorkspaceHomeOverviewSchema.parse({
        workspaceId: params.workspaceId,
        permissions: {
          projects: canReadProjects,
          budgets: canReadBudgets,
          usage: canReadUsage,
          providers: canReadProviders,
          virtualKeys: canReadVirtualKeys,
          selfServeVirtualKeys: canSelfServeVirtualKeys,
          auditLogs: canReadAudit,
          exports: canReadExports,
          members: canReadMembers,
          promptInspections: canReadPromptInspections,
          promptInspectionReview: canReviewPromptInspections,
          promptPolicyWrite: canWritePromptPolicy,
        },
        projectCount: canReadProjects ? visibleProjects.length : null,
        environmentCount: canReadProjects ? visibleEnvironments.length : null,
        budgetSummary: canReadBudgets
          ? {
              activeBudgetCount: visibleBudgets.filter(
                (budget) => budget.status === "active",
              ).length,
              openBudgetAlertCount: visibleOpenBudgetAlerts.length,
              blockingBudgetAlertCount: visibleOpenBudgetAlerts.filter(
                isBlockingBudgetAlert,
              ).length,
            }
          : null,
        usageSummary,
      }),
      providerConnections,
      virtualKeys,
      recentUsage,
      recentAudit,
      budgetSummaries: visibleBudgets,
      openAlerts: visibleOpenBudgetAlerts,
      dailyUsage: {
        window: 30,
        items: dailyUsageItems,
      },
      activationAuditEntries,
    });
  });

  app.get("/v1/workspaces/:workspaceId/setup-summary", async (request, reply) => {
    const params = request.params as { workspaceId: string };
    const validationError = isUuidLike(params.workspaceId)
      ? null
      : invalidQueryParameter(reply, "workspace id");
    if (validationError) {
      return validationError;
    }

    const access = await getWorkspaceAccess(
      context,
      request,
      reply,
      "workspace.read",
      params.workspaceId,
    );
    if ("error" in access) {
      return access;
    }

    const canReadProjects =
      access.isAdmin ||
      (roleHasPermission(access.member.role, "project.read") &&
        roleHasPermission(access.member.role, "environment.read"));
    const canReadProviders =
      access.isAdmin || roleHasPermission(access.member.role, "provider.read");
    const canReadVirtualKeys =
      access.isAdmin || roleHasPermission(access.member.role, "virtual_key.read");
    const canReadMembers =
      access.isAdmin || roleHasPermission(access.member.role, "member.read");

    const [
      projectData,
      providerConnections,
      virtualKeyInventory,
      members,
      assignments,
    ] = await Promise.all([
      canReadProjects
        ? Promise.all([
            listProjects(context.db, params.workspaceId),
            listEnvironmentsByWorkspace(context.db, params.workspaceId),
          ])
        : Promise.resolve<[[], []]>([[], []]),
      canReadProviders
        ? listProviderConnections(context.db, params.workspaceId)
        : Promise.resolve([]),
      canReadVirtualKeys
        ? listVirtualKeys(context.db, {
            workspaceId: params.workspaceId,
            owner: getMemberSelfScopeFilters(access)?.owner,
            issuedByMemberId: getMemberSelfScopeFilters(access)?.issuedByMemberId,
            limit: 1,
            offset: 0,
          })
        : Promise.resolve({
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
          }),
      canReadMembers
        ? listMembers(context.db, params.workspaceId)
        : Promise.resolve([]),
      canReadMembers
        ? listMemberProjectAssignments(context.db, params.workspaceId)
        : Promise.resolve([]),
    ]);

    const projects = projectData?.[0] ?? [];
    const environments = projectData?.[1] ?? [];
    const activeProjects = projects.filter((project) => project.status === "active");
    const activeEnvironments = environments.filter(
      (environment) => environment.status === "active",
    );
    const activeProviders = providerConnections.filter(
      (connection) => connection.status === "active",
    );
    const readyProviders = providerConnections.filter(
      (connection) =>
        connection.status === "active" && connection.lastTestStatus === "passed",
    );
    const activeVirtualKeyCount = virtualKeyInventory.summary.active;
    const activeMembers = members.filter((member) => member.status !== "disabled");
    const scopedMembers = activeMembers.filter((member) =>
      memberUsesProjectAssignments(member),
    );
    const assignmentsByMember = new Map<string, number>();
    for (const assignment of assignments) {
      assignmentsByMember.set(
        assignment.memberId,
        (assignmentsByMember.get(assignment.memberId) ?? 0) + 1,
      );
    }
    const scopedMembersWithoutProjects = scopedMembers.filter(
      (member) => (assignmentsByMember.get(member.id) ?? 0) === 0,
    ).length;

    const counts = {
      projectCount: activeProjects.length,
      environmentCount: activeEnvironments.length,
      activeProviderCount: activeProviders.length,
      readyProviderCount: readyProviders.length,
      activeVirtualKeyCount,
      memberCount: activeMembers.length,
      scopedMembersWithoutProjects,
    };

    const stepCompletion = {
      project_environment: counts.projectCount > 0 && counts.environmentCount > 0,
      provider_connection: counts.activeProviderCount > 0 && counts.readyProviderCount > 0,
      virtual_key: counts.activeVirtualKeyCount > 0,
      members: counts.memberCount > 0,
      project_assignment: counts.scopedMembersWithoutProjects === 0,
      ready_for_handoff: false,
    } as const;

    const stepOrder = [
      "project_environment",
      "provider_connection",
      "virtual_key",
      "members",
      "project_assignment",
    ] as const;
    const nextStepId = stepOrder.find((stepId) => !stepCompletion[stepId]) ?? null;
    const mode = nextStepId ? "setup" : "ready";

    const steps = buildWorkspaceSetupStepDefinitions(params.workspaceId).map((step) => {
      if (step.id === "ready_for_handoff") {
        return {
          ...step,
          status: mode === "ready" ? "done" : "pending",
        };
      }

      const isDone = stepCompletion[step.id];
      const status = isDone ? "done" : step.id === nextStepId ? "next" : "pending";
      return {
        ...step,
        status,
      };
    });

    return WorkspaceSetupSummarySchema.parse({
      workspaceId: params.workspaceId,
      mode,
      nextStepId,
      steps,
      counts,
    });
  });

  app.get("/v1/workspaces", async (request, reply) => {
    const query = request.query as { organizationId?: string };
    if (!query.organizationId) {
      return { items: [] };
    }

    if (!isUuidLike(query.organizationId)) {
      return invalidQueryParameter(reply, "organization id");
    }

    try {
      if (hasAdminAccess(context, request)) {
        return {
          items: await listWorkspaces(context.db, query.organizationId),
        };
      }

      const memberEmail = await getRequestScopedEmail(context, request);
      if (!memberEmail) {
        reply.code(401);
        return {
          error: {
            code: "AUTH_REQUIRED",
            message: "Authentication is required for this route",
          },
        };
      }

      return {
        items: await listWorkspacesByOrganizationAndMemberEmail(context.db, query.organizationId, memberEmail),
      };
    } catch (error) {
      request.log.error(error);
      reply.code(503);
      return {
        error: {
          message: "Workspace list is temporarily unavailable",
        },
      };
    }
  });

  app.post("/v1/workspaces", async (request, reply) => {
    const permissionError = requireAdminAccess(context, request, reply);
    if (permissionError) {
      return permissionError;
    }

    const input = CreateWorkspaceInputSchema.parse(request.body);
    const organization = await requireOrganization(context.db, reply, input.organizationId);
    if ("error" in organization) {
      return organization;
    }

    const workspace = await createWorkspace(context.db, input);

    await appendRequestAuditLog(context.db, request, {
      workspaceId: workspace.id,
      action: "workspace.created",
      subjectType: "workspace",
      subjectId: workspace.id,
      payload: workspace,
    });

    reply.code(201);
    return workspace;
  });

  app.patch("/v1/workspaces/:workspaceId", async (request, reply) => {
    const permissionError = requireAdminAccess(context, request, reply);
    if (permissionError) {
      return permissionError;
    }

    const params = request.params as { workspaceId: string };
    const input = UpdateWorkspaceInputSchema.parse(request.body);
    const workspace = await requireWorkspace(context.db, reply, params.workspaceId);
    if ("error" in workspace) {
      return workspace;
    }

    const updatedWorkspace = await updateWorkspace(context.db, workspace.id, input);
    if (!updatedWorkspace) {
      reply.code(404);
      return {
        error: {
          message: "Workspace not found",
        },
      };
    }

    await appendRequestAuditLog(context.db, request, {
      workspaceId: updatedWorkspace.id,
      action: "workspace.updated",
      subjectType: "workspace",
      subjectId: updatedWorkspace.id,
      payload: input,
    });

    return updatedWorkspace;
  });

  app.get("/v1/workspaces/:workspaceId/prompt-policy", async (request, reply) => {
    const params = request.params as { workspaceId: string };
    const validationError = isUuidLike(params.workspaceId)
      ? null
      : invalidQueryParameter(reply, "workspace id");
    if (validationError) {
      return validationError;
    }

    const access = await getWorkspaceAccess(
      context,
      request,
      reply,
      "prompt_policy.write",
      params.workspaceId,
    );
    if ("error" in access) {
      return access;
    }

    return PromptPolicySchema.parse(
      await getPromptPolicyByWorkspaceId(context.db, params.workspaceId),
    );
  });

  app.patch("/v1/workspaces/:workspaceId/prompt-policy", async (request, reply) => {
    const params = request.params as { workspaceId: string };
    const validationError = isUuidLike(params.workspaceId)
      ? null
      : invalidQueryParameter(reply, "workspace id");
    if (validationError) {
      return validationError;
    }

    const access = await getWorkspaceAccess(
      context,
      request,
      reply,
      "prompt_policy.write",
      params.workspaceId,
    );
    if ("error" in access) {
      return access;
    }

    const input = UpdatePromptPolicyInputSchema.parse(request.body);
    const policy = await upsertPromptPolicy(context.db, params.workspaceId, input);

    await appendRequestAuditLog(context.db, request, {
      workspaceId: params.workspaceId,
      action: "prompt_policy.updated",
      subjectType: "workspace",
      subjectId: params.workspaceId,
      payload: input,
    });

    return PromptPolicySchema.parse(policy);
  });

  app.delete("/v1/workspaces/:workspaceId", async (request, reply) => {
    const permissionError = requireAdminAccess(context, request, reply);
    if (permissionError) {
      return permissionError;
    }

    const params = request.params as { workspaceId: string };
    const workspace = await requireWorkspace(context.db, reply, params.workspaceId);
    if ("error" in workspace) {
      return workspace;
    }

    const removedWorkspace = await deleteWorkspace(context.db, workspace.id);
    if (!removedWorkspace) {
      reply.code(404);
      return {
        error: {
          message: "Workspace not found",
        },
      };
    }

    await appendRequestAuditLog(context.db, request, {
      workspaceId: null,
      action: "workspace.deleted",
      subjectType: "workspace",
      subjectId: removedWorkspace.id,
      payload: removedWorkspace,
    });

    reply.code(204);
    return null;
  });
}
