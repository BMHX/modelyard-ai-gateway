"use client";

import { Link } from "@/i18n/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import type { Environment, Project, SavedView, UsageEvent } from "@teamops/contracts";

import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { AppShell } from "../components/app-shell";
import { ControlApiStatusCard } from "../components/control-api-status-card";
import { ResourceDashboard, ResourceDashboardCard } from "../components/resource-dashboard";
import { CompactToolbar, FilterField } from "../components/resource-compact-toolbar";
import { SavedViewBar, type SavedViewBarSection } from "../components/saved-view-bar";
import { StatusRingChart } from "../components/charts/status-ring-chart";
import { TrendLineChart } from "../components/charts/trend-line-chart";
import { useUsagePageQuery } from "../lib/console-api-client";
import enUsageMessages from "../messages/en/usage.json";
import zhUsageMessages from "../messages/zh/usage.json";
import { localizeHref, type AppLocale, translateInlineText } from "../lib/i18n";
import { useLocalePreference } from "../lib/i18n-client";
import { formatEnvironmentOptionLabel } from "../lib/resource-scope";
import {
  buildContextualHref,
  buildUsageEventHref,
  buildUsageEventsScopedHref,
  getSafeReturnTo,
} from "../lib/navigation";
import {
  describeUsageEventOutcome,
  getTagClassName,
  getUsageEventStatusTone,
  getUsageEventSurface,
} from "./presentation";
import { createSavedViewAction, deleteSavedViewAction, updateSavedViewAction } from "../saved-views/actions";

const providerOptions = ["anthropic", "openai", "openai-compatible", "bedrock", "vertex"] as const;
const statusOptions = ["success", "error", "blocked"] as const;
const surfaceOptions = ["metadata", "streamed", "interrupted"] as const;
const sortOptions = ["newest", "oldest", "latency_desc", "cost_desc", "tokens_desc"] as const;
const defaultPageSize = 25;
const usageStatusBadgeTone = {
  resolved: "healthy",
  warning: "warning",
  critical: "critical",
  default: "default",
} as const;
const projectStatusOrder = {
  active: 0,
  archived: 1,
} satisfies Record<Project["status"], number>;
const environmentStatusOrder = {
  active: 0,
  archived: 1,
} satisfies Record<Environment["status"], number>;
type ProviderFilter = (typeof providerOptions)[number];
type StatusFilter = (typeof statusOptions)[number];
type OutcomeFilter = StatusFilter | "attention";
type SurfaceFilter = (typeof surfaceOptions)[number];
type SortFilter = (typeof sortOptions)[number];

function getSingleValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }

  return value ?? "";
}

function getOptionalFilter(value: string | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
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
    formatUsd(amount: number) {
      const formatted = new Intl.NumberFormat(intlLocale, {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 4,
        maximumFractionDigits: 4,
      }).format(amount);
      return locale === "zh" ? formatted.replace(/^US\$/, "美元 ") : formatted;
    },
    formatInteger(value: number | null) {
      if (value === null) {
        return locale === "zh" ? "无" : "n/a";
      }

      return new Intl.NumberFormat(intlLocale).format(value);
    },
    formatPercent(value: number | null) {
      if (value === null) {
        return locale === "zh" ? "无" : "n/a";
      }

      return new Intl.NumberFormat(intlLocale, {
        style: "percent",
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      }).format(value);
    },
    formatFilterDateTime(value: string) {
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) {
        return value.replace("T", " ");
      }

      return new Intl.DateTimeFormat(intlLocale, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(parsed);
    },
    formatSavedViewTimestamp(value: string) {
      return new Intl.DateTimeFormat(intlLocale, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(value));
    },
  };
}

function buildUsageTrendData(items: UsageEvent[], locale: AppLocale) {
  const intlLocale = getIntlLocale(locale);
  const today = new Date();
  const buckets = new Map<string, number>();

  for (let index = 6; index >= 0; index -= 1) {
    const date = new Date(today);
    date.setDate(today.getDate() - index);
    const key = date.toISOString().slice(0, 10);
    buckets.set(key, 0);
  }

  for (const item of items) {
    const key = item.createdAt.slice(0, 10);
    if (buckets.has(key)) {
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
  }

  return Array.from(buckets.entries()).map(([date, value]) => ({
    date: new Intl.DateTimeFormat(intlLocale, {
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(date)),
    value,
  }));
}

function buildUsageMetricTrendData(
  items: UsageEvent[],
  locale: AppLocale,
  accessor: (item: UsageEvent) => number,
) {
  const intlLocale = getIntlLocale(locale);
  const today = new Date();
  const buckets = new Map<string, number>();

  for (let index = 6; index >= 0; index -= 1) {
    const date = new Date(today);
    date.setDate(today.getDate() - index);
    const key = date.toISOString().slice(0, 10);
    buckets.set(key, 0);
  }

  for (const item of items) {
    const key = item.createdAt.slice(0, 10);
    if (buckets.has(key)) {
      buckets.set(key, (buckets.get(key) ?? 0) + accessor(item));
    }
  }

  return Array.from(buckets.entries()).map(([date, value]) => ({
    date: new Intl.DateTimeFormat(intlLocale, {
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(date)),
    value,
  }));
}

type TranslationValues = Record<string, string | number>

function formatMessage(template: string, values?: TranslationValues) {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? `{${key}}`));
}

function resolveUsageMessage(messages: Record<string, unknown>, key: string) {
  const exact = messages[key];
  if (typeof exact === "string") {
    return exact;
  }

  const normalizedKey = key.startsWith("usage.") ? key.slice("usage.".length) : key;
  const normalizedExact = messages[normalizedKey];
  if (typeof normalizedExact === "string") {
    return normalizedExact;
  }

  const nested = normalizedKey.split(".").reduce<unknown>((current, part) => {
    if (!current || typeof current !== "object" || !(part in (current as Record<string, unknown>))) {
      return null;
    }

    return (current as Record<string, unknown>)[part];
  }, messages);

  return typeof nested === "string" ? nested : null;
}

function createUsageTranslator(locale: AppLocale) {
  const messages = (locale === "zh" ? zhUsageMessages : enUsageMessages) as Record<string, unknown>;
  return (text: string, values?: TranslationValues) => {
    const template = resolveUsageMessage(messages, text) ?? translateInlineText(locale, text);
    return formatMessage(template, values);
  };
}

function FormField({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid content-start gap-1.5">
      <label className="ml-0.5 text-[13px] font-bold tracking-tight text-foreground/80" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
    </div>
  );
}

function parseOffset(value: string | undefined) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }

  return parsed;
}

function parseNonNegativeInteger(value: string | undefined) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return parsed;
}

function getOutcomeLabel(value: OutcomeFilter | null) {
  if (!value) {
    return "All outcomes";
  }

  if (value === "attention") {
    return "Needs attention";
  }

  return value;
}

function getSurfaceLabel(value: SurfaceFilter | null) {
  if (!value) {
    return "All call types";
  }

  if (value === "metadata") {
    return "Metadata lookups";
  }

  if (value === "streamed") {
    return "Streamed responses";
  }

  return "Interrupted streams";
}

function getSortLabel(value: SortFilter | null) {
  switch (value) {
    case "oldest":
      return "Oldest first";
    case "latency_desc":
      return "Slowest first";
    case "cost_desc":
      return "Highest cost first";
    case "tokens_desc":
      return "Most tokens first";
    case "newest":
    default:
      return "Newest first";
  }
}

