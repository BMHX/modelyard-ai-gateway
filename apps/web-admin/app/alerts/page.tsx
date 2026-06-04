"use client";

import { CompactToolbar, FilterField } from "../components/resource-compact-toolbar";
import { ClipboardList, Plus, Siren, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import type { Environment, Project } from "@teamops/contracts";

import { Link } from "@/i18n/navigation";
import { EmptyState } from "@/components/shared/empty-state";
import { OpsLinkCard } from "@/components/shared/ops-link-card";
import { SectionHeader } from "@/components/shared/section-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

import { AppShell } from "../components/app-shell";
import { ControlApiStatusCard } from "../components/control-api-status-card";
import { DisclosureSummary } from "../components/disclosure-summary";
import { LazyDisclosureSection } from "../components/lazy-disclosure-section";
import { AlertsQueueWorkspace } from "./alerts-queue-workspace";
import { useAlertsPageQuery } from "../lib/console-api-client";
import enAlertsMessages from "../messages/en/alerts.json";
import zhAlertsMessages from "../messages/zh/alerts.json";
import { localizeHref, translateInlineText, type AppLocale } from "../lib/i18n";
import { useLocalePreference } from "../lib/i18n-client";
import { buildAlertHref, buildContextualHref, getSafeReturnTo } from "../lib/navigation";
import { formatEnvironmentOptionLabel } from "../lib/resource-scope";
import { buildAlertCollaborationState } from "./collaboration";
import {
  buildAlertAuditHref,
  buildAlertBudgetsHref,
  buildAlertUsageHref,
  getAlertMetadataRecord,
  getAlertScopeInfo,
} from "./presentation";

const projectStatusOrder = {
  active: 0,
  archived: 1,
} satisfies Record<Project["status"], number>;

const environmentStatusOrder = {
  active: 0,
  archived: 1,
} satisfies Record<Environment["status"], number>;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type AlertAckFilter = "all" | "needs-ack" | "acknowledged" | "resolved";
type AlertQueueLane =
  | "all"
  | "needs-ack"
  | "unassigned"
  | "handoff-gap"
  | "missing-note"
  | "missing-runbook"
  | "missing-ticket"
  | "aging"
  | "escalation-risk";

type AlertFilters = {
  workspaceId: string;
  projectId?: string | null;
  environmentId?: string | null;
  q?: string | null;
  owner?: string | null;
  ackState?: AlertAckFilter | null;
  queueLane?: AlertQueueLane | null;
  status?: "open" | "resolved" | null;
  severity?: "info" | "warning" | "critical" | null;
  code?: string | null;
  budgetPolicyId?: string | null;
  returnTo?: string | null;
};

type TranslationValues = Record<string, string | number | undefined>

function formatMessage(template: string, values?: TranslationValues) {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? `{${key}}`));
}

function resolveAlertMessage(messages: Record<string, unknown>, key: string): string | null {
  const exact = messages[key];
  if (typeof exact === "string") return exact;
  if (exact && typeof exact === "object" && "" in exact && typeof (exact as Record<string, unknown>)[""] === "string") {
    return (exact as unknown as Record<string, string>)[""];
  }

  const nested = key.split(".").reduce<unknown>((current, part) => {
    if (!current || typeof current !== "object" || !(part in (current as Record<string, unknown>))) {
      return null;
    }
    return (current as Record<string, unknown>)[part];
  }, messages);

  if (typeof nested === "string") return nested;
  if (nested && typeof nested === "object" && "" in nested && typeof (nested as Record<string, unknown>)[""] === "string") {
    return (nested as unknown as Record<string, string>)[""];
  }
  return null;
}

function createAlertsTranslator(locale: AppLocale) {
  const messages = (locale === "zh" ? zhAlertsMessages : enAlertsMessages) as Record<string, unknown>;
  return (text: string, values?: TranslationValues) => {
    const fallback = typeof values?.default === "string" ? values.default : text;
    const template = resolveAlertMessage(messages, text) ?? translateInlineText(locale, fallback);
    return formatMessage(template, values);
  };
}

function getOptionalFilter(value: string | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function getOptionalUuidFilter(value: string | undefined) {
  const normalized = getOptionalFilter(value);
  return normalized && uuidPattern.test(normalized) ? normalized : null;
}

function getIntlLocale(locale: AppLocale) {
  return locale === "zh" ? "zh-CN" : "en-US";
}

function createFormatters(locale: AppLocale) {
  const intlLocale = getIntlLocale(locale);

  return {
    compareLabels(left: string, right: string) {
      return left.localeCompare(right, intlLocale);
    },
    formatDateTime(value: string) {
      return new Intl.DateTimeFormat(intlLocale, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value));
    },
  };
}

const alertFilterLabelClassName = "text-[12px] font-medium text-muted-foreground";
const alertFilterControlClassName =
  "h-10 w-full min-w-0 rounded-md border border-border/60 bg-background px-3 text-sm text-foreground shadow-none outline-none transition-[border-color,background-color,box-shadow] placeholder:text-muted-foreground focus-visible:border-[color:var(--border-strong)] focus-visible:ring-2 focus-visible:ring-ring/30";

function getAlertAckFilter(value: string | undefined): AlertAckFilter {
  return value === "needs-ack" || value === "acknowledged" || value === "resolved" ? value : "all";
}

function getAlertQueueLane(value: string | undefined): AlertQueueLane {
  return value === "needs-ack" ||
      value === "unassigned" ||
      value === "handoff-gap" ||
      value === "missing-note" ||
      value === "missing-runbook" ||
      value === "missing-ticket" ||
      value === "aging" ||
      value === "escalation-risk"
    ? value
    : "all";
}

function buildAlertsHref(filters: AlertFilters) {
  const params = new URLSearchParams();
  const safeReturnTo = getSafeReturnTo(filters.returnTo);

  if (filters.workspaceId) {
    params.set("workspaceId", filters.workspaceId);
  }
  if (filters.projectId) {
    params.set("projectId", filters.projectId);
  }
  if (filters.environmentId) {
    params.set("environmentId", filters.environmentId);
  }
  if (filters.q) {
    params.set("q", filters.q);
  }
  if (filters.owner) {
    params.set("owner", filters.owner);
  }
  if (filters.ackState && filters.ackState !== "all") {
    params.set("ackState", filters.ackState);
  }
  if (filters.queueLane && filters.queueLane !== "all") {
    params.set("queueLane", filters.queueLane);
  }
  if (filters.status) {
    params.set("status", filters.status);
  }
  if (filters.severity) {
    params.set("severity", filters.severity);
  }
  if (filters.code) {
    params.set("code", filters.code);
  }
  if (filters.budgetPolicyId) {
    params.set("budgetPolicyId", filters.budgetPolicyId);
  }
  if (safeReturnTo) {
    params.set("returnTo", safeReturnTo);
  }

  const query = params.toString();
  return query ? `/alerts?${query}` : "/alerts";
}

function buildUsageEvidenceHref(args: {
  workspaceId: string;
  projectId?: string | null;
  environmentId?: string | null;
  budgetPolicyId?: string | null;
  outcome?: "attention" | "blocked" | "error" | null;
  returnTo?: string | null;
}) {
  const params = new URLSearchParams();
  params.set("workspaceId", args.workspaceId);

  if (args.projectId) {
    params.set("projectId", args.projectId);
  }
  if (args.environmentId) {
    params.set("environmentId", args.environmentId);
  }
  if (args.budgetPolicyId) {
    params.set("budgetPolicyId", args.budgetPolicyId);
  }
  if (args.outcome) {
    params.set("outcome", args.outcome);
  }

  return buildContextualHref(`/usage-events?${params.toString()}`, args.returnTo);
}

