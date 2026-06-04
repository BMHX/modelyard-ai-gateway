import type { Alert, Environment, Project } from "@teamops/contracts";
import { buildContextualHref, getSafeReturnTo } from "../lib/navigation";

export function getAlertMetadataRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {} as Record<string, unknown>;
  }

  return value as Record<string, unknown>;
}

export function getAlertMetadataString(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === "string" ? value : null;
}

export function getAlertMetadataNumber(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function getAlertMetadataBoolean(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === "boolean" ? value : null;
}

type AlertScopeInfoArgs = {
  alert: Alert;
  projectsById?: Map<string, Project>;
  environmentsById?: Map<string, Environment>;
};

export function getAlertScopeInfo({ alert, projectsById, environmentsById }: AlertScopeInfoArgs) {
  const metadata = getAlertMetadataRecord(alert.metadata);
  const metadataProjectId = getAlertMetadataString(metadata, "projectId");
  const metadataEnvironmentId = getAlertMetadataString(metadata, "environmentId");
  const metadataRuntime = getAlertMetadataString(metadata, "environment");
  const budgetPolicyId = getAlertMetadataString(metadata, "budgetPolicyId");
  const rawScopeKind = getAlertMetadataString(metadata, "scopeKind");
  const scopeKind =
    rawScopeKind === "environment" || rawScopeKind === "project" || rawScopeKind === "workspace"
      ? rawScopeKind
      : metadataEnvironmentId || metadataRuntime
        ? "environment"
        : metadataProjectId
          ? "project"
          : "workspace";
  const environment = metadataEnvironmentId ? environmentsById?.get(metadataEnvironmentId) ?? null : null;
  const project =
    (environment ? projectsById?.get(environment.projectId) ?? null : null) ??
    (metadataProjectId ? projectsById?.get(metadataProjectId) ?? null : null);
  const projectId = project?.id ?? metadataProjectId;
  const projectName = project?.name ?? metadataProjectId;
  const environmentId = environment?.id ?? metadataEnvironmentId;
  const environmentName = environment?.name ?? metadataEnvironmentId;
  const environmentRuntime = environment?.runtime ?? metadataRuntime;

  const label =
    scopeKind === "environment"
      ? `environment / ${environmentName ?? environmentRuntime ?? "unknown"}${
          environmentName && environmentRuntime ? ` (${environmentRuntime})` : ""
        }`
      : scopeKind === "project"
        ? `project / ${projectName ?? "unknown"}`
        : "workspace";

  return {
    metadata,
    budgetPolicyId,
    scopeKind,
    projectId,
    projectName,
    environmentId,
    environmentName,
    environmentRuntime,
    label,
  };
}

export function buildAlertUsageFilters(alert: Alert) {
  const metadata = getAlertMetadataRecord(alert.metadata);
  const budgetPolicyId = getAlertMetadataString(metadata, "budgetPolicyId");
  const status =
    alert.code === "budget.preflight-block" ||
    alert.code === "budget.hard-limit" ||
    alert.code === "budget.pricing-unavailable"
      ? "blocked"
      : null;

  return {
    requestId: getAlertMetadataString(metadata, "requestId"),
    providerRequestId: getAlertMetadataString(metadata, "providerRequestId"),
    projectId: getAlertMetadataString(metadata, "projectId"),
    environmentId: getAlertMetadataString(metadata, "environmentId"),
    budgetPolicyId,
    model: getAlertMetadataString(metadata, "model"),
    status,
  } as const;
}

export function buildAlertUsageHref(alert: Alert, returnTo?: string | null) {
  const params = new URLSearchParams();
  const safeReturnTo = getSafeReturnTo(returnTo);
  params.set("workspaceId", alert.workspaceId);

  const filters = buildAlertUsageFilters(alert);
  if (filters.requestId) {
    params.set("requestId", filters.requestId);
  }
  if (filters.providerRequestId) {
    params.set("providerRequestId", filters.providerRequestId);
  }
  if (filters.projectId) {
    params.set("projectId", filters.projectId);
  }
  if (filters.environmentId) {
    params.set("environmentId", filters.environmentId);
  }
  if (filters.budgetPolicyId) {
    params.set("budgetPolicyId", filters.budgetPolicyId);
  }
  if (filters.model) {
    params.set("model", filters.model);
  }
  if (filters.status) {
    params.set("status", filters.status);
  }
  if (safeReturnTo) {
    params.set("returnTo", safeReturnTo);
  }

  return `/usage-events?${params.toString()}`;
}

export function buildAlertAuditHref(alert: Alert, returnTo?: string | null) {
  const params = new URLSearchParams();
  params.set("workspaceId", alert.workspaceId);
  params.set("subjectType", "alert");
  params.set("subjectId", alert.id);
  return buildContextualHref(`/audit-logs?${params.toString()}`, returnTo);
}

export function buildAlertBudgetsHref(alert: Alert, returnTo?: string | null) {
  const metadata = getAlertMetadataRecord(alert.metadata);
  const budgetPolicyId = getAlertMetadataString(metadata, "budgetPolicyId");
  const params = new URLSearchParams();
  params.set("workspaceId", alert.workspaceId);

  if (budgetPolicyId) {
    params.set("budgetPolicyId", budgetPolicyId);
  }

  const query = params.toString();
  return buildContextualHref(
    budgetPolicyId ? `/budgets?${query}#budget-${budgetPolicyId}` : `/budgets?${query}`,
    returnTo,
  );
}

export function describeAlertUsageFilters(
  alert: Alert,
  context?: {
    projectsById?: Map<string, Project>;
    environmentsById?: Map<string, Environment>;
  },
) {
  const filters = buildAlertUsageFilters(alert);
  const scope = getAlertScopeInfo({
    alert,
    projectsById: context?.projectsById,
    environmentsById: context?.environmentsById,
  });
  const parts = [
    filters.requestId ? `gw ${filters.requestId}` : null,
    filters.providerRequestId ? `upstream ${filters.providerRequestId}` : null,
    filters.budgetPolicyId ? `budget ${filters.budgetPolicyId}` : null,
    scope.scopeKind !== "workspace" ? scope.label : null,
    filters.model,
    filters.status,
  ].filter(Boolean);

  return parts.length ? parts.join(" · ") : "workspace-wide recent events";
}