function buildUsageInvestigationPivot(args: {
  requestId: string | null;
  providerRequestId: string | null;
  budgetPolicyId: string | null;
  virtualKeyId: string | null;
  providerConnectionId: string | null;
  model: string | null;
  provider: string | null;
}) {
  if (args.requestId) {
    return {
      label: "usage.investigation.gatewayRequest.label",
      value: args.requestId,
      summary: "usage.investigation.gatewayRequest.summary",
    };
  }

  if (args.providerRequestId) {
    return {
      label: "usage.investigation.providerRequest.label",
      value: args.providerRequestId,
      summary: "usage.investigation.providerRequest.summary",
    };
  }

  if (args.budgetPolicyId) {
    return {
      label: "usage.investigation.budgetPolicy.label",
      value: args.budgetPolicyId,
      summary: "usage.investigation.budgetPolicy.summary",
    };
  }

  if (args.virtualKeyId) {
    return {
      label: "usage.investigation.virtualKey.label",
      value: args.virtualKeyId,
      summary: "usage.investigation.virtualKey.summary",
    };
  }

  if (args.providerConnectionId) {
    return {
      label: "usage.investigation.providerConnection.label",
      value: args.providerConnectionId,
      summary: "usage.investigation.providerConnection.summary",
    };
  }

  if (args.model) {
    return {
      label: "usage.investigation.model.label",
      value: args.model,
      summary: "usage.investigation.model.summary",
    };
  }

  if (args.provider) {
    return {
      label: "usage.investigation.provider.label",
      value: args.provider,
      summary: "usage.investigation.provider.summary",
    };
  }

  return null;
}

function buildUsageEventsHref(filters: {
  workspaceId: string | null;
  projectId: string | null;
  environmentId: string | null;
  virtualKeyId: string | null;
  providerConnectionId: string | null;
  budgetPolicyId: string | null;
  provider: string | null;
  model: string | null;
  requestId: string | null;
  providerRequestId: string | null;
  outcome: OutcomeFilter | null;
  surface: SurfaceFilter | null;
  minLatencyMs: number | null;
  sortBy: SortFilter | null;
  from: string | null;
  to: string | null;
  savedViewId?: string | null;
  returnTo?: string | null;
  offset?: number;
}) {
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
  if (filters.virtualKeyId) {
    params.set("virtualKeyId", filters.virtualKeyId);
  }
  if (filters.providerConnectionId) {
    params.set("providerConnectionId", filters.providerConnectionId);
  }
  if (filters.budgetPolicyId) {
    params.set("budgetPolicyId", filters.budgetPolicyId);
  }
  if (filters.provider) {
    params.set("provider", filters.provider);
  }
  if (filters.model) {
    params.set("model", filters.model);
  }
  if (filters.requestId) {
    params.set("requestId", filters.requestId);
  }
  if (filters.providerRequestId) {
    params.set("providerRequestId", filters.providerRequestId);
  }
  if (filters.outcome) {
    params.set("outcome", filters.outcome);
  }
  if (filters.surface) {
    params.set("surface", filters.surface);
  }
  if (filters.minLatencyMs !== null) {
    params.set("minLatencyMs", String(filters.minLatencyMs));
  }
  if (filters.sortBy) {
    params.set("sortBy", filters.sortBy);
  }
  if (filters.from) {
    params.set("from", filters.from);
  }
  if (filters.to) {
    params.set("to", filters.to);
  }
  if (filters.savedViewId) {
    params.set("savedViewId", filters.savedViewId);
  }
  if (safeReturnTo) {
    params.set("returnTo", safeReturnTo);
  }
  if ((filters.offset ?? 0) > 0) {
    params.set("offset", String(filters.offset));
  }

  const query = params.toString();
  return query ? `/usage-events?${query}` : "/usage-events";
}

function buildExportHref(filters: {
  workspaceId: string;
  projectId: string | null;
  environmentId: string | null;
  virtualKeyId: string | null;
  providerConnectionId: string | null;
  budgetPolicyId: string | null;
  provider: string | null;
  model: string | null;
  requestId: string | null;
  providerRequestId: string | null;
  outcome: OutcomeFilter | null;
  surface: SurfaceFilter | null;
  minLatencyMs: number | null;
  sortBy: SortFilter | null;
  from: string | null;
  to: string | null;
  returnTo?: string | null;
}) {
  const params = new URLSearchParams();
  const safeReturnTo = getSafeReturnTo(filters.returnTo);
  params.set("workspaceId", filters.workspaceId);
  params.set("kind", "usage-events");

  if (filters.projectId) {
    params.set("projectId", filters.projectId);
  }
  if (filters.environmentId) {
    params.set("environmentId", filters.environmentId);
  }
  if (filters.virtualKeyId) {
    params.set("virtualKeyId", filters.virtualKeyId);
  }
  if (filters.providerConnectionId) {
    params.set("providerConnectionId", filters.providerConnectionId);
  }
  if (filters.budgetPolicyId) {
    params.set("budgetPolicyId", filters.budgetPolicyId);
  }
  if (filters.provider) {
    params.set("provider", filters.provider);
  }
  if (filters.model) {
    params.set("model", filters.model);
  }
  if (filters.requestId) {
    params.set("requestId", filters.requestId);
  }
  if (filters.providerRequestId) {
    params.set("providerRequestId", filters.providerRequestId);
  }
  if (filters.outcome) {
    params.set("outcome", filters.outcome);
  }
  if (filters.surface) {
    params.set("surface", filters.surface);
  }
  if (filters.minLatencyMs !== null) {
    params.set("minLatencyMs", String(filters.minLatencyMs));
  }
  if (filters.sortBy) {
    params.set("sortBy", filters.sortBy);
  }
  if (filters.from) {
    params.set("from", filters.from);
  }
  if (filters.to) {
    params.set("to", filters.to);
  }
  if (safeReturnTo) {
    params.set("returnTo", safeReturnTo);
  }

  return `/exports?${params.toString()}`;
}

function buildAuditPivotHref(filters: {
  workspaceId: string;
  projectId: string | null;
  environmentId: string | null;
  budgetPolicyId: string | null;
  from: string | null;
  to: string | null;
  returnTo?: string | null;
}) {
  const params = new URLSearchParams();
  const safeReturnTo = getSafeReturnTo(filters.returnTo);

  params.set("workspaceId", filters.workspaceId);

  if (filters.projectId) {
    params.set("projectId", filters.projectId);
  }
  if (filters.environmentId) {
    params.set("environmentId", filters.environmentId);
  }
  if (filters.budgetPolicyId) {
    params.set("subjectType", "budget-policy");
    params.set("subjectId", filters.budgetPolicyId);
  }
  if (filters.from) {
    params.set("from", filters.from);
  }
  if (filters.to) {
    params.set("to", filters.to);
  }
  if (safeReturnTo) {
    params.set("returnTo", safeReturnTo);
  }

  return `/audit-logs?${params.toString()}`;
}

function appendSavedViewId(href: string, savedViewId: string) {
  const url = new URL(href, "http://localhost");
  url.searchParams.set("savedViewId", savedViewId);
  return `${url.pathname}${url.search}`;
}

function buildBudgetHref(workspaceId: string, budgetPolicyId: string, returnTo?: string | null) {
  return buildContextualHref(
    `/budgets?workspaceId=${workspaceId}&budgetPolicyId=${budgetPolicyId}#budget-${budgetPolicyId}`,
    returnTo,
  );
}

function buildBudgetAlertsHref(
  workspaceId: string,
  budgetPolicyId: string,
  returnTo?: string | null,
  status?: "open" | "resolved",
) {
  const params = new URLSearchParams({
    workspaceId,
    budgetPolicyId,
  });

  if (status) {
    params.set("status", status);
  }

  return buildContextualHref(`/alerts?${params.toString()}`, returnTo);
}