function buildAuditEvidenceHref(args: {
  workspaceId: string;
  projectId?: string | null;
  environmentId?: string | null;
  budgetPolicyId?: string | null;
  returnTo?: string | null;
}) {
  const params = new URLSearchParams();
  params.set("workspaceId", args.workspaceId);

  if (args.projectId) {
    params.set("projectId", args.projectId);
  }
  if (args.environmentId) {
    params.set("environmentId", args.environmentId);
  }
  if (args.budgetPolicyId) {
    params.set("subjectType", "budget-policy");
    params.set("subjectId", args.budgetPolicyId);
  }

  return buildContextualHref(`/audit-logs?${params.toString()}`, args.returnTo);
}

function buildExportEvidenceHref(args: {
  workspaceId: string;
  projectId?: string | null;
  environmentId?: string | null;
  budgetPolicyId?: string | null;
  returnTo?: string | null;
}) {
  const params = new URLSearchParams();
  params.set("workspaceId", args.workspaceId);
  params.set("kind", "audit-logs");

  if (args.projectId) {
    params.set("projectId", args.projectId);
  }
  if (args.environmentId) {
    params.set("environmentId", args.environmentId);
  }
  if (args.budgetPolicyId) {
    params.set("budgetPolicyId", args.budgetPolicyId);
  }

  return buildContextualHref(`/exports?${params.toString()}`, args.returnTo);
}

function buildScopeMeta(
  scopeInfo: ReturnType<typeof getAlertScopeInfo>,
  tr: (text: string, values?: TranslationValues) => string,
) {
  const parts = [
    scopeInfo.scopeKind === "environment" && scopeInfo.projectName
      ? tr("scopeMeta.project", { project: scopeInfo.projectName })
      : null,
    scopeInfo.scopeKind === "project" && scopeInfo.environmentRuntime
      ? tr("scopeMeta.runtime", { runtime: scopeInfo.environmentRuntime })
      : null,
  ].filter(Boolean);

  return parts.length ? parts.join(" · ") : tr("scopeMeta.workspace");
}

function buildCurrentViewSummary(
  args: {
    project: Project | null;
    environment: Environment | null;
    budgetPolicyId: string | null;
    owner: string | null;
    ackState: AlertAckFilter;
    queueLane: AlertQueueLane;
    status: "open" | "resolved" | null;
    severity: "info" | "warning" | "critical" | null;
  },
  locale: AppLocale,
  tr: (text: string, values?: TranslationValues) => string,
) {
  const segments = [
    args.project
      ? tr("currentViewSummary.project", { project: translateInlineText(locale, args.project.name) || args.project.name })
      : null,
    args.environment
      ? tr("currentViewSummary.environment", {
          environment: translateInlineText(locale, args.environment.name) || args.environment.name,
          runtime: translateInlineText(locale, args.environment.runtime) || args.environment.runtime,
        })
      : null,
    args.budgetPolicyId ? tr("currentViewSummary.budget", { budget: args.budgetPolicyId }) : null,
    args.owner ? tr("currentViewSummary.owner", { owner: args.owner }) : null,
    args.ackState !== "all" ? tr("currentViewSummary.ack", { ack: tr(args.ackState) }) : null,
    args.queueLane !== "all" ? tr("currentViewSummary.queueLane", { lane: tr(args.queueLane) }) : null,
    args.status ? tr("currentViewSummary.status", { status: tr(args.status) }) : null,
    args.severity
      ? tr("currentViewSummary.severity", {
          severity: tr(args.severity === "critical" ? "Critical" : args.severity === "warning" ? "Warning" : "Info"),
        })
      : null,
  ].filter((segment): segment is string => Boolean(segment));

  return segments.length ? segments.join(" · ") : tr("All alerts");
}

function getPositiveCount(value: string | undefined) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : 0;
}

function getAlertMetadataString(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === "string" && value.trim().length ? value.trim() : null;
}

function buildQueueActionNotice(action: string | undefined, count: number, failedCount: number, message: string | null | undefined, tr: (text: string, values?: TranslationValues) => string) {
  if (action === "assigned" && count > 0) {
    return {
      className: "notice notice--success",
      title: tr("queueNotice.assigned.title", { count }),
      body: tr("queueNotice.assigned.body"),
    };
  }

  if (action === "acknowledged" && count > 0) {
    return {
      className: "notice notice--success",
      title: tr("queueNotice.ack.title", { count }),
      body: tr("queueNotice.ack.body"),
    };
  }

  if (action === "resolved" && count > 0) {
    return {
      className: "notice notice--success",
      title: tr("queueNotice.resolved.title", { count }),
      body: tr("queueNotice.resolved.body"),
    };
  }

  if (action === "assigned-partial" && count > 0 && failedCount > 0) {
    return {
      className: "notice notice--error",
      title: tr("queueNotice.partial.assigned.title", { count, failed: failedCount }),
      body: message ? tr(message) : tr("queueNotice.partial.assigned.body"),
    };
  }

  if (action === "acknowledged-partial" && count > 0 && failedCount > 0) {
    return {
      className: "notice notice--error",
      title: tr("queueNotice.partial.ack.title", { count, failed: failedCount }),
      body: message ? tr(message) : tr("queueNotice.partial.ack.body"),
    };
  }

  if (action === "resolved-partial" && count > 0 && failedCount > 0) {
    return {
      className: "notice notice--error",
      title: tr("queueNotice.partial.resolved.title", { count, failed: failedCount }),
      body: message ? tr(message) : tr("queueNotice.partial.resolved.body"),
    };
  }

  if (action === "owner-required") {
    return {
      className: "notice notice--error",
      title: tr("queueNotice.ownerRequired.title"),
      body: tr("queueNotice.ownerRequired.body"),
    };
  }

  if (action === "selection-required") {
    return {
      className: "notice notice--error",
      title: tr("queueNotice.selectionRequired.title"),
      body: tr("queueNotice.selectionRequired.body"),
    };
  }

  if (action === "batch-error") {
    return {
      className: "notice notice--error",
      title: tr("queueNotice.batchError.title"),
      body: message ? tr(message) : tr("queueNotice.batchError.body"),
    };
  }

  return null;
}

function getSurfaceToneClassName(tone: "critical" | "warning" | "resolved") {
  if (tone === "critical") {
    return "surface-link surface-link--critical";
  }

  if (tone === "warning") {
    return "surface-link surface-link--warning";
  }

  return "surface-link surface-link--resolved";
}

function getToneClassName(tone: "critical" | "warning" | "resolved") {
  if (tone === "critical") {
    return "tag tag--critical";
  }

  if (tone === "warning") {
    return "tag tag--warning";
  }

  return "tag tag--resolved";
}

function getOpsTone(tone: "critical" | "warning" | "resolved") {
  if (tone === "critical") {
    return "critical" as const;
  }

  if (tone === "warning") {
    return "warning" as const;
  }

  return "neutral" as const;
}

function formatHoursLabel(hoursOpen: number) {
  if (hoursOpen < 24) {
    return `${hoursOpen}h`;
  }

  const days = Math.floor(hoursOpen / 24);
  const remainingHours = hoursOpen % 24;
  return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
}

function getAlertAgeThresholdHours(severity: "info" | "warning" | "critical") {
  if (severity === "critical") {
    return {
      warning: 1,
      critical: 4,
    };
  }

  if (severity === "warning") {
    return {
      warning: 12,
      critical: 24,
    };
  }

  return {
    warning: 24,
    critical: 48,
  };
}