function buildBudgetAuditHref(workspaceId: string, budgetPolicyId: string, returnTo?: string | null) {
  const params = new URLSearchParams({
    workspaceId,
    subjectType: "budget-policy",
    subjectId: budgetPolicyId,
  });

  return buildContextualHref(`/audit-logs?${params.toString()}`, returnTo);
}

function capitalizeLabel(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function getSavedViewNoticeTone(value: string | null): "success" | "error" | null {
  if (value === "success" || value === "error") {
    return value;
  }

  return null;
}

function getOpsToneFromClassName(className: string) {
  if (className.includes("critical")) {
    return "critical" as const;
  }

  if (className.includes("warning")) {
    return "warning" as const;
  }

  return "neutral" as const;
}

function getUsagePriorityScore(event: UsageEvent) {
  const statusScore =
    event.status === "blocked" ? 1_000_000
    : event.status === "error" ? 600_000
    : 0;
  const latencyScore = (event.latencyMs ?? 0) * 10;
  const costScore = Math.round(event.costUsd * 100_000);
  return statusScore + latencyScore + costScore + event.totalTokens;
}

function getUsageEventOpsTone(status: UsageEvent["status"]) {
  if (status === "blocked") {
    return "critical" as const;
  }

  if (status === "error") {
    return "warning" as const;
  }

  return "neutral" as const;
}

function formatUsageEventHeadline(args: {
  httpStatus: number | null;
  reasonLabel: string;
  status: UsageEvent["status"];
  tr: ReturnType<typeof createUsageTranslator>;
}) {
  const reason = args.reasonLabel ? args.tr(args.reasonLabel) : null;
  const httpLabel = args.httpStatus !== null ? `HTTP ${args.httpStatus}` : null;

  return (
    [httpLabel, reason].filter(Boolean).join(" · ") ||
    (args.status === "success"
      ? args.tr("usage.presentation.completedTitle")
      : args.tr("usage.presentation.noContext"))
  );
}

function formatUsageEventProviderLabel(
  event: UsageEvent,
  eventSurface: ReturnType<typeof getUsageEventSurface>,
  tr: ReturnType<typeof createUsageTranslator>,
) {
  const providerLabel = tr(event.provider ?? "unknown provider");
  const modelLabel = tr(event.model ?? "unknown model");

  if (!event.model || modelLabel === tr(eventSurface.displayName)) {
    return providerLabel;
  }

  return `${providerLabel} · ${modelLabel}`;
}

function formatUsageValuePrimary(args: {
  costUsd: number;
  totalTokens: number;
  formatUsd: (value: number) => string;
  formatInteger: (value: number | null) => string;
  locale: AppLocale;
}) {
  if (args.costUsd > 0) {
    return args.formatUsd(args.costUsd);
  }

  return args.locale === "zh"
    ? `${args.formatInteger(args.totalTokens)} 个 token`
    : `${args.formatInteger(args.totalTokens)} tokens`;
}

const usageFilterSubmitButtonClassName =
  "h-9 rounded-xl border-[color:color-mix(in_srgb,var(--primary)_72%,white_28%)] bg-[color:color-mix(in_srgb,var(--primary)_82%,white_18%)] px-4 text-[13px] font-medium text-white shadow-none hover:bg-[color:color-mix(in_srgb,var(--primary)_88%,black_12%)]";

const usageFilterResetButtonClassName =
  "h-9 rounded-xl border-[color:color-mix(in_srgb,var(--border-default)_82%,transparent)] bg-[color:color-mix(in_srgb,var(--surface-1)_96%,var(--surface-2)_4%)] px-4 text-[13px] font-medium text-[color:var(--text-2)] hover:border-[color:var(--border-strong)] hover:bg-[color:color-mix(in_srgb,var(--surface-2)_72%,var(--surface-1)_28%)] hover:text-foreground";

export default function UsageEventsPage() {
  const [hasMounted, setHasMounted] = useState(false);
  const { locale } = useLocalePreference();
  const searchParams = useSearchParams() ?? new URLSearchParams();
  const [searchState, setSearchState] = useState(() => searchParams.toString());
  const currentSearchParams = useMemo(() => new URLSearchParams(searchState), [searchState]);
  const tr = createUsageTranslator(locale);
  const {
    compareLabels,
    formatDateTime,
    formatFilterDateTime,
    formatInteger,
    formatPercent,
    formatSavedViewTimestamp,
    formatUsd,
  } = createFormatters(locale);
  const requestedWorkspaceId = getOptionalFilter(currentSearchParams.get("workspaceId") ?? undefined);
  const rawProjectId = getOptionalFilter(currentSearchParams.get("projectId") ?? undefined);
  const rawEnvironmentId = getOptionalFilter(currentSearchParams.get("environmentId") ?? undefined);
  const rawProvider = getOptionalFilter(currentSearchParams.get("provider") ?? undefined);
  const rawOutcome = getOptionalFilter(currentSearchParams.get("outcome") ?? undefined);
  const rawStatus = getOptionalFilter(currentSearchParams.get("status") ?? undefined);
  const rawStatusGroup = getOptionalFilter(currentSearchParams.get("statusGroup") ?? undefined);
  const rawSurface = getOptionalFilter(currentSearchParams.get("surface") ?? undefined);
  const model = getOptionalFilter(currentSearchParams.get("model") ?? undefined);
  const virtualKeyId = getOptionalFilter(currentSearchParams.get("virtualKeyId") ?? undefined);
  const providerConnectionId = getOptionalFilter(currentSearchParams.get("providerConnectionId") ?? undefined);
  const budgetPolicyId = getOptionalFilter(currentSearchParams.get("budgetPolicyId") ?? undefined);
  const requestId = getOptionalFilter(currentSearchParams.get("requestId") ?? undefined);
  const providerRequestId = getOptionalFilter(currentSearchParams.get("providerRequestId") ?? undefined);
  const minLatencyMs = parseNonNegativeInteger(currentSearchParams.get("minLatencyMs") ?? undefined);
  const rawSortBy = getOptionalFilter(currentSearchParams.get("sortBy") ?? undefined);
  const from = getOptionalFilter(currentSearchParams.get("from") ?? undefined);
  const to = getOptionalFilter(currentSearchParams.get("to") ?? undefined);
  const offset = parseOffset(currentSearchParams.get("offset") ?? undefined);
  const usagePageQuery = useUsagePageQuery({
    workspaceId: requestedWorkspaceId,
    projectId: rawProjectId,
    environmentId: rawEnvironmentId,
    provider: rawProvider,
    outcome: rawOutcome,
    status: rawStatus,
    statusGroup: rawStatusGroup,
    surface: rawSurface,
    model,
    virtualKeyId,
    providerConnectionId,
    budgetPolicyId,
    requestId,
    providerRequestId,
    minLatencyMs,
    sortBy: rawSortBy,
    from,
    to,
    offset,
  });
  const response = usagePageQuery.data;
  useEffect(() => {
    setHasMounted(true);
  }, []);
  function replaceUsageSearchParams(updates: Record<string, string | null>) {
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

    const href = localizeHref(`/usage-events${nextSearch ? `?${nextSearch}` : ""}`, locale);
    window.history.replaceState(window.history.state, "", `${href}${window.location.hash}`);
  }
  const workspaceOptions = response?.workspaceOptions ?? [];
  const selectedWorkspaceId = response?.selectedWorkspaceId ?? null;
  const selectionStatus = response?.selectionStatus ?? "needs-selection";
  const workspaceSelectionIssue = response?.issue ?? null;

  const workspaceSelectionCopy = (() => {
    switch (selectionStatus) {
      case "missing":
        return {
          title: tr("Create a workspace"),
          description: tr("Create or seed a workspace to load usage events."),
        };
      case "needs-selection":
        return {
          title: tr("Select a workspace"),
          description: workspaceOptions.length
            ? tr("Choose a workspace from the selector.")
            : tr("Create or seed a workspace to load usage events."),
        };
      case "invalid":
        return {
          title: tr("Workspace not found"),
          description: tr("Pick another workspace or create a new one."),
        };
      case "unavailable":
        return {
          title: tr("Workspace selection is unavailable"),
          description: workspaceSelectionIssue?.message ? tr(workspaceSelectionIssue.message) : tr("Try again shortly."),
        };
      default:
        return {
          title: tr("Workspace required"),
          description: tr("Select a workspace to continue."),
        };
    }
  })();

  if (!hasMounted || (usagePageQuery.isLoading && !response)) {
    return (
      <AppShell
        headerMode="compact"
        sidebarVariant="minimal"
        showOperatorContextCards={false}
        showSupportPanels={false}
        title={tr("Usage")}
        subtitle=""
        workspaceId={requestedWorkspaceId}
      >
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
    const noWorkspaceDescription =
      locale === "zh"
        ? "请使用页头中的全局工作区切换器继续。"
        : "Use the global workspace switcher in the header to continue.";
    return (
      <AppShell
        headerMode="compact"
        sidebarVariant="minimal"
        showOperatorContextCards={false}
        showSupportPanels={false}
        title={tr("Usage")}
        subtitle=""
        workspaceId={selectedWorkspaceId}
      >
        <section className="space-y-4">
          <EmptyState compact title={workspaceSelectionCopy.title} description={noWorkspaceDescription} />
          {selectionStatus === "unavailable" && workspaceSelectionIssue ? (
            <ControlApiStatusCard issue={workspaceSelectionIssue} heading={workspaceSelectionCopy.title} mode="inline" />
          ) : null}
        </section>
      </AppShell>
    );
  }

  const projects = response?.projects ?? [];
  const environments = response?.environments ?? [];
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

  const selectedProjectId =
    rawProjectId && sortedProjects.some((project) => project.id === rawProjectId) ? rawProjectId : null;

  const filteredEnvironmentOptions = selectedProjectId
    ? sortedEnvironments.filter((environment) => environment.projectId === selectedProjectId)
    : sortedEnvironments;
  const selectedEnvironmentId =
    rawEnvironmentId && filteredEnvironmentOptions.some((environment) => environment.id === rawEnvironmentId)
      ? rawEnvironmentId
      : null;

  const provider: ProviderFilter | null =
    rawProvider && providerOptions.includes(rawProvider as ProviderFilter) ? (rawProvider as ProviderFilter) : null;

  const outcome: OutcomeFilter | null =
    rawOutcome === "attention" || rawStatusGroup === "attention"
      ? "attention"
      : rawOutcome && statusOptions.includes(rawOutcome as StatusFilter)
        ? (rawOutcome as StatusFilter)
        : rawStatus && statusOptions.includes(rawStatus as StatusFilter)
          ? (rawStatus as StatusFilter)
          : null;
  const status: StatusFilter | null = outcome && outcome !== "attention" ? outcome : null;
  const statusGroup: "attention" | null = outcome === "attention" ? "attention" : null;

  const surface: SurfaceFilter | null =
    rawSurface && surfaceOptions.includes(rawSurface as SurfaceFilter) ? (rawSurface as SurfaceFilter) : null;

  const sortBy: SortFilter | null =
    rawSortBy && rawSortBy !== "newest" && sortOptions.includes(rawSortBy as SortFilter) ? (rawSortBy as SortFilter) : null;
  const returnTo = getSafeReturnTo(currentSearchParams.get("returnTo"));
  const requestedSavedViewId = getOptionalFilter(currentSearchParams.get("savedViewId") ?? undefined);
  const savedViewNotice = getSavedViewNoticeTone(getOptionalFilter(currentSearchParams.get("savedViewNotice") ?? undefined));
  const savedViewMessage = getOptionalFilter(currentSearchParams.get("savedViewMessage") ?? undefined);

  const pageFiltersBase = {
    workspaceId: selectedWorkspaceId,
    projectId: selectedProjectId,
    environmentId: selectedEnvironmentId,
    virtualKeyId,
    providerConnectionId,
    budgetPolicyId,
    provider,
    model,
    requestId,
    providerRequestId,
    outcome,
    surface,
    minLatencyMs,
    sortBy,
    from,
    to,
    returnTo,
  };
  const persistedViewFilters = {
    projectId: selectedProjectId,
    environmentId: selectedEnvironmentId,
    virtualKeyId,
    providerConnectionId,
    budgetPolicyId,
    provider,
    model,
    requestId,
    providerRequestId,
    outcome,
    surface,
    minLatencyMs,
    sortBy,
    from,
    to,
  };

  const usage = response?.usage ?? { items: [], total: 0 };
  const summary = response?.summary ?? {
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
  const savedViews = response?.savedViews ?? [];
  const savedViewsIssue = response?.savedViewsIssue ?? null;
  const loadError = response?.loadError ?? null;
  const activeSavedView = savedViews.find((savedView) => savedView.id === requestedSavedViewId) ?? null;
  const savedViewId = activeSavedView?.id ?? null;
  const pageFilters = {
    ...pageFiltersBase,
    savedViewId,
  };
  const redirectPath = buildUsageEventsHref({
    ...pageFilters,
    offset,
  });

  const projectById = new Map(sortedProjects.map((project) => [project.id, project]));
  const environmentById = new Map(sortedEnvironments.map((environment) => [environment.id, environment]));
  const pageStart = usage.total === 0 ? 0 : offset + 1;
  const pageEnd = usage.total === 0 ? 0 : offset + usage.items.length;
  const hasPreviousPage = offset > 0;
  const hasNextPage = offset + usage.items.length < usage.total;
  const usageTrendData = buildUsageTrendData(usage.items, locale);
  const tokenTrendData = buildUsageMetricTrendData(usage.items, locale, (item) => item.totalTokens);
  const costTrendData = buildUsageMetricTrendData(usage.items, locale, (item) => item.costUsd);
  const blockedCount = summary.statusBreakdown.find((item) => item.status === "blocked")?.eventCount ?? 0;
  const errorCount = summary.statusBreakdown.find((item) => item.status === "error")?.eventCount ?? 0;
  const attentionCount = blockedCount + errorCount;
  const promptTokenShare = summary.totalTokens > 0 ? summary.totalPromptTokens / summary.totalTokens : 0;
  const completionTokenShare = summary.totalTokens > 0 ? summary.totalCompletionTokens / summary.totalTokens : 0;
  const providerChartData = summary.providerBreakdown.slice(0, 5).map((entry, index) => ({
    name: tr(entry.provider ?? "unknown"),
    value: entry.eventCount,
    color: ["var(--foreground)", "var(--warning)", "var(--border-strong)", "var(--border-default)", "var(--surface-3)"][index] ?? "var(--border-default)",
  }));
  const statusChartData = summary.statusBreakdown.map((entry) => ({
    name: tr(entry.status),
    value: entry.eventCount,
    color:
      entry.status === "success"
        ? "var(--success-strong)"
        : entry.status === "error"
          ? "var(--warning)"
          : "var(--destructive-strong)",
  }));
  const modelChartData = summary.modelBreakdown.slice(0, 5).map((entry, index) => ({
    name: entry.model ?? tr("n/a"),
    value: entry.eventCount,
    color: ["var(--foreground)", "var(--border-strong)", "var(--border-default)", "var(--surface-3)", "var(--muted-foreground)"][index] ?? "var(--border-default)",
  }));
  const quickViews = [
    {
      label: "All events",
      hint: tr("{count} events", { count: formatInteger(summary.totalEvents) }),
      active: !outcome && !surface && minLatencyMs === null && sortBy === null,
      href: buildUsageEventsHref({
        ...pageFilters,
        outcome: null,
        surface: null,
        offset: 0,
      }),
      onClick: () => replaceUsageSearchParams({ outcome: null, status: null, statusGroup: null, surface: null, minLatencyMs: null, sortBy: null, savedViewId: null, offset: null }),
    },
    {
      label: "Needs attention",
      hint: tr("{count} events", { count: formatInteger(attentionCount) }),
      active: outcome === "attention" && !surface && minLatencyMs === null && sortBy === null,
      href: buildUsageEventsHref({
        ...pageFilters,
        outcome: "attention",
        surface: null,
        offset: 0,
      }),
      onClick: () => replaceUsageSearchParams({ outcome: "attention", status: null, statusGroup: "attention", surface: null, savedViewId: null, offset: null }),
    },
    {
      label: "Errors",
      hint: tr("{count} events", { count: formatInteger(errorCount) }),
      active: outcome === "error" && !surface && minLatencyMs === null && sortBy === null,
      href: buildUsageEventsHref({
        ...pageFilters,
        outcome: "error",
        surface: null,
        offset: 0,
      }),
      onClick: () => replaceUsageSearchParams({ outcome: "error", status: "error", statusGroup: null, surface: null, savedViewId: null, offset: null }),
    },
    {
      label: "Blocked",
      hint: tr("{count} events", { count: formatInteger(blockedCount) }),
      active: outcome === "blocked" && !surface && minLatencyMs === null && sortBy === null,
      href: buildUsageEventsHref({
        ...pageFilters,
        outcome: "blocked",
        surface: null,
        offset: 0,
      }),
      onClick: () => replaceUsageSearchParams({ outcome: "blocked", status: "blocked", statusGroup: null, surface: null, savedViewId: null, offset: null }),
    },
    {
      label: "Slow requests",
      hint: tr("Latency floor {count} ms", { count: 1000 }),
      active: minLatencyMs === 1000 && sortBy === "latency_desc",
      href: buildUsageEventsHref({
        ...pageFilters,
        minLatencyMs: 1000,
        sortBy: "latency_desc",
        offset: 0,
      }),
      onClick: () => replaceUsageSearchParams({ minLatencyMs: "1000", sortBy: "latency_desc", savedViewId: null, offset: null }),
    },
  ];
  const localizedQuickViews = quickViews.map((view) => ({
    ...view,
    label: tr(view.label),
    hint: view.hint,
  }));
  const activeFilterChips = [
    selectedProjectId
      ? {
          label: "Project",
          value: projectById.get(selectedProjectId)?.name ?? selectedProjectId,
          onRemove: () => replaceUsageSearchParams({ projectId: null, environmentId: null, savedViewId: null, offset: null }),
        }
      : null,
    selectedEnvironmentId
      ? {
          label: "Environment",
          value: environmentById.get(selectedEnvironmentId)?.name ?? selectedEnvironmentId,
          onRemove: () => replaceUsageSearchParams({ environmentId: null, savedViewId: null, offset: null }),
        }
      : null,
    provider
      ? {
          label: "Provider",
          value: provider,
          onRemove: () => replaceUsageSearchParams({ provider: null, savedViewId: null, offset: null }),
        }
      : null,
    outcome
      ? {
          label: "Outcome",
          value: getOutcomeLabel(outcome),
          valueKey: getOutcomeLabel(outcome),
          onRemove: () => replaceUsageSearchParams({ outcome: null, status: null, statusGroup: null, savedViewId: null, offset: null }),
        }
      : null,
    surface
      ? {
          label: "Surface",
          value: getSurfaceLabel(surface),
          valueKey: getSurfaceLabel(surface),
          onRemove: () => replaceUsageSearchParams({ surface: null, savedViewId: null, offset: null }),
        }
      : null,
    minLatencyMs !== null
      ? {
          label: "Latency floor",
          value: `${formatInteger(minLatencyMs)} ms`,
          onRemove: () => replaceUsageSearchParams({ minLatencyMs: null, savedViewId: null, offset: null }),
        }
      : null,
    sortBy
      ? {
          label: "Sort",
          value: getSortLabel(sortBy),
          valueKey: getSortLabel(sortBy),
          onRemove: () => replaceUsageSearchParams({ sortBy: null, savedViewId: null, offset: null }),
        }
      : null,
    model
      ? {
          label: "Model",
          value: model,
          onRemove: () => replaceUsageSearchParams({ model: null, savedViewId: null, offset: null }),
        }
      : null,
    virtualKeyId
      ? {
          label: "Virtual key",
          value: virtualKeyId,
          onRemove: () => replaceUsageSearchParams({ virtualKeyId: null, savedViewId: null, offset: null }),
        }
      : null,
    providerConnectionId
      ? {
          label: "Provider connection",
          value: providerConnectionId,
          onRemove: () => replaceUsageSearchParams({ providerConnectionId: null, savedViewId: null, offset: null }),
        }
      : null,
    budgetPolicyId
      ? {
          label: "Budget policy",
          value: budgetPolicyId,
          onRemove: () => replaceUsageSearchParams({ budgetPolicyId: null, savedViewId: null, offset: null }),
        }
      : null,
    requestId
      ? {
          label: "Gateway request",
          value: requestId,
          onRemove: () => replaceUsageSearchParams({ requestId: null, savedViewId: null, offset: null }),
        }
      : null,
    providerRequestId
      ? {
          label: "Provider request",
          value: providerRequestId,
          onRemove: () => replaceUsageSearchParams({ providerRequestId: null, savedViewId: null, offset: null }),
        }
      : null,
    from
      ? {
          label: "From",
          value: formatFilterDateTime(from),
          onRemove: () => replaceUsageSearchParams({ from: null, savedViewId: null, offset: null }),
        }
      : null,
    to
      ? {
          label: "To",
          value: formatFilterDateTime(to),
          onRemove: () => replaceUsageSearchParams({ to: null, savedViewId: null, offset: null }),
        }
      : null,
  ].filter((chip): chip is { label: string; value: string; onRemove: () => void } => Boolean(chip));
  const localizedActiveFilterChips = activeFilterChips.map((chip) => ({
    ...chip,
    label: tr(chip.label),
    value: chip.value,
  }));
  const suggestedSavedViewName = [
    budgetPolicyId ? tr("usage.savedViewNames.budgetIncident")
    : requestId ? tr("usage.savedViewNames.gatewayRequest")
    : providerRequestId ? tr("usage.savedViewNames.upstreamRequest")
    : outcome ? getOutcomeLabel(outcome)
    : surface ? getSurfaceLabel(surface)
    : tr("usage.savedViewNames.default"),
    selectedProjectId ? projectById.get(selectedProjectId)?.name ?? selectedProjectId : null,
    selectedEnvironmentId ? environmentById.get(selectedEnvironmentId)?.name ?? selectedEnvironmentId : null,
  ]
    .filter((value): value is string => Boolean(value))
    .map((value, index) => (index === 0 ? capitalizeLabel(value) : value))
    .join(" · ");
  const savedViewEntries = savedViews.map((savedView: SavedView) => {
    const filters = savedView.filters as Record<string, unknown>;
    const storedFilterCount = Object.values(filters).filter((value) => value !== null && value !== "").length;
    const recentAt = savedView.lastOpenedAt ?? savedView.updatedAt;
    const recentAtMs = new Date(recentAt).getTime();
    const updatedAtMs = new Date(savedView.updatedAt).getTime();
    const activityLabel =
      savedView.lastOpenedAt ? tr("Opened {time}", { time: formatSavedViewTimestamp(savedView.lastOpenedAt) }) : tr("Updated {time}", { time: formatSavedViewTimestamp(savedView.updatedAt) });

    return {
      id: savedView.id,
      label: savedView.name,
      hint: tr("{activity} · {count} stored filters", { activity: activityLabel, count: storedFilterCount }),
      href: appendSavedViewId(
        buildUsageEventsHref({
          workspaceId: selectedWorkspaceId,
          projectId: typeof filters.projectId === "string" ? filters.projectId : null,
          environmentId: typeof filters.environmentId === "string" ? filters.environmentId : null,
          virtualKeyId: typeof filters.virtualKeyId === "string" ? filters.virtualKeyId : null,
          providerConnectionId: typeof filters.providerConnectionId === "string" ? filters.providerConnectionId : null,
          budgetPolicyId: typeof filters.budgetPolicyId === "string" ? filters.budgetPolicyId : null,
          provider: typeof filters.provider === "string" ? filters.provider : null,
          model: typeof filters.model === "string" ? filters.model : null,
          requestId: typeof filters.requestId === "string" ? filters.requestId : null,
          providerRequestId: typeof filters.providerRequestId === "string" ? filters.providerRequestId : null,
          outcome: typeof filters.outcome === "string" ? (filters.outcome as OutcomeFilter) : null,
          surface: typeof filters.surface === "string" ? (filters.surface as SurfaceFilter) : null,
          minLatencyMs:
            typeof filters.minLatencyMs === "number" ? filters.minLatencyMs
            : typeof filters.minLatencyMs === "string" && filters.minLatencyMs.trim().length ? Number.parseInt(filters.minLatencyMs, 10)
            : null,
          sortBy: typeof filters.sortBy === "string" ? (filters.sortBy as SortFilter) : null,
          from: typeof filters.from === "string" ? filters.from : null,
          to: typeof filters.to === "string" ? filters.to : null,
          savedViewId: savedView.id,
          returnTo,
          offset: 0,
        }),
        savedView.id,
      ),
      active: savedView.id === savedViewId,
      recentAtMs,
      updatedAtMs,
      lastOpenedAt: savedView.lastOpenedAt,
    };
  });
  const recentSavedViews = [...savedViewEntries]
    .sort((left, right) => right.recentAtMs - left.recentAtMs || right.updatedAtMs - left.updatedAtMs || compareLabels(left.label, right.label))
    .slice(0, 3)
    .map(({ recentAtMs: _recentAtMs, updatedAtMs: _updatedAtMs, lastOpenedAt: _lastOpenedAt, ...view }) => ({
      ...view,
      badgeLabel: view.active ? "open" : "recent",
    }));
  const teamSharedViews = [...savedViewEntries]
    .sort((left, right) => right.updatedAtMs - left.updatedAtMs || right.recentAtMs - left.recentAtMs || compareLabels(left.label, right.label))
    .map(({ recentAtMs: _recentAtMs, updatedAtMs: _updatedAtMs, lastOpenedAt, ...view }) => ({
      ...view,
      badgeLabel: view.active ? "open" : lastOpenedAt ? "shared" : "new",
    }));
  const savedViewNoticeState =
    savedViewNotice && savedViewMessage
      ? {
          tone: savedViewNotice,
          message: savedViewMessage,
        }
      : null;
  const activeSavedViewConfig = activeSavedView
    ? {
        savedViewId: activeSavedView.id,
        workspaceId: selectedWorkspaceId,
        surface: "usage-events" as const,
        redirectPath,
        filtersJson: JSON.stringify(persistedViewFilters),
        name: activeSavedView.name,
        hint: activeSavedView.lastOpenedAt
          ? `Opened ${formatSavedViewTimestamp(activeSavedView.lastOpenedAt)} · updated ${formatSavedViewTimestamp(activeSavedView.updatedAt)}`
          : `Created ${formatSavedViewTimestamp(activeSavedView.createdAt)} · update this shared lane after refining the current filters.`,
      }
    : null;
  const savedViewSections: SavedViewBarSection[] = [
    {
      key: "default",
      title: tr("Default views"),
      description: tr("Quick filters for usage investigations."),
      items: localizedQuickViews,
      emptyMessage: tr("Default usage views are unavailable right now."),
    },
    {
      key: "recent",
      title: tr("Recent views"),
      description: tr("Recently used filters."),
      items: recentSavedViews,
      emptyMessage: tr("Save a usage view once and it will show up here for quick repeat work."),
    },
    {
      key: "team-shared",
      title: tr("Team shared views"),
      description: tr("Shared investigations for the team."),
      items: teamSharedViews,
      emptyMessage: tr("No team-shared usage views exist yet."),
      allowDelete: true,
    },
  ];
  const selectedWorkspace =
    workspaceOptions.find((workspace) => workspace.id === selectedWorkspaceId) ?? null;
  const selectedWorkspaceLabel = selectedWorkspace
    ? `${selectedWorkspace.organizationName} / ${selectedWorkspace.name}`
    : null;
  const usageExportsHref = buildExportHref({
    ...pageFilters,
    returnTo: redirectPath,
  });
  const clearFiltersHref = buildUsageEventsHref({
    workspaceId: selectedWorkspaceId,
    projectId: null,
    environmentId: null,
    virtualKeyId: null,
    providerConnectionId: null,
    budgetPolicyId: null,
    provider: null,
    model: null,
    requestId: null,
    providerRequestId: null,
    outcome: null,
    surface: null,
    minLatencyMs: null,
    sortBy: null,
    from: null,
    to: null,
    savedViewId,
    returnTo,
    offset: 0,
  });
  const currentScopeLabel = [
    selectedProjectId ? projectById.get(selectedProjectId)?.name ?? selectedProjectId : tr("All projects"),
    selectedEnvironmentId
      ? environmentById.get(selectedEnvironmentId)
        ? `${environmentById.get(selectedEnvironmentId)?.name} (${environmentById.get(selectedEnvironmentId)?.runtime})`
        : selectedEnvironmentId
      : tr("All environments"),
    provider ? `${tr("Provider")} ${provider}` : tr("All providers"),
    outcome ? `${tr("Outcome")} ${tr(getOutcomeLabel(outcome))}` : tr("All outcomes"),
  ].join(" · ");
  const activityStatusLabel =
    attentionCount > 0
      ? tr("usage.summary.attention", { count: formatInteger(attentionCount) })
      : usage.total > 0
        ? tr("usage.summary.healthy")
        : tr("usage.summary.empty");
  const visibleRangeLabel =
    usage.total > 0
      ? tr("Showing {start}-{end} of {total} events", { start: pageStart, end: pageEnd, total: formatInteger(usage.total) })
      : null;
  const usageFiltersPanel = (
    <>
      <ResourceDashboard>
        <ResourceDashboardCard className="lg:col-span-2">
          <TrendLineChart
            data={usageTrendData}
            title={tr("usage.investigation.trend.label") || tr("Request Volume Trend")}
            description={tr("Total gateway requests over time")}
            variant="bars"
          />
        </ResourceDashboardCard>
        <ResourceDashboardCard>
          {providerChartData.length ? (
            <StatusRingChart
              data={providerChartData}
              title={tr("usage.investigation.provider.label") || tr("Provider Distribution")}
              centerValue={formatInteger(summary.totalEvents)}
              centerLabel={tr("Total Events")}
              variant="stacked"
            />
          ) : (
            <div className="flex h-[140px] flex-col gap-2 px-1">
              <div>
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground/80">
                  {tr("usage.investigation.provider.label") || tr("Provider Distribution")}
                </h3>
              </div>
              <div className="flex min-h-0 flex-1 flex-col justify-between rounded-xl border border-dashed border-border/45 bg-muted/10 px-4 py-3">
                <p className="text-sm font-semibold text-foreground">{tr("Total Events")}</p>
                <div className="space-y-1">
                  <p className="text-2xl font-semibold tabular-nums text-foreground">{formatInteger(summary.totalEvents)}</p>
                  <p className="text-xs text-muted-foreground">{tr("usage.summary.empty")}</p>
                </div>
              </div>
            </div>
          )}
        </ResourceDashboardCard>
        <ResourceDashboardCard>
          <div className="flex h-full flex-col gap-4 py-1">
            <div className="space-y-1">
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground/80">
                {tr("Economic Summary")}
              </h3>
              <div className="pt-2">
                <p className="text-[24px] font-bold text-foreground">{formatUsd(summary.totalCostUsd)}</p>
                <p className="text-[10px] text-muted-foreground uppercase">{tr("Total Estimated Cost")}</p>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-border/45 bg-muted/10 px-3 py-2.5">
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                  {tr("Tokens")}
                </p>
                <p className="mt-1 text-base font-semibold tabular-nums text-foreground">
                  {formatInteger(summary.totalTokens)}
                </p>
              </div>
              <div className="rounded-xl border border-border/45 bg-muted/10 px-3 py-2.5">
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                  {tr("Success Rate")}
                </p>
                <p className="mt-1 text-base font-semibold tabular-nums text-foreground">
                  {formatPercent(summary.successRate)}
                </p>
              </div>
              <div className="rounded-xl border border-border/45 bg-muted/10 px-3 py-2.5 sm:col-span-2">
                <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                  <span>{tr("Token Mix")}</span>
                  <span>{formatInteger(summary.totalPromptTokens + summary.totalCompletionTokens)}</span>
                </div>
                <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-muted/45">
                  <span className="rounded-full bg-foreground/85" style={{ width: `${promptTokenShare * 100}%` }} />
                  <span className="rounded-full bg-[color:var(--border-strong)]" style={{ width: `${completionTokenShare * 100}%` }} />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3 text-[11px]">
                  <div className="space-y-1">
                    <p className="text-muted-foreground">{tr("Prompt Tokens")}</p>
                    <p className="font-semibold tabular-nums text-foreground">
                      {formatInteger(summary.totalPromptTokens)}
                      <span className="ml-1 text-muted-foreground">{formatPercent(promptTokenShare)}</span>
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-muted-foreground">{tr("Completion Tokens")}</p>
                    <p className="font-semibold tabular-nums text-foreground">
                      {formatInteger(summary.totalCompletionTokens)}
                      <span className="ml-1 text-muted-foreground">{formatPercent(completionTokenShare)}</span>
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </ResourceDashboardCard>
      </ResourceDashboard>

      <ResourceDashboard className="mt-4">
        <ResourceDashboardCard>
          <StatusRingChart
            data={statusChartData.length ? statusChartData : [{ name: tr("No matching event"), value: 0, color: "var(--border-default)" }]}
            title={tr("Status Distribution")}
            description={tr("Distribution by event outcome")}
            centerValue={formatInteger(summary.totalEvents)}
            centerLabel={tr("Events")}
            variant="stacked"
          />
        </ResourceDashboardCard>
        <ResourceDashboardCard>
          <StatusRingChart
            data={modelChartData.length ? modelChartData : [{ name: tr("n/a"), value: 0, color: "var(--border-default)" }]}
            title={tr("Model Distribution")}
            description={tr("Most active models in current scope")}
            centerValue={formatInteger(modelChartData.reduce((sum, item) => sum + item.value, 0))}
            centerLabel={tr("Events")}
            variant="stacked"
          />
        </ResourceDashboardCard>
        <ResourceDashboardCard>
          <TrendLineChart
            data={tokenTrendData}
            title={tr("Token Trend")}
            description={tr("Total tokens over time")}
            variant="line"
          />
        </ResourceDashboardCard>
        <ResourceDashboardCard>
          <TrendLineChart
            data={costTrendData}
            title={tr("Cost Trend")}
            description={tr("Estimated cost over time")}
            variant="area"
          />
        </ResourceDashboardCard>
      </ResourceDashboard>

      <CompactToolbar
        query={model ?? ""}
        onQueryChange={(val) => replaceUsageSearchParams({ model: val, offset: null })}
        filterCount={localizedActiveFilterChips.length}
        onResetFilters={() => window.location.href = localizeHref(clearFiltersHref, locale)}
        placeholder={tr("Model placeholder")}
        actions={
          <Button asChild size="sm" variant="outline" className="rounded-full">
            <Link href={usageExportsHref}>
              {tr("Export Usage")}
            </Link>
          </Button>
        }
      >
        <form action="/usage-events" className="space-y-4" method="get">
          <input name="workspaceId" type="hidden" value={selectedWorkspaceId ?? ""} />
          <FilterField label={tr("Project")}>
            <select
              className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
              id="projectId"
              name="projectId"
              defaultValue={selectedProjectId ?? ""}
            >
              <option value="">{tr("All projects")}</option>
              {sortedProjects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </FilterField>
          <FilterField label={tr("Environment")}>
            <select
              className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
              id="environmentId"
              name="environmentId"
              defaultValue={selectedEnvironmentId ?? ""}
            >
              <option value="">{tr("All environments")}</option>
              {filteredEnvironmentOptions.map((environment) => (
                <option key={environment.id} value={environment.id}>
                  {environment.name} ({environment.runtime})
                </option>
              ))}
            </select>
          </FilterField>
          <FilterField label={tr("Outcome")}>
            <select
              className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
              id="outcome"
              name="outcome"
              defaultValue={outcome ?? ""}
            >
              <option value="">{tr("All outcomes")}</option>
              <option value="attention">{tr("Needs attention")}</option>
              {statusOptions.map((statusOption) => (
                <option key={statusOption} value={statusOption}>
                  {tr(statusOption)}
                </option>
              ))}
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
    </>
  );

  return (
    <AppShell
      headerMode="compact"
      sidebarVariant="minimal"
      showOperatorContextCards={false}
      showSupportPanels={false}
      title={tr("Usage")}
      subtitle=""
      workspaceId={selectedWorkspaceId}
      workspaceLabel={selectedWorkspaceLabel}
    >
      <section className="space-y-6">
        {usageFiltersPanel}
        <Card>
          <CardHeader className="pb-4">
            <div className="space-y-1">
              <h2 className="text-[16px] font-semibold tracking-[-0.02em] text-foreground">{tr("Usage events")}</h2>
              {visibleRangeLabel ? <p className="text-sm text-muted-foreground">{visibleRangeLabel}</p> : null}
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            {loadError ? <p>{tr(loadError)}</p> : null}
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
              <p>{activityStatusLabel}</p>
            </div>

            {budgetPolicyId ? (
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status="scoped">{tr("usage.budgetPolicyBadge", { id: budgetPolicyId })}</StatusBadge>
                <Button asChild size="sm" variant="outline">
                  <Link href={buildBudgetAlertsHref(selectedWorkspaceId, budgetPolicyId, redirectPath, "open")}>{tr("Alerts")}</Link>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link href={buildBudgetHref(selectedWorkspaceId, budgetPolicyId, redirectPath)}>{tr("Budget")}</Link>
                </Button>
              </div>
            ) : null}

            {usage.items.length ? (
              <div className="space-y-6">
                {/* Mobile Card View */}
                <div className="grid gap-4 md:hidden">
                  {usage.items.map((event) => {
                    const eventOutcome = describeUsageEventOutcome(event);
                    const eventSurface = getUsageEventSurface(event);
                    const eventHeadline = formatUsageEventHeadline({
                      httpStatus: eventSurface.httpStatus,
                      reasonLabel: eventOutcome.reasonLabel,
                      status: event.status,
                      tr,
                    });
                    const usagePrimary = formatUsageValuePrimary({
                      costUsd: event.costUsd,
                      totalTokens: event.totalTokens,
                      formatUsd,
                      formatInteger,
                      locale,
                    });

                    return (
                      <div key={event.id} className="rounded-2xl border border-border/55 bg-muted/10 p-4 space-y-4">
                        <div className="flex justify-between items-start gap-3">
                          <div className="space-y-1">
                            <p className="text-[13px] font-bold text-foreground">{tr(eventSurface.displayName)}</p>
                            <p className="text-[11px] text-muted-foreground">{formatDateTime(event.createdAt)}</p>
                          </div>
                          <StatusBadge status={usageStatusBadgeTone[getUsageEventStatusTone(event.status)]} className="h-5 px-1.5 text-[9px] uppercase font-bold">
                            {tr(event.status)}
                          </StatusBadge>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-4 pt-2 border-t border-border/40">
                          <div className="space-y-1">
                            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">{tr("Usage")}</p>
                            <p className="text-[12px] font-semibold text-foreground">{usagePrimary}</p>
                          </div>
                          <div className="space-y-1 text-right">
                            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">{tr("Latency")}</p>
                            <p className="text-[12px] font-semibold text-foreground">{formatInteger(event.latencyMs)} ms</p>
                          </div>
                        </div>

                        <div className="flex justify-end pt-1">
                          <Button asChild variant="secondary" size="sm" className="rounded-full h-8 px-4 text-[11px] font-bold">
                            <Link href={buildUsageEventHref(event.id, redirectPath)}>
                              {tr("View event")}
                            </Link>
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Desktop Table View */}
                <div className="hidden md:block table-wrap">
                  <table className="table table--compact">
                    <thead>
                      <tr>
                        <th className="w-[160px]">{tr("Time")}</th>
                        <th>{tr("Event")}</th>
                        <th className="w-[180px]">{tr("Scope")}</th>
                        <th className="w-[140px] text-right">{tr("Usage")}</th>
                        <th className="w-[100px] text-center">{tr("Status")}</th>
                        <th className="w-[80px]"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {usage.items.map((event) => {
                        const eventProject = event.projectId ? projectById.get(event.projectId) ?? null : null;
                        const eventEnvironment = event.environmentId ? environmentById.get(event.environmentId) ?? null : null;
                        const eventOutcome = describeUsageEventOutcome(event);
                        const eventSurface = getUsageEventSurface(event);
                        const eventHeadline = formatUsageEventHeadline({
                          httpStatus: eventSurface.httpStatus,
                          reasonLabel: eventOutcome.reasonLabel,
                          status: event.status,
                          tr,
                        });
                        const providerLabel = formatUsageEventProviderLabel(event, eventSurface, tr);
                        const visibleTags = eventSurface.tags.filter((tag) => !tag.label.startsWith("HTTP "));
                        const usagePrimary = formatUsageValuePrimary({
                          costUsd: event.costUsd,
                          totalTokens: event.totalTokens,
                          formatUsd,
                          formatInteger,
                          locale,
                        });

                        return (
                          <tr key={event.id} className="group transition-colors hover:bg-muted/30">
                            <td className="text-[12px] tabular-nums text-muted-foreground">
                              {formatDateTime(event.createdAt)}
                            </td>
                            <td>
                              <div className="flex flex-col gap-0.5">
                                <div className="flex items-center gap-2">
                                  <span className="text-[13px] font-bold text-foreground">{tr(eventSurface.displayName)}</span>
                                  <span className="text-[11px] text-muted-foreground opacity-80">{providerLabel}</span>
                                </div>
                                <span className="text-[11px] text-muted-foreground line-clamp-1">{eventHeadline}</span>
                                {visibleTags.length ? (
                                  <div className="flex flex-wrap gap-1 mt-1">
                                    {visibleTags.map((tag) => (
                                      <span key={tag.label} className={cn(getTagClassName(tag.tone), "text-[9px] px-1 h-4 leading-none uppercase font-bold")}>
                                        {tr(tag.label)}
                                      </span>
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                            </td>
                            <td>
                              <div className="flex flex-col gap-0.5">
                                <span className="text-[12px] font-semibold text-foreground truncate">
                                  {eventProject ? translateInlineText(locale, eventProject.name) : tr("workspace-scope")}
                                </span>
                                <span className="text-[11px] text-muted-foreground opacity-80">
                                  {eventEnvironment ? formatEnvironmentOptionLabel(eventEnvironment, locale) : tr("No environment")}
                                </span>
                              </div>
                            </td>
                            <td className="text-right">
                              <div className="flex flex-col">
                                <span className="text-[12px] font-bold text-foreground">{usagePrimary}</span>
                                <span className="text-[10px] text-muted-foreground">{formatInteger(event.latencyMs)} ms</span>
                              </div>
                            </td>
                            <td className="text-center">
                              <StatusBadge status={usageStatusBadgeTone[getUsageEventStatusTone(event.status)]} className="h-4.5 px-1.5 text-[9px] uppercase font-bold">
                                {tr(event.status)}
                              </StatusBadge>
                            </td>
                            <td>
                              <Button asChild variant="ghost" size="icon" className="h-8 w-8 rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
                                <Link href={buildUsageEventHref(event.id, redirectPath)}>
                                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                  </svg>
                                </Link>
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="inline-actions">
                    <span className="meta">
                      {tr("Page size")}: <span className="meta-strong">{defaultPageSize}</span>
                    </span>
                  </div>
                  <div className="pagination__controls">
                    {hasPreviousPage ? (
                      <Button asChild size="sm" variant="outline">
                        <Link
                          href={buildUsageEventsHref({
                            ...pageFilters,
                            offset: Math.max(offset - defaultPageSize, 0),
                          })}
                        >
                          {tr("Previous page")}
                        </Link>
                      </Button>
                    ) : (
                      <Button disabled size="sm" type="button" variant="outline">
                        {tr("Previous page")}
                      </Button>
                    )}
                    {hasNextPage ? (
                      <Button asChild size="sm">
                        <Link
                          href={buildUsageEventsHref({
                            ...pageFilters,
                            offset: offset + defaultPageSize,
                          })}
                        >
                          {tr("Next page")}
                        </Link>
                      </Button>
                    ) : (
                      <Button disabled size="sm" type="button">
                        {tr("Next page")}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <EmptyState
                compact
                title={tr("No matching event")}
                description={tr("No usage events matched the current filters yet")}
                className="border-dashed bg-muted/10"
              />
            )}
          </CardContent>
        </Card>

        <SavedViewBar
          variant="strip"
          createAction={savedViewsIssue ? undefined : createSavedViewAction}
          deleteAction={savedViewsIssue ? undefined : deleteSavedViewAction}
          description={tr("Saved filters for this view")}
          title={tr("Saved views")}
          sections={savedViewSections}
          notice={savedViewNoticeState}
          saveConfig={
            savedViewsIssue
              ? null
              : {
                  workspaceId: selectedWorkspaceId,
                  surface: "usage-events",
                  redirectPath,
                  filtersJson: JSON.stringify(persistedViewFilters),
                  suggestedName: suggestedSavedViewName,
                }
          }
          activeConfig={savedViewsIssue ? null : activeSavedViewConfig}
        />
        {savedViewsIssue ? (
          <ControlApiStatusCard issue={savedViewsIssue} heading={tr("Saved views are unavailable")} mode="inline" />
        ) : null}
      </section>
    </AppShell>
  );
}