function getAlertAgeState(alert: { createdAt: string; severity: "info" | "warning" | "critical"; status: "open" | "resolved" }, tr: (text: string, values?: TranslationValues) => string) {
  const createdAt = Date.parse(alert.createdAt);
  const ageHours =
    Number.isFinite(createdAt) && alert.status === "open" ? Math.max(0, Math.floor((Date.now() - createdAt) / (60 * 60 * 1000))) : 0;
  const thresholds = getAlertAgeThresholdHours(alert.severity);

  if (alert.status === "resolved") {
    return {
      ageHours,
      className: "tag tag--resolved",
      label: tr("age.resolved.label", { default: "resolved" }),
      summary: tr("age.resolved.summary", { default: "This incident is already closed and no longer aging inside the live queue." }),
      isAging: false,
      isStale: false,
    };
  }

  if (ageHours >= thresholds.critical) {
    return {
      ageHours,
      className: "tag tag--critical",
      label: tr("age.critical.label", { time: formatHoursLabel(ageHours), default: `aging ${formatHoursLabel(ageHours)}` }),
      summary: tr("age.critical.summary", { time: formatHoursLabel(ageHours), threshold: thresholds.critical, severity: alert.severity, default: `Open for ${formatHoursLabel(ageHours)}. This is past the ${thresholds.critical}h age threshold for ${alert.severity} incidents.` }),
      isAging: true,
      isStale: true,
    };
  }

  if (ageHours >= thresholds.warning) {
    return {
      ageHours,
      className: "tag tag--warning",
      label: tr("age.warning.label", { time: formatHoursLabel(ageHours), default: `aging ${formatHoursLabel(ageHours)}` }),
      summary: tr("age.warning.summary", { time: formatHoursLabel(ageHours), severity: alert.severity, default: `Open for ${formatHoursLabel(ageHours)}. This is inside the warning window for ${alert.severity} incidents.` }),
      isAging: true,
      isStale: false,
    };
  }

  return {
    ageHours,
    className: "tag",
    label: tr("age.fresh.label", { time: formatHoursLabel(ageHours), default: `fresh ${formatHoursLabel(ageHours)}` }),
    summary: tr("age.fresh.summary", { time: formatHoursLabel(ageHours), default: `Open for ${formatHoursLabel(ageHours)} and still inside the normal response window.` }),
    isAging: false,
    isStale: false,
  };
}

function getAlertEscalationState(args: {
  alert: { severity: "info" | "warning" | "critical"; status: "open" | "resolved" };
  ageHours: number;
  ackState: "needs-ack" | "acknowledged" | "resolved";
  hasOwner: boolean;
  hasNote: boolean;
  hasRunbook: boolean;
  hasTicket: boolean;
  slaTone: "critical" | "warning" | "resolved" | null;
  tr: (text: string, values?: TranslationValues) => string;
}) {
  if (args.alert.status === "resolved") {
    return {
      className: "tag tag--resolved",
      label: args.tr("escalation.closed.label"),
      summary: args.tr("escalation.closed.summary"),
      isEscalationRisk: false,
    };
  }

  const reasons: string[] = [];
  let tone: "critical" | "warning" | "resolved" = "resolved";

  if (args.slaTone === "critical") {
    reasons.push(args.tr("escalation.reason.slaBreached"));
    tone = "critical";
  } else if (args.slaTone === "warning") {
    reasons.push(args.tr("escalation.reason.slaDueSoon"));
    tone = "warning";
  }

  const ackThreshold = args.alert.severity === "critical" ? 1 : 8;
  if (args.ackState === "needs-ack" && args.ageHours >= ackThreshold) {
    reasons.push(args.tr("escalation.reason.firstResponseWaiting"));
    tone = tone === "critical" ? tone : args.alert.severity === "critical" ? "critical" : "warning";
  }

  if (!args.hasOwner && args.ageHours >= 4) {
    reasons.push(args.tr("escalation.reason.ownerMissing"));
    tone = tone === "critical" ? tone : "warning";
  }

  if ((!args.hasNote || !args.hasRunbook || !args.hasTicket) && args.ageHours >= 12) {
    reasons.push(args.tr("escalation.reason.handoffIncomplete"));
    tone = tone === "critical" ? tone : "warning";
  }

  if (!reasons.length) {
    return {
      className: "tag tag--resolved",
      label: args.tr("escalation.stable.label"),
      summary: args.tr("escalation.stable.summary"),
      isEscalationRisk: false,
    };
  }

  return {
    className: getToneClassName(tone),
    label: tone === "critical" ? args.tr("escalation.active.critical") : args.tr("escalation.active.warning"),
    summary: reasons.join(" · "),
    isEscalationRisk: true,
  };
}

export default function AlertsPage() {
  const [hasMounted, setHasMounted] = useState(false);
  const { locale } = useLocalePreference();
  const searchParams = useSearchParams() ?? new URLSearchParams();
  const [searchState, setSearchState] = useState(() => searchParams.toString());
  const currentSearchParams = useMemo(() => new URLSearchParams(searchState), [searchState]);
  const tr = createAlertsTranslator(locale);
  const { compareLabels, formatDateTime } = createFormatters(locale);
  const returnTo = getSafeReturnTo(currentSearchParams.get("returnTo"));
  const query = getOptionalFilter(currentSearchParams.get("q") ?? undefined);
  const owner = getOptionalFilter(currentSearchParams.get("owner") ?? undefined);
  const ackStateFilter = getAlertAckFilter(currentSearchParams.get("ackState") ?? undefined);
  const queueLaneFilter = getAlertQueueLane(currentSearchParams.get("queueLane") ?? undefined);
  const requestedWorkspaceId = getOptionalFilter(currentSearchParams.get("workspaceId") ?? undefined);
  const alertsPageQuery = useAlertsPageQuery({
    workspaceId: requestedWorkspaceId,
    projectId: getOptionalFilter(currentSearchParams.get("projectId") ?? undefined),
    environmentId: getOptionalFilter(currentSearchParams.get("environmentId") ?? undefined),
    status: currentSearchParams.get("status"),
    severity: currentSearchParams.get("severity"),
    code: getOptionalFilter(currentSearchParams.get("code") ?? undefined),
    budgetPolicyId: getOptionalUuidFilter(currentSearchParams.get("budgetPolicyId") ?? undefined),
  });
  const response = alertsPageQuery.data;
  const workspaceOptions = response?.workspaceOptions ?? [];
  const selectedWorkspaceId = response?.selectedWorkspaceId ?? null;
  const selectionStatus = response?.selectionStatus ?? "needs-selection";
  let alertsIssue = response?.alertsIssue ?? response?.issue ?? null;
  const hasInvalidWorkspaceSelection =
    selectionStatus === "invalid" || alertsIssue?.resource === "workspace-selection";

  useEffect(() => {
    setHasMounted(true);
  }, []);

  function replaceAlertSearchParams(updates: Record<string, string | null>) {
    const nextParams = new URLSearchParams(currentSearchParams.toString());

    Object.entries(updates).forEach(([key, value]) => {
      if (value === null || value === "") {
        nextParams.delete(key);
        return;
      }

      nextParams.set(key, value);
    });

    const nextSearch = nextParams.toString();
    if (nextSearch === searchState) {
      return;
    }

    setSearchState(nextSearch);

    if (typeof window === "undefined") {
      return;
    }

    const href = localizeHref(`/alerts${nextSearch ? `?${nextSearch}` : ""}`, locale);
    window.history.replaceState(window.history.state, "", `${href}${window.location.hash}`);
  }

  if (!hasMounted || (alertsPageQuery.isLoading && !response)) {
    return (
      <AppShell title={tr("Alerts")} subtitle="">
        <section className="space-y-4">
          <div className="rounded-lg border border-border/55 bg-[color:color-mix(in_srgb,var(--surface-1)_96%,var(--surface-canvas)_4%)] px-4 py-5">
            <div className="space-y-2">
              <div className="h-4 w-24 animate-pulse rounded-full bg-foreground/10" />
              <div className="h-3.5 w-72 max-w-full animate-pulse rounded-full bg-foreground/8" />
            </div>
          </div>
        </section>
      </AppShell>
    );
  }

  if (!selectedWorkspaceId) {
    return (
      <AppShell title={tr("Alerts")} subtitle="">
        <section className="legacy-grid">
          {alertsIssue ? (
            <ControlApiStatusCard
              issue={alertsIssue}
              heading={
                hasInvalidWorkspaceSelection
                  ? tr("Alert workspace is invalid")
                  : tr("Alert workspace context is unavailable")
              }
            />
          ) : null}
          <article className="card span-12">
            <EmptyState
              description={
                hasInvalidWorkspaceSelection
                  ? (locale === "zh"
                      ? "当前链接中的工作区无效，请直接使用页头中的全局工作区切换器。"
                      : "The workspace in this link is invalid. Use the global workspace switcher in the header.")
                  : alertsIssue
                    ? tr("Alerts are unavailable.")
                    : (locale === "zh"
                        ? "请先在页头选择全局工作区，再查看告警。"
                        : "Choose the active workspace from the header before viewing alerts.")
              }
              title={
                hasInvalidWorkspaceSelection
                  ? tr("Workspace link is invalid")
                  : alertsIssue
                    ? tr("Alert data unavailable")
                    : tr("No workspace selected")
              }
            />
          </article>
        </section>
      </AppShell>
    );
  }

  const projects: Project[] = response?.projects ?? [];
  const environments: Environment[] = response?.environments ?? [];
  const allAlerts = response?.allAlerts ?? [];

  const sortedProjects = [...projects].sort(
    (left, right) =>
      projectStatusOrder[left.status] - projectStatusOrder[right.status] || compareLabels(left.name, right.name),
  );
  const projectNameById = new Map(sortedProjects.map((project) => [project.id, project.name]));
  const sortedEnvironments = [...environments].sort(
    (left, right) =>
      compareLabels(projectNameById.get(left.projectId) ?? "", projectNameById.get(right.projectId) ?? "") ||
      environmentStatusOrder[left.status] - environmentStatusOrder[right.status] ||
      compareLabels(left.name, right.name),
  );

  const rawProjectId = getOptionalFilter(currentSearchParams.get("projectId") ?? undefined);
  const selectedProjectId =
    rawProjectId && sortedProjects.some((project) => project.id === rawProjectId) ? rawProjectId : null;
  const filteredEnvironmentOptions = selectedProjectId
    ? sortedEnvironments.filter((environment) => environment.projectId === selectedProjectId)
    : sortedEnvironments;
  const rawEnvironmentId = getOptionalFilter(currentSearchParams.get("environmentId") ?? undefined);
  const selectedEnvironmentId =
    rawEnvironmentId && filteredEnvironmentOptions.some((environment) => environment.id === rawEnvironmentId)
      ? rawEnvironmentId
      : null;
  const rawStatusParam = currentSearchParams.get("status");
  const rawSeverityParam = currentSearchParams.get("severity");
  const status: "open" | "resolved" | null =
    rawStatusParam === "open" || rawStatusParam === "resolved"
      ? rawStatusParam
      : null;
  const severity: "info" | "warning" | "critical" | null =
    rawSeverityParam === "info" ||
    rawSeverityParam === "warning" ||
    rawSeverityParam === "critical"
      ? rawSeverityParam
      : null;
  const code = getOptionalFilter(currentSearchParams.get("code") ?? undefined);
  const budgetPolicyId = getOptionalUuidFilter(currentSearchParams.get("budgetPolicyId") ?? undefined);
  const selectedWorkspace =
    workspaceOptions.find((workspace) => workspace.id === selectedWorkspaceId) ?? null;
  const alerts = response?.alerts ?? [];

  const pageFilters: AlertFilters = {
    workspaceId: selectedWorkspaceId,
    projectId: selectedProjectId,
    environmentId: selectedEnvironmentId,
    q: query,
    owner,
    ackState: ackStateFilter,
    queueLane: queueLaneFilter,
    status,
    severity,
    code,
    budgetPolicyId,
    returnTo,
  };
  const redirectPath = buildAlertsHref(pageFilters);
  const projectsById = new Map(sortedProjects.map((project) => [project.id, project]));
  const environmentsById = new Map(sortedEnvironments.map((environment) => [environment.id, environment]));
  const alertCodes = [...new Set(allAlerts.map((alert) => alert.code))].sort((left, right) => compareLabels(left, right));
  const selectedProject = selectedProjectId ? projectsById.get(selectedProjectId) ?? null : null;
  const selectedEnvironment = selectedEnvironmentId ? environmentsById.get(selectedEnvironmentId) ?? null : null;
  const clearFiltersHref = buildAlertsHref({ workspaceId: selectedWorkspaceId, returnTo });
  const alertUsageEvidenceHref = buildUsageEvidenceHref({
    workspaceId: selectedWorkspaceId,
    projectId: selectedProjectId,
    environmentId: selectedEnvironmentId,
    budgetPolicyId,
    outcome: "attention",
    returnTo: redirectPath,
  });
  const alertAuditEvidenceHref = buildAuditEvidenceHref({
    workspaceId: selectedWorkspaceId,
    projectId: selectedProjectId,
    environmentId: selectedEnvironmentId,
    budgetPolicyId,
    returnTo: redirectPath,
  });
  const alertExportEvidenceHref = buildExportEvidenceHref({
    workspaceId: selectedWorkspaceId,
    projectId: selectedProjectId,
    environmentId: selectedEnvironmentId,
    budgetPolicyId,
    returnTo: redirectPath,
  });
  const focusedBudgetHref =
    budgetPolicyId
      ? buildContextualHref(
          `/budgets?workspaceId=${selectedWorkspaceId}&budgetPolicyId=${budgetPolicyId}#budget-${budgetPolicyId}`,
          redirectPath,
        )
      : null;
  const alertEntries = alerts.map((alert) => {
    const scopeInfo = getAlertScopeInfo({
      alert,
      projectsById,
      environmentsById,
    });
    const collaboration = buildAlertCollaborationState({
      alert,
      scopeInfo,
      returnTo: redirectPath,
      locale,
    });
    const metadata = alert.metadata && typeof alert.metadata === "object" && !Array.isArray(alert.metadata)
      ? (alert.metadata as Record<string, unknown>)
      : {};
    const hasOwner = Boolean(getAlertMetadataString(metadata, "collaborationOwnerLabel"));
    const hasNote = Boolean(getAlertMetadataString(metadata, "collaborationNote"));
    const hasRunbook = Boolean(getAlertMetadataString(metadata, "collaborationRunbookHref"));
    const hasTicket = Boolean(getAlertMetadataString(metadata, "collaborationTicketHref"));
    const ageState = getAlertAgeState(alert, tr);

    return {
      alert,
      scopeInfo,
      collaboration,
      hasOwner,
      hasNote,
      hasRunbook,
      hasTicket,
      ageState,
      escalationState: getAlertEscalationState({
        alert,
        ageHours: ageState.ageHours,
        ackState: collaboration.ackState,
        hasOwner,
        hasNote,
        hasRunbook,
        hasTicket,
        slaTone: collaboration.slaTone ?? null,
        tr,
      }),
    };
  });
  const activeFilterChips = [
    selectedProject
      ? {
          label: tr("Project"),
          value: selectedProject.name,
          onRemove: () => replaceAlertSearchParams({ projectId: null, environmentId: null }),
        }
      : null,
    selectedEnvironment
      ? {
          label: tr("Environment"),
          value: formatEnvironmentOptionLabel(selectedEnvironment, locale),
          onRemove: () => replaceAlertSearchParams({ environmentId: null }),
        }
      : null,
    status
      ? {
          label: tr("Status"),
          value: tr(status),
          onRemove: () => replaceAlertSearchParams({ status: null }),
        }
      : null,
    severity
      ? {
          label: tr("Severity"),
          value: tr(severity),
          onRemove: () => replaceAlertSearchParams({ severity: null }),
        }
      : null,
    code
      ? {
          label: tr("Code"),
          value: code,
          onRemove: () => replaceAlertSearchParams({ code: null }),
        }
      : null,
    budgetPolicyId
      ? {
          label: tr("Budget policy"),
          value: budgetPolicyId,
          onRemove: () => replaceAlertSearchParams({ budgetPolicyId: null }),
        }
      : null,
    owner
      ? {
          label: tr("Owner"),
          value: owner,
          onRemove: () => replaceAlertSearchParams({ owner: null }),
        }
      : null,
    ackStateFilter !== "all"
      ? {
          label: tr("Ack"),
          value: tr(ackStateFilter),
          onRemove: () => replaceAlertSearchParams({ ackState: null }),
        }
      : null,
    queueLaneFilter !== "all"
      ? {
          label: tr("Queue lane"),
          value: tr(queueLaneFilter),
          onRemove: () => replaceAlertSearchParams({ queueLane: null }),
        }
      : null,
    query
      ? {
          label: tr("Search"),
          value: query,
          onRemove: () => replaceAlertSearchParams({ q: null }),
        }
      : null,
  ].filter((chip): chip is { label: string; value: string; onRemove: () => void } => Boolean(chip));
  const visibleActiveFilterChips = activeFilterChips.slice(0, 6);
  const hiddenActiveFilterChipCount = Math.max(0, activeFilterChips.length - visibleActiveFilterChips.length);
  const secondaryFilterCount = [
    owner,
    ackStateFilter !== "all" ? ackStateFilter : null,
    code,
    budgetPolicyId,
    queueLaneFilter !== "all" ? queueLaneFilter : null,
  ].filter(Boolean).length;
  const severityRank = {
    critical: 0,
    warning: 1,
    info: 2,
  } as const;
  const displayedAlertEntries = alertEntries.filter((entry) => {
    if (owner && !entry.collaboration.ownerLabel.toLowerCase().includes(owner.toLowerCase())) {
      return false;
    }
    if (ackStateFilter !== "all" && entry.collaboration.ackState !== ackStateFilter) {
      return false;
    }
    if (queueLaneFilter === "needs-ack" && entry.collaboration.ackState !== "needs-ack") {
      return false;
    }
    if (queueLaneFilter === "unassigned" && entry.hasOwner) {
      return false;
    }
    if (queueLaneFilter === "handoff-gap" && entry.hasNote && entry.hasRunbook && entry.hasTicket) {
      return false;
    }
    if (queueLaneFilter === "missing-note" && entry.hasNote) {
      return false;
    }
    if (queueLaneFilter === "missing-runbook" && entry.hasRunbook) {
      return false;
    }
    if (queueLaneFilter === "missing-ticket" && entry.hasTicket) {
      return false;
    }
    if (queueLaneFilter === "aging" && (!entry.ageState.isAging || entry.alert.status !== "open")) {
      return false;
    }
    if (queueLaneFilter === "escalation-risk" && (!entry.escalationState.isEscalationRisk || entry.alert.status !== "open")) {
      return false;
    }

    if (!query) {
      return true;
    }

    const scopeInfo = entry.scopeInfo;
    const searchIndex = [
      entry.alert.title,
      entry.alert.body,
      entry.alert.code,
      entry.alert.status,
      entry.alert.severity,
      scopeInfo.label,
      scopeInfo.projectName,
      scopeInfo.environmentName,
      scopeInfo.environmentRuntime,
      scopeInfo.budgetPolicyId,
      entry.collaboration.ownerLabel,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return searchIndex.includes(query.toLowerCase());
  });
  const prioritizedAlertEntries = [...displayedAlertEntries].sort((left, right) => {
    const leftPriority =
      (left.alert.status === "open" ? 0 : 10) +
      (left.escalationState.isEscalationRisk ? -3 : 0) +
      (left.ageState.isStale ? -2 : left.ageState.isAging ? -1 : 0) +
      (left.collaboration.ackState === "needs-ack" ? -3 : left.collaboration.ackState === "acknowledged" ? 0 : 3) +
      (left.hasOwner ? 0 : -2) +
      (left.hasRunbook ? 0 : -1) +
      (left.hasTicket ? 0 : -1);
    const rightPriority =
      (right.alert.status === "open" ? 0 : 10) +
      (right.escalationState.isEscalationRisk ? -3 : 0) +
      (right.ageState.isStale ? -2 : right.ageState.isAging ? -1 : 0) +
      (right.collaboration.ackState === "needs-ack" ? -3 : right.collaboration.ackState === "acknowledged" ? 0 : 3) +
      (right.hasOwner ? 0 : -2) +
      (right.hasRunbook ? 0 : -1) +
      (right.hasTicket ? 0 : -1);

    return (
      leftPriority - rightPriority ||
      severityRank[left.alert.severity] - severityRank[right.alert.severity] ||
      Date.parse(right.alert.createdAt) - Date.parse(left.alert.createdAt)
    );
  });
  const currentViewOpenCount = displayedAlertEntries.filter((entry) => entry.alert.status === "open").length;
  const currentViewCriticalCount = displayedAlertEntries.filter((entry) => entry.alert.severity === "critical").length;
  const currentViewResolvedCount = displayedAlertEntries.filter((entry) => entry.alert.status === "resolved").length;
  const openUnassignedCount = displayedAlertEntries.filter((entry) => entry.alert.status === "open" && !entry.hasOwner).length;
  const openNeedsAckCount = displayedAlertEntries.filter(
    (entry) => entry.alert.status === "open" && entry.collaboration.ackState === "needs-ack",
  ).length;
  const openMissingRunbookCount = displayedAlertEntries.filter(
    (entry) => entry.alert.status === "open" && !entry.hasRunbook,
  ).length;
  const openMissingTicketCount = displayedAlertEntries.filter(
    (entry) => entry.alert.status === "open" && !entry.hasTicket,
  ).length;
  const openWithoutNoteCount = displayedAlertEntries.filter((entry) => entry.alert.status === "open" && !entry.hasNote).length;
  const openAgingCount = displayedAlertEntries.filter((entry) => entry.alert.status === "open" && entry.ageState.isAging).length;
  const escalationRiskCount = displayedAlertEntries.filter(
    (entry) => entry.alert.status === "open" && entry.escalationState.isEscalationRisk,
  ).length;
  const openHandoffGapCount = displayedAlertEntries.filter(
    (entry) => entry.alert.status === "open" && (!entry.hasNote || !entry.hasRunbook || !entry.hasTicket),
  ).length;
  const scopedWorkspaceAlerts = alertEntries.filter((entry) => {
    return (
      (!selectedProjectId || entry.scopeInfo.projectId === selectedProjectId) &&
      (!selectedEnvironmentId || entry.scopeInfo.environmentId === selectedEnvironmentId) &&
      (!code || entry.alert.code === code) &&
      (!budgetPolicyId || entry.scopeInfo.budgetPolicyId === budgetPolicyId)
    );
  });
  const scopedOpenCount = scopedWorkspaceAlerts.filter((entry) => entry.alert.status === "open").length;
  const scopedResolvedCount = scopedWorkspaceAlerts.filter((entry) => entry.alert.status === "resolved").length;
  const scopedAgingCount = scopedWorkspaceAlerts.filter((entry) => entry.alert.status === "open" && entry.ageState.isAging).length;
  const scopedEscalationCount = scopedWorkspaceAlerts.filter(
    (entry) => entry.alert.status === "open" && entry.escalationState.isEscalationRisk,
  ).length;
  const quickViews = [
    {
      label: tr("Current scope"),
      hint: `${scopedWorkspaceAlerts.length} ${tr("alerts in scope")}`,
      href: buildAlertsHref({
        ...pageFilters,
        status: null,
        severity: null,
      }),
      onClick: () => replaceAlertSearchParams({ status: null, severity: null, ackState: null, queueLane: null }),
      active: status === null && severity === null && ackStateFilter === "all" && queueLaneFilter === "all",
    },
    {
      label: tr("Open queue"),
      hint: `${scopedOpenCount} ${tr("open")}`,
      href: buildAlertsHref({
        ...pageFilters,
        status: "open",
        severity: null,
      }),
      onClick: () => replaceAlertSearchParams({ status: "open", severity: null, ackState: null, queueLane: null }),
      active: status === "open" && severity === null && ackStateFilter === "all" && queueLaneFilter === "all",
    },
    {
      label: tr("Needs ack"),
      hint: tr("Awaiting ack"),
      href: buildAlertsHref({
        ...pageFilters,
        status: "open",
        ackState: "needs-ack",
      }),
      onClick: () => replaceAlertSearchParams({ status: "open", ackState: "needs-ack", queueLane: null }),
      active: status === "open" && ackStateFilter === "needs-ack" && severity === null,
    },
    {
      label: tr("Escalation risk"),
      hint: `${scopedEscalationCount} ${tr("escalation")}`,
      href: buildAlertsHref({
        ...pageFilters,
        status: "open",
        severity: null,
        queueLane: "escalation-risk",
      }),
      onClick: () => replaceAlertSearchParams({ status: "open", severity: null, ackState: null, queueLane: "escalation-risk" }),
      active: status === "open" && queueLaneFilter === "escalation-risk",
    },
    {
      label: tr("Aging"),
      hint: `${scopedAgingCount} ${tr("aging")}`,
      href: buildAlertsHref({
        ...pageFilters,
        status: "open",
        severity: null,
        queueLane: "aging",
      }),
      onClick: () => replaceAlertSearchParams({ status: "open", severity: null, ackState: null, queueLane: "aging" }),
      active: status === "open" && queueLaneFilter === "aging",
    },
    {
      label: tr("Unassigned"),
      hint: tr("Unassigned"),
      href: buildAlertsHref({
        ...pageFilters,
        status: "open",
        severity: null,
        queueLane: "unassigned",
      }),
      onClick: () => replaceAlertSearchParams({ status: "open", severity: null, ackState: null, queueLane: "unassigned" }),
      active: status === "open" && queueLaneFilter === "unassigned",
    },
    {
      label: tr("Handoff gaps"),
      hint: tr("Missing handoff info"),
      href: buildAlertsHref({
        ...pageFilters,
        status: "open",
        severity: null,
        queueLane: "handoff-gap",
      }),
      onClick: () => replaceAlertSearchParams({ status: "open", severity: null, ackState: null, queueLane: "handoff-gap" }),
      active: status === "open" && queueLaneFilter === "handoff-gap",
    },
    {
      label: tr("Resolved review"),
      hint: `${scopedResolvedCount} ${tr("resolved")}`,
      href: buildAlertsHref({
        ...pageFilters,
        status: "resolved",
        severity: null,
      }),
      onClick: () => replaceAlertSearchParams({ status: "resolved", severity: null, ackState: null, queueLane: null }),
      active: status === "resolved" && severity === null && ackStateFilter === "all" && queueLaneFilter === "all",
    },
  ];
  const queueActionNotice = buildQueueActionNotice(
    currentSearchParams.get("queueAction") ?? undefined,
    getPositiveCount(currentSearchParams.get("queueCount") ?? undefined),
    getPositiveCount(currentSearchParams.get("queueFailed") ?? undefined),
    getOptionalFilter(currentSearchParams.get("queueMessage") ?? undefined),
    tr,
  );
  const alertTableRows = prioritizedAlertEntries.map((entry) => {
    const { alert, scopeInfo, collaboration } = entry;
    const scopePivotHref = buildAlertsHref({
      ...pageFilters,
      projectId: scopeInfo.projectId ?? null,
      environmentId: scopeInfo.environmentId ?? null,
    });
    const ownerPivotHref = buildAlertsHref({
      ...pageFilters,
      owner: collaboration.ownerLabel,
    });
    const metadataRecord = getAlertMetadataRecord(alert.metadata);

    return {
      id: alert.id,
      title: tr(alert.title),
      body: tr(alert.body),
      severity: alert.severity,
      code: alert.code,
      codeLabel: tr(`alertCode.${alert.code}`, { default: alert.code }),
      status: alert.status,
      createdAtLabel: formatDateTime(alert.createdAt),
      resolvedAtLabel: alert.resolvedAt ? `Resolved ${formatDateTime(alert.resolvedAt)}` : null,
      scopeLabel: tr(scopeInfo.label),
      scopeMeta: buildScopeMeta(scopeInfo, tr),
      ageClassName: entry.ageState.className,
      ageLabel: entry.ageState.label,
      ageSummary: entry.ageState.summary,
      showAgeBadge: entry.ageState.isAging,
      escalationClassName: entry.escalationState.className,
      escalationLabel: entry.escalationState.label,
      escalationSummary: entry.escalationState.summary,
      isEscalationRisk: entry.escalationState.isEscalationRisk,
      isUnassigned: !entry.hasOwner,
      needsAck: collaboration.ackState === "needs-ack",
      detailHref: buildAlertHref(alert.id, redirectPath),
      usageHref: buildAlertUsageHref(alert, redirectPath),
      budgetHref: buildAlertBudgetsHref(alert, redirectPath),
      auditHref: buildAlertAuditHref(alert, redirectPath),
      scopePivotHref,
      onScopePivot: () =>
        replaceAlertSearchParams({
          projectId: scopeInfo.projectId ?? null,
          environmentId: scopeInfo.environmentId ?? null,
        }),
      ownerPivotHref,
      severityPivotHref: buildAlertsHref({
        ...pageFilters,
        severity: alert.severity,
      }),
      onSeverityPivot: () => replaceAlertSearchParams({ severity: alert.severity }),
      codePivotHref: buildAlertsHref({
        ...pageFilters,
        code: alert.code,
      }),
      onCodePivot: () => replaceAlertSearchParams({ code: alert.code }),
      statusPivotHref: buildAlertsHref({
        ...pageFilters,
        status: alert.status,
      }),
      onStatusPivot: () => replaceAlertSearchParams({ status: alert.status }),
      collaboration: {
        ...collaboration,
        slaDueAt: getAlertMetadataString(metadataRecord, "collaborationSlaDueAt") ?? "",
      },
    };
  });
  const alertsWorkbenchStats = [
    {
      label: tr("Open queue"),
      value: String(currentViewOpenCount),
    },
    {
      label: tr("Escalation risk"),
      value: String(escalationRiskCount),
    },
    {
      label: tr("Needs ack"),
      value: String(openNeedsAckCount),
    },
    {
      label: tr("Aging"),
      value: String(openAgingCount),
    },
  ];
  const currentViewRiskLevel =
    escalationRiskCount > 0 || openNeedsAckCount > 0
      ? "critical"
      : openUnassignedCount > 0 || openHandoffGapCount > 0 || openAgingCount > 0
        ? "high"
        : currentViewOpenCount > 0
          ? "medium"
          : "low";
  const currentViewRiskLabel =
    currentViewRiskLevel === "critical"
      ? tr("riskLabel.blocked")
      : currentViewRiskLevel === "high"
        ? tr("riskLabel.watch")
        : currentViewRiskLevel === "medium"
          ? tr("riskLabel.open")
          : tr("riskLabel.clear");
  const primaryQueueAction =
    escalationRiskCount > 0
      ? {
          titleKey: "primaryQueueAction.escalate.title",
          descriptionKey: "primaryQueueAction.escalate.description",
          ctaKey: "primaryQueueAction.escalate.cta",
          href: buildAlertsHref({
            ...pageFilters,
            status: "open",
            severity: null,
            ackState: null,
            queueLane: "escalation-risk",
          }),
          onClick: () => replaceAlertSearchParams({ status: "open", severity: null, ackState: null, queueLane: "escalation-risk" }),
          tone: "critical" as const,
        }
      : openNeedsAckCount > 0
        ? {
            titleKey: "primaryQueueAction.needsAck.title",
            descriptionKey: "primaryQueueAction.needsAck.description",
            ctaKey: "primaryQueueAction.needsAck.cta",
            href: buildAlertsHref({
              ...pageFilters,
              status: "open",
              severity: null,
              ackState: "needs-ack",
              queueLane: null,
            }),
            onClick: () => replaceAlertSearchParams({ status: "open", severity: null, ackState: "needs-ack", queueLane: null }),
            tone: "critical" as const,
          }
        : openUnassignedCount > 0
          ? {
              titleKey: "primaryQueueAction.assignOwners.title",
              descriptionKey: "primaryQueueAction.assignOwners.description",
              ctaKey: "primaryQueueAction.assignOwners.cta",
              href: buildAlertsHref({
                ...pageFilters,
                status: "open",
                severity: null,
                ackState: null,
                queueLane: "unassigned",
              }),
              onClick: () => replaceAlertSearchParams({ status: "open", severity: null, ackState: null, queueLane: "unassigned" }),
              tone: "warning" as const,
            }
          : openHandoffGapCount > 0
            ? {
                titleKey: "primaryQueueAction.fillGaps.title",
                descriptionKey: "primaryQueueAction.fillGaps.description",
                ctaKey: "primaryQueueAction.fillGaps.cta",
                href: buildAlertsHref({
                  ...pageFilters,
                  status: "open",
                  severity: null,
                  ackState: null,
                  queueLane: "handoff-gap",
                }),
                onClick: () => replaceAlertSearchParams({ status: "open", severity: null, ackState: null, queueLane: "handoff-gap" }),
                tone: "warning" as const,
              }
            : currentViewOpenCount > 0
              ? {
                  titleKey: "primaryQueueAction.workOpen.title",
                  descriptionKey: "primaryQueueAction.workOpen.description",
                  ctaKey: "primaryQueueAction.workOpen.cta",
                  href: buildAlertsHref({
                    ...pageFilters,
                    status: "open",
                    severity: null,
                    ackState: null,
                    queueLane: null,
                  }),
                  onClick: () => replaceAlertSearchParams({ status: "open", severity: null, ackState: null, queueLane: null }),
                  tone: "resolved" as const,
                }
              : null;
  const queueLaneEntries = [
    {
      label: tr("Needs ack"),
      count: String(openNeedsAckCount),
      description: tr("Waiting for ack."),
      href: buildAlertsHref({
        ...pageFilters,
        status: "open",
        severity: null,
        ackState: "needs-ack",
        queueLane: null,
      }),
      tone: openNeedsAckCount > 0 ? "critical" as const : "resolved" as const,
    },
    {
      label: tr("Unassigned"),
      count: String(openUnassignedCount),
      description: tr("No owner yet."),
      href: buildAlertsHref({
        ...pageFilters,
        status: "open",
        severity: null,
        ackState: null,
        queueLane: "unassigned",
      }),
      tone: openUnassignedCount > 0 ? "warning" as const : "resolved" as const,
    },
    {
      label: tr("Missing notes"),
      count: String(openWithoutNoteCount),
      description: tr("Add notes."),
      href: buildAlertsHref({
        ...pageFilters,
        status: "open",
        severity: null,
        ackState: null,
        queueLane: "missing-note",
      }),
      tone: openWithoutNoteCount > 0 ? "warning" as const : "resolved" as const,
    },
    {
      label: tr("Missing runbooks"),
      count: String(openMissingRunbookCount),
      description: tr("Add runbooks."),
      href: buildAlertsHref({
        ...pageFilters,
        status: "open",
        severity: null,
        ackState: null,
        queueLane: "missing-runbook",
      }),
      tone: openMissingRunbookCount > 0 ? "warning" as const : "resolved" as const,
    },
    {
      label: tr("Aging"),
      count: String(openAgingCount),
      description: tr("Outside response window."),
      href: buildAlertsHref({
        ...pageFilters,
        status: "open",
        severity: null,
        ackState: null,
        queueLane: "aging",
      }),
      tone: openAgingCount > 0 ? "warning" as const : "resolved" as const,
    },
  ];
  const secondaryQueueActions = [
    {
      titleKey: "secondaryQueueAction.critical.title",
      href: buildAlertsHref({
        ...pageFilters,
        status: "open",
        severity: "critical",
        ackState: null,
        queueLane: null,
      }),
      onClick: () => replaceAlertSearchParams({ status: "open", severity: "critical", ackState: null, queueLane: null }),
      ctaKey: "secondaryQueueAction.critical.cta",
      tone: currentViewCriticalCount > 0 ? "critical" as const : "resolved" as const,
    },
    {
      titleKey: "secondaryQueueAction.escalation.title",
      href: buildAlertsHref({
        ...pageFilters,
        status: "open",
        severity: null,
        ackState: null,
        queueLane: "escalation-risk",
      }),
      onClick: () => replaceAlertSearchParams({ status: "open", severity: null, ackState: null, queueLane: "escalation-risk" }),
      ctaKey: "secondaryQueueAction.escalation.cta",
      tone: escalationRiskCount > 0 ? "critical" as const : "resolved" as const,
    },
    {
      titleKey: "secondaryQueueAction.tickets.title",
      href: buildAlertsHref({
        ...pageFilters,
        status: "open",
        severity: null,
        ackState: null,
        queueLane: "missing-ticket",
      }),
      onClick: () => replaceAlertSearchParams({ status: "open", severity: null, ackState: null, queueLane: "missing-ticket" }),
      ctaKey: "secondaryQueueAction.tickets.cta",
      tone: openMissingTicketCount > 0 ? "warning" as const : "resolved" as const,
    },
  ];
  const triageWorkflowCards = [
    {
      title: tr("Check usage"),
      description: tr("Surface model/response history quickly."),
      href: alertUsageEvidenceHref,
      badge: escalationRiskCount > 0 || currentViewCriticalCount > 0 ? "usage attention" : "usage",
      className:
        escalationRiskCount > 0 || currentViewCriticalCount > 0 ? "action-card action-card--warning" : "action-card",
      ctaLabel: "Open usage",
    },
    {
      title: budgetPolicyId ? tr("Open linked budget policy") : tr("Open budgets"),
      description: tr("View spend guardrails next."),
      href:
        focusedBudgetHref ??
        buildContextualHref(`/budgets?workspaceId=${selectedWorkspaceId}`, redirectPath),
      badge: budgetPolicyId ? "budget policy" : "budgets",
      className: "action-card",
      ctaLabel: budgetPolicyId ? "Open policy" : "Open budgets",
    },
    {
      title: tr("Open audit or exports"),
      description: tr("Capture evidence while scope is fresh."),
      href: openMissingTicketCount > 0 || openHandoffGapCount > 0 ? alertAuditEvidenceHref : alertExportEvidenceHref,
      badge: openMissingTicketCount > 0 || openHandoffGapCount > 0 ? tr("audit trail") : tr("export pack"),
      className:
        openMissingTicketCount > 0 || openHandoffGapCount > 0 ? "action-card action-card--warning" : "action-card",
      ctaLabel: openMissingTicketCount > 0 || openHandoffGapCount > 0 ? tr("actionCard.openAuditLog") : tr("actionCard.openExports"),
    },
  ];
  return (
    <AppShell
      headerMode="compact"
      sidebarVariant="minimal"
      showOperatorContextCards={false}
      showSupportPanels={false}
      title={tr("Alerts")}
      subtitle=""
      workspaceId={selectedWorkspaceId}
      workspaceLabel={selectedWorkspace ? `${selectedWorkspace.organizationName} / ${selectedWorkspace.name}` : null}
    >
      <section className="space-y-6">
        {alertsIssue ? (
          <ControlApiStatusCard
            issue={alertsIssue}
            heading={tr("alerts.status.degraded")}
          />
        ) : null}

        <CompactToolbar
          query={query ?? ""}
          onQueryChange={(val) => replaceAlertSearchParams({ q: val })}
          filterCount={activeFilterChips.length}
          onResetFilters={() => window.location.href = localizeHref(clearFiltersHref, locale)}
          placeholder={tr("Title, body, code, scope")}
          actions={
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
               <Button asChild size="sm" variant="outline" className="rounded-full">
                 <Link href={alertExportEvidenceHref}>
                   {tr("Export Evidence")}
                 </Link>
               </Button>
               <p className="hidden sm:block">{tr("{count} alerts in scope", { count: scopedWorkspaceAlerts.length })}</p>
            </div>
          }
        >
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              const formData = new FormData(event.currentTarget);
              replaceAlertSearchParams({
                q: getOptionalFilter(formData.get("q")?.toString()),
                projectId: getOptionalFilter(formData.get("projectId")?.toString()),
                environmentId: getOptionalFilter(formData.get("environmentId")?.toString()),
                status: getOptionalFilter(formData.get("status")?.toString()),
                severity: getOptionalFilter(formData.get("severity")?.toString()),
                ackState: getOptionalFilter(formData.get("ackState")?.toString()) ?? "all",
                queueLane: getOptionalFilter(formData.get("queueLane")?.toString()) ?? "all",
              });
            }}
          >
            <FilterField label={tr("Project")}>
              <select className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm" name="projectId" defaultValue={selectedProjectId ?? ""}>
                <option value="">{tr("All projects")}</option>
                {sortedProjects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {translateInlineText(locale, project.name)}
                  </option>
                ))}
              </select>
            </FilterField>
            <FilterField label={tr("Severity")}>
              <select className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm" name="severity" defaultValue={severity ?? ""}>
                <option value="">{tr("All severities")}</option>
                <option value="critical">{tr("Critical")}</option>
                <option value="warning">{tr("Warning")}</option>
                <option value="info">{tr("Info")}</option>
              </select>
            </FilterField>
            <FilterField label={tr("Ack State")}>
              <select className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm" name="ackState" defaultValue={ackStateFilter}>
                <option value="all">{tr("All ack states")}</option>
                <option value="needs-ack">{tr("needs-ack")}</option>
                <option value="acknowledged">{tr("acknowledged")}</option>
              </select>
            </FilterField>
            <Button size="sm" type="submit" className="w-full mt-2 rounded-full">
              {tr("Apply Filters")}
            </Button>
            <a
              className="block text-center text-[11px] text-muted-foreground hover:text-foreground mt-2"
              href={localizeHref(clearFiltersHref, locale)}
            >
              {tr("Reset")}
            </a>
          </form>
        </CompactToolbar>

        <section
          id="alert-queue"
          className="rounded-xl border border-border/70 bg-[color:color-mix(in_srgb,var(--surface-1)_98%,var(--surface-canvas)_2%)]"
        >
          <AlertsQueueWorkspace
            allAlertsCount={allAlerts.length}
            locale={locale}
            currentViewSummary={buildCurrentViewSummary(
              {
                project: selectedProject,
                environment: selectedEnvironment,
                budgetPolicyId,
                owner,
                ackState: ackStateFilter,
                queueLane: queueLaneFilter,
                status,
                severity,
              },
              locale,
              tr,
            )}
            queueActionNotice={queueActionNotice}
            redirectPath={redirectPath}
            rows={alertTableRows}
          />

        </section>

        <LazyDisclosureSection
          variant="section"
          className="rounded-xl border border-border/60 bg-[color:color-mix(in_srgb,var(--surface-1)_96%,var(--surface-canvas)_4%)]"
          summary={
            <DisclosureSummary
              description=""
              eyebrow={tr("Secondary")}
              meta=""
              title={locale === "zh" ? "补充面板" : "Support panels"}
              variant="section"
            />
          }
          bodyClassName="space-y-6 border-t border-border/60 px-4 py-4"
          deferBodyVisibility
        >
            <div className="space-y-6" aria-label="Details">
              {(primaryQueueAction || secondaryQueueActions.length > 0) ? (
                <Card>
                  <CardHeader className="pb-4">
                    <SectionHeader
                      eyebrow={tr("Next")}
                      title={primaryQueueAction ? tr(primaryQueueAction.titleKey) : tr("Queue under control")}
                    />
                  </CardHeader>
                  <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {primaryQueueAction ? (
                      <OpsLinkCard
                        badge={primaryQueueAction.tone === "critical" ? tr("Blocked") : primaryQueueAction.tone === "warning" ? tr("Watch") : tr("OK")}
                        ctaLabel={tr(primaryQueueAction.ctaKey)}
                        description={tr(primaryQueueAction.descriptionKey)}
                        eyebrow={tr("Start here")}
                        href={primaryQueueAction.href}
                        onClick={primaryQueueAction.onClick}
                        icon={Siren}
                        title={tr(primaryQueueAction.titleKey)}
                        tone={getOpsTone(primaryQueueAction.tone)}
                      />
                    ) : null}
                    {secondaryQueueActions.map((action) => (
                      <OpsLinkCard
                        badge={action.tone === "critical" ? tr("Blocked") : action.tone === "warning" ? tr("Watch") : tr("OK")}
                        ctaLabel={tr(action.ctaKey)}
                        description=""
                        eyebrow={tr("Next")}
                        href={action.href}
                        onClick={action.onClick}
                        icon={ClipboardList}
                        key={action.titleKey}
                        title={tr(action.titleKey)}
                        tone={getOpsTone(action.tone)}
                      />
                    ))}
                  </CardContent>
                </Card>
              ) : null}

              <Card>
                <CardHeader className="pb-4">
                  <SectionHeader
                    eyebrow={tr("Queue")}
                    title={tr("Saved views")}
                  />
                </CardHeader>
                <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {quickViews.map((view) => (
                    <OpsLinkCard
                      badge={view.active ? tr("Open") : tr("Pending")}
                      ctaLabel={tr("Open queue")}
                      description=""
                      eyebrow={tr("Queue")}
                      href={view.href}
                      onClick={view.onClick}
                      key={view.label}
                      title={view.label}
                      tone={view.active ? "warning" : "neutral"}
                    />
                  ))}
                </CardContent>
              </Card>

              <Card className="scroll-mt-24 xl:scroll-mt-32" id="queue-continuation">
                <CardHeader className="pb-4">
                  <SectionHeader
                    eyebrow={tr("Related")}
                    title={tr("Related pages")}
                  />
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {triageWorkflowCards.map((card) => (
                    <OpsLinkCard
                      badge={card.badge}
                      ctaLabel={card.ctaLabel}
                      description=""
                      eyebrow={tr("Page")}
                      href={card.href}
                      key={card.title}
                      title={card.title}
                      tone={card.className.includes("critical") ? "critical" : card.className.includes("warning") ? "warning" : "neutral"}
                    />
                  ))}
                </CardContent>
              </Card>
            </div>
        </LazyDisclosureSection>
      </section>
    </AppShell>
  );
}
