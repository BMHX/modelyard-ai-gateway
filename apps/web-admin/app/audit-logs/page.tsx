"use client";

import { Link, useRouter } from "@/i18n/navigation";
import {
  useCallback,
  useEffect,
  useState,
  useTransition,
  type FormEvent,
} from "react";
import { useSearchParams } from "next/navigation";
import type { Environment, Project, SavedView } from "@teamops/contracts";

import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { AppShell } from "../components/app-shell";
import { ControlApiStatusCard } from "../components/control-api-status-card";
import { CompactToolbar, FilterField } from "../components/resource-compact-toolbar";
import { ResourceTableSection } from "../components/resource-table-section";
import {
  SavedViewBar,
  type SavedViewBarSection,
} from "../components/saved-view-bar";
import { useAuditPageQuery } from "../lib/console-api-client";
import enAuditMessages from "../messages/en/audit.json";
import zhAuditMessages from "../messages/zh/audit.json";
import { type AppLocale, translateInlineText } from "../lib/i18n";
import { useLocalePreference } from "../lib/i18n-client";
import { formatAuditActorLabel } from "../lib/audit-display";
import { getSafeReturnTo } from "../lib/navigation";
import { createSavedViewAction, deleteSavedViewAction, updateSavedViewAction } from "../saved-views/actions";
import {
  buildAuditActiveFilterChips,
} from "./audit-layout";

type RawSearchParams = {
  workspaceId?: string;
  projectId?: string;
  environmentId?: string;
  actorType?: string;
  actorId?: string;
  action?: string;
  subjectType?: string;
  subjectId?: string;
  from?: string;
  to?: string;
  offset?: string;
  savedViewId?: string;
  savedViewNotice?: string;
  savedViewMessage?: string;
  returnTo?: string;
  displayMode?: DisplayMode;
};

type DisplayMode = "focus-board" | "dense-table";

type AuditFilterDraft = {
  workspaceId: string;
  projectId: string;
  environmentId: string;
  actorType: string;
  actorId: string;
  action: string;
  subjectType: string;
  subjectId: string;
  from: string;
  to: string;
};

const projectStatusOrder = {
  active: 0,
  archived: 1,
} satisfies Record<Project["status"], number>;
const environmentStatusOrder = {
  active: 0,
  archived: 1,
} satisfies Record<Environment["status"], number>;
const defaultPageSize = 50;

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

function parseOffset(value: string | undefined) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }

  return parsed;
}

function buildAuditLogsHref(filters: {
  workspaceId: string | null;
  projectId: string | null;
  environmentId: string | null;
  actorType: string | null;
  actorId: string | null;
  action: string | null;
  subjectType: string | null;
  subjectId: string | null;
  from: string | null;
  to: string | null;
  savedViewId?: string | null;
  offset?: number;
  returnTo?: string | null;
  displayMode?: DisplayMode | null;
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
  if (filters.actorType) {
    params.set("actorType", filters.actorType);
  }
  if (filters.actorId) {
    params.set("actorId", filters.actorId);
  }
  if (filters.action) {
    params.set("action", filters.action);
  }
  if (filters.subjectType) {
    params.set("subjectType", filters.subjectType);
  }
  if (filters.subjectId) {
    params.set("subjectId", filters.subjectId);
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
  if (filters.displayMode) {
    params.set("displayMode", filters.displayMode);
  }
  if ((filters.offset ?? 0) > 0) {
    params.set("offset", String(filters.offset));
  }
  if (safeReturnTo) {
    params.set("returnTo", safeReturnTo);
  }

  const query = params.toString();
  return query ? `/audit-logs?${query}` : "/audit-logs";
}

function buildExportHref(filters: {
  workspaceId: string | null;
  projectId: string | null;
  environmentId: string | null;
  actorType: string | null;
  actorId: string | null;
  action: string | null;
  subjectType: string | null;
  subjectId: string | null;
  from: string | null;
  to: string | null;
  returnTo?: string | null;
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
  if (filters.actorType) {
    params.set("actorType", filters.actorType);
  }
  if (filters.actorId) {
    params.set("actorId", filters.actorId);
  }
  if (filters.action) {
    params.set("action", filters.action);
  }
  if (filters.subjectType) {
    params.set("subjectType", filters.subjectType);
  }
  if (filters.subjectId) {
    params.set("subjectId", filters.subjectId);
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

  params.set("kind", "audit-logs");
  return `/exports?${params.toString()}`;
}

function appendSavedViewId(href: string, savedViewId: string) {
  const url = new URL(href, "http://localhost");
  url.searchParams.set("savedViewId", savedViewId);
  return `${url.pathname}${url.search}`;
}

function getSavedViewNoticeTone(value: string | null): "success" | "error" | null {
  if (value === "success" || value === "error") {
    return value;
  }

  return null;
}

function summarizeAuditPayload(
  value: unknown,
  tr: (text: string) => string,
  maxLength = 180,
) {
  if (!value) {
    return tr("No payload");
  }

  if (typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const parts: string[] = [];

    if (typeof record.label === "string" && record.label.trim()) {
      parts.push(tr(record.label));
    }
    if (typeof record.kind === "string" && record.kind.trim()) {
      parts.push(tr(record.kind));
    }
    if (typeof record.fileName === "string" && record.fileName.trim()) {
      parts.push(tr(record.fileName));
    }
    if (typeof record.keyPrefix === "string" && record.keyPrefix.trim()) {
      parts.push(tr("Masked key fragment"));
    }
    if (typeof record.provider === "string" && record.provider.trim()) {
      parts.push(tr(record.provider));
    }
    if (typeof record.environment === "string" && record.environment.trim()) {
      parts.push(tr(record.environment));
    }
    if (typeof record.rowCount === "number" && Number.isFinite(record.rowCount)) {
      parts.push(`${record.rowCount} ${tr("rows")}`);
    }

    if (parts.length) {
      return parts.slice(0, 4).join(" · ");
    }

    const fieldLabels = Object.keys(record)
      .slice(0, 3)
      .map((key) => tr(key));
    if (fieldLabels.length) {
      return `${tr("Payload fields")}: ${fieldLabels.join(" · ")}`;
    }
  }

  const normalized = JSON.stringify(value);
  if (!normalized) {
    return tr("No payload");
  }

  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}

type TranslationValues = Record<string, string | number>

function formatMessage(template: string, values?: TranslationValues) {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? `{${key}}`));
}

function resolveAuditMessage(messages: Record<string, unknown>, key: string): string | null {
  const exact = messages[key];
  if (typeof exact === "string") return exact;

  const nested = key.split(".").reduce<unknown>((current, part) => {
    if (!current || typeof current !== "object" || !(part in (current as Record<string, unknown>))) {
      return null;
    }

    return (current as Record<string, unknown>)[part];
  }, messages);

  return typeof nested === "string" ? nested : null;
}

function createAuditTranslator(locale: AppLocale) {
  const messages = (locale === "zh" ? zhAuditMessages : enAuditMessages) as Record<string, unknown>;
  return (text: string, values?: TranslationValues) => {
    const template = resolveAuditMessage(messages, text) ?? translateInlineText(locale, text);
    return formatMessage(template, values);
  };
}

function formatAuditPayloadDetails(value: unknown) {
  if (!value) {
    return null;
  }

  const normalized = JSON.stringify(value, null, 2);
  return normalized && normalized !== "null" ? normalized : null;
}

export default function AuditLogsPage() {
  const [hasMounted, setHasMounted] = useState(false);
  const router = useRouter();
  const [isViewPending, startViewTransition] = useTransition();
  const { locale } = useLocalePreference();
  const searchParams = useSearchParams() ?? new URLSearchParams();
  const tr = createAuditTranslator(locale);
  const { compareLabels, formatDateTime, formatSavedViewTimestamp } = createFormatters(locale);
  const returnTo = getSafeReturnTo(searchParams.get("returnTo"));
  const requestedWorkspaceId = getOptionalFilter(searchParams.get("workspaceId") ?? undefined);
  const auditPageQuery = useAuditPageQuery({
    workspaceId: requestedWorkspaceId,
    projectId: getOptionalFilter(searchParams.get("projectId") ?? undefined),
    environmentId: getOptionalFilter(searchParams.get("environmentId") ?? undefined),
    actorType: getOptionalFilter(searchParams.get("actorType") ?? undefined),
    actorId: getOptionalFilter(searchParams.get("actorId") ?? undefined),
    action: getOptionalFilter(searchParams.get("action") ?? undefined),
    subjectType: getOptionalFilter(searchParams.get("subjectType") ?? undefined),
    subjectId: getOptionalFilter(searchParams.get("subjectId") ?? undefined),
    from: getOptionalFilter(searchParams.get("from") ?? undefined),
    to: getOptionalFilter(searchParams.get("to") ?? undefined),
    offset: parseOffset(searchParams.get("offset") ?? undefined),
  });
  const response = auditPageQuery.data;
  useEffect(() => {
    setHasMounted(true);
  }, []);
  const workspaceOptions = response?.workspaceOptions ?? [];
  const selectedWorkspaceId = response?.selectedWorkspaceId ?? null;
  const selectedWorkspace =
    selectedWorkspaceId ? workspaceOptions.find((workspace) => workspace.id === selectedWorkspaceId) ?? null : null;
  const workspaceLabelById = new Map(
    workspaceOptions.map((workspace) => [
      workspace.id,
      `${workspace.organizationName} / ${workspace.name}`,
    ]),
  );
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
  const rawProjectId = getOptionalFilter(searchParams.get("projectId") ?? undefined);
  const selectedProjectId =
    selectedWorkspaceId && rawProjectId && sortedProjects.some((project) => project.id === rawProjectId) ? rawProjectId : null;
  const currentEnvironmentOptions = selectedProjectId
    ? sortedEnvironments.filter((environment) => environment.projectId === selectedProjectId)
    : sortedEnvironments;
  const rawEnvironmentId = getOptionalFilter(searchParams.get("environmentId") ?? undefined);
  const selectedEnvironmentId =
    selectedWorkspaceId && rawEnvironmentId && currentEnvironmentOptions.some((environment) => environment.id === rawEnvironmentId)
      ? rawEnvironmentId
      : null;
  const workspaceId = selectedWorkspaceId;
  const projectId = selectedWorkspaceId ? selectedProjectId : rawProjectId;
  const environmentId = selectedWorkspaceId ? selectedEnvironmentId : rawEnvironmentId;
  const actorType = getOptionalFilter(searchParams.get("actorType") ?? undefined);
  const actorId = getOptionalFilter(searchParams.get("actorId") ?? undefined);
  const action = getOptionalFilter(searchParams.get("action") ?? undefined);
  const subjectType = getOptionalFilter(searchParams.get("subjectType") ?? undefined);
  const subjectId = getOptionalFilter(searchParams.get("subjectId") ?? undefined);
  const from = getOptionalFilter(searchParams.get("from") ?? undefined);
  const to = getOptionalFilter(searchParams.get("to") ?? undefined);
  const requestedSavedViewId = getOptionalFilter(searchParams.get("savedViewId") ?? undefined);
  const savedViewNotice = getSavedViewNoticeTone(getOptionalFilter(searchParams.get("savedViewNotice") ?? undefined));
  const savedViewMessage = getOptionalFilter(searchParams.get("savedViewMessage") ?? undefined);
  const requestedDisplayMode = searchParams.get("displayMode") ?? undefined;
  const displayMode: DisplayMode = requestedDisplayMode === "dense-table" ? "dense-table" : "focus-board";
  const offset = parseOffset(searchParams.get("offset") ?? undefined);
  const auditLogResult = response?.audit ?? {
    items: [],
    total: 0,
  };
  const loadError = response?.loadError ?? null;
  const projectById = new Map(sortedProjects.map((project) => [project.id, project]));
  const environmentById = new Map(sortedEnvironments.map((environment) => [environment.id, environment]));
  const pageFiltersBase = {
    workspaceId,
    projectId,
    environmentId,
    actorType,
    actorId,
    action,
    subjectType,
    subjectId,
    from,
    to,
    returnTo,
    displayMode,
  };
  const currentFilterDraft: AuditFilterDraft = {
    workspaceId: workspaceId ?? "",
    projectId: projectId ?? "",
    environmentId: environmentId ?? "",
    actorType: actorType ?? "",
    actorId: actorId ?? "",
    action: action ?? "",
    subjectType: subjectType ?? "",
    subjectId: subjectId ?? "",
    from: from ?? "",
    to: to ?? "",
  };
  const [filterDraft, setFilterDraft] = useState<AuditFilterDraft>(currentFilterDraft);
  const draftProjectId =
    selectedWorkspaceId &&
    filterDraft.projectId &&
    sortedProjects.some((project) => project.id === filterDraft.projectId)
      ? filterDraft.projectId
      : null;
  const draftEnvironmentOptions = draftProjectId
    ? sortedEnvironments.filter((environment) => environment.projectId === draftProjectId)
    : sortedEnvironments;
  const persistedViewFilters = {
    projectId,
    environmentId,
    actorType,
    actorId,
    action,
    subjectType,
    subjectId,
    from,
    to,
  };
  const savedViews = response?.savedViews ?? [];
  const savedViewsIssue = response?.savedViewsIssue ?? null;
  const activeSavedView = savedViews.find((savedView) => savedView.id === requestedSavedViewId) ?? null;
  const savedViewId = activeSavedView?.id ?? null;
  const pageFilters = {
    ...pageFiltersBase,
    savedViewId,
  };
  const redirectPath = buildAuditLogsHref({
    ...pageFilters,
    offset,
  });
  const clearFiltersHref = buildAuditLogsHref({
    workspaceId,
    projectId: null,
    environmentId: null,
    actorType: null,
    actorId: null,
    action: null,
    subjectType: null,
    subjectId: null,
    from: null,
    to: null,
    savedViewId,
    returnTo,
    displayMode,
  });

  useEffect(() => {
    setFilterDraft(currentFilterDraft);
  }, [
    currentFilterDraft.action,
    currentFilterDraft.actorId,
    currentFilterDraft.actorType,
    currentFilterDraft.environmentId,
    currentFilterDraft.from,
    currentFilterDraft.projectId,
    currentFilterDraft.subjectId,
    currentFilterDraft.subjectType,
    currentFilterDraft.to,
    currentFilterDraft.workspaceId,
  ]);

  const replaceAuditView = useCallback(
    (href: string) => {
      startViewTransition(() => {
        router.replace(href, { scroll: false });
      });
    },
    [router, startViewTransition],
  );

  const buildHrefFromDraft = useCallback(
    (draft: AuditFilterDraft) =>
      buildAuditLogsHref({
        workspaceId: getOptionalFilter(draft.workspaceId),
        projectId: getOptionalFilter(draft.projectId),
        environmentId: getOptionalFilter(draft.environmentId),
        actorType: getOptionalFilter(draft.actorType),
        actorId: getOptionalFilter(draft.actorId),
        action: getOptionalFilter(draft.action),
        subjectType: getOptionalFilter(draft.subjectType),
        subjectId: getOptionalFilter(draft.subjectId),
        from: getOptionalFilter(draft.from),
        to: getOptionalFilter(draft.to),
        savedViewId,
        returnTo,
        displayMode,
      }),
    [displayMode, returnTo, savedViewId],
  );

  const handleFilterDraftChange = useCallback(
    (key: keyof AuditFilterDraft, value: string) => {
      setFilterDraft((current) => {
        if (key === "workspaceId") {
          return {
            ...current,
            workspaceId: value,
            projectId: "",
            environmentId: "",
          };
        }

        if (key === "projectId") {
          return {
            ...current,
            projectId: value,
            environmentId: "",
          };
        }

        return {
          ...current,
          [key]: value,
        };
      });
    },
    [],
  );

  if (!hasMounted || (auditPageQuery.isLoading && !response)) {
    return (
      <AppShell
        headerMode="compact"
        sidebarVariant="minimal"
        showOperatorContextCards={false}
        showSupportPanels={false}
        title={tr("Audit Logs")}
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

  function handleFilterSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    replaceAuditView(buildHrefFromDraft(filterDraft));
  }

  function handleFilterReset() {
    setFilterDraft({
      workspaceId: workspaceId ?? "",
      projectId: "",
      environmentId: "",
      actorType: "",
      actorId: "",
      action: "",
      subjectType: "",
      subjectId: "",
      from: "",
      to: "",
    });
    replaceAuditView(clearFiltersHref);
  }

  const isViewBusy = isViewPending || auditPageQuery.isFetching;

  const pageStart = auditLogResult.total === 0 ? 0 : offset + 1;
  const pageEnd = auditLogResult.total === 0 ? 0 : offset + auditLogResult.items.length;
  const hasPreviousPage = offset > 0;
  const hasNextPage = offset + auditLogResult.items.length < auditLogResult.total;
  const visibleActorCount = new Set(auditLogResult.items.map((entry) => `${entry.actorType}:${entry.actorId}`)).size;
  const visibleActionCount = new Set(auditLogResult.items.map((entry) => entry.action)).size;
  const serviceActorCount = auditLogResult.items.filter((entry) => entry.actorType === "service").length;
  const workspaceSubjectCount = auditLogResult.items.filter((entry) => entry.subjectType === "workspace").length;
  const environmentSubjectCount = auditLogResult.items.filter((entry) => entry.subjectType === "environment").length;
  const quickViewBase = {
    workspaceId,
    projectId,
    environmentId,
    from,
    to,
    savedViewId,
    returnTo,
    actorType: null,
    actorId: null,
    action: null,
    subjectType: null,
    subjectId: null,
  } as const;
  const quickViews = [
    {
      label: "Current scope",
      hint: tr("{count} visible entries across the selected workspace, scope, and time window", { count: auditLogResult.items.length }),
      href: buildAuditLogsHref(quickViewBase),
      active: !actorType && !actorId && !action && !subjectType && !subjectId,
    },
    {
      label: "Service actors",
      hint: tr("{count} service-originated events on this page", { count: serviceActorCount }),
      href: buildAuditLogsHref({
        ...quickViewBase,
        actorType: "service",
      }),
      active: actorType === "service" && !actorId && !action && !subjectType && !subjectId,
    },
    {
      label: "Workspace subjects",
      hint: tr("{count} workspace-level changes on this page", { count: workspaceSubjectCount }),
      href: buildAuditLogsHref({
        ...quickViewBase,
        subjectType: "workspace",
      }),
      active: subjectType === "workspace" && !subjectId && !actorType && !actorId && !action,
    },
    {
      label: "Environment subjects",
      hint: tr("{count} environment-specific changes on this page", { count: environmentSubjectCount }),
      href: buildAuditLogsHref({
        ...quickViewBase,
        subjectType: "environment",
      }),
      active: subjectType === "environment" && !subjectId && !actorType && !actorId && !action,
    },
  ];
  const localizedQuickViews = quickViews.map((view) => ({
    ...view,
    label: tr(view.label),
  }));
  const activeFilterChips = buildAuditActiveFilterChips([
    selectedWorkspace
      ? {
          label: "Workspace",
          value: `${selectedWorkspace.organizationName} / ${selectedWorkspace.name}`,
          href: buildAuditLogsHref({
            ...pageFilters,
            workspaceId: null,
            projectId: null,
            environmentId: null,
            offset: 0,
          }),
        }
      : null,
    projectId
      ? {
          label: "Project",
          value: projectById.get(projectId)?.name ?? projectId,
          href: buildAuditLogsHref({
            ...pageFilters,
            projectId: null,
            environmentId: null,
            offset: 0,
          }),
        }
      : null,
    environmentId
      ? {
          label: "Environment",
          value: environmentById.get(environmentId)
            ? `${environmentById.get(environmentId)?.name} (${environmentById.get(environmentId)?.runtime})`
            : environmentId,
          href: buildAuditLogsHref({
            ...pageFilters,
            environmentId: null,
            offset: 0,
          }),
        }
      : null,
    actorType
      ? {
          label: "Actor type",
          value: actorType,
          href: buildAuditLogsHref({
            ...pageFilters,
            actorType: null,
            actorId: null,
            offset: 0,
          }),
        }
      : null,
    actorId
      ? {
          label: "Actor ID",
          value: actorId,
          href: buildAuditLogsHref({
            ...pageFilters,
            actorId: null,
            offset: 0,
          }),
        }
      : null,
    action
      ? {
          label: "Action",
          value: action,
          href: buildAuditLogsHref({
            ...pageFilters,
            action: null,
            offset: 0,
          }),
        }
      : null,
    subjectType
      ? {
          label: "Subject type",
          value: subjectType,
          href: buildAuditLogsHref({
            ...pageFilters,
            subjectType: null,
            subjectId: null,
            offset: 0,
          }),
        }
      : null,
    subjectId
      ? {
          label: "Subject ID",
          value: subjectId,
          href: buildAuditLogsHref({
            ...pageFilters,
            subjectId: null,
            offset: 0,
          }),
        }
      : null,
    from
      ? {
          label: "From",
          value: from,
          href: buildAuditLogsHref({
            ...pageFilters,
            from: null,
            offset: 0,
          }),
        }
      : null,
    to
      ? {
          label: "To",
          value: to,
          href: buildAuditLogsHref({
            ...pageFilters,
            to: null,
            offset: 0,
          }),
        }
      : null,
  ]);
  const localizedActiveFilterChips = activeFilterChips.map((chip) => ({
    ...chip,
    label: tr(chip.label),
    value:
      chip.label === "Actor type" || chip.label === "Action" || chip.label === "Subject type"
        ? tr(chip.value)
        : chip.value,
  }));
  const suggestedSavedViewName = [
    action ? `Audit ${action}` : subjectType ? `Audit ${subjectType}` : actorType ? `${actorType} actor audit` : "Audit governance lane",
    projectId ? projectById.get(projectId)?.name ?? projectId : null,
    environmentId ? environmentById.get(environmentId)?.name ?? environmentId : null,
  ]
    .filter((value): value is string => Boolean(value))
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
        buildAuditLogsHref({
          workspaceId,
          projectId: typeof filters.projectId === "string" ? filters.projectId : null,
          environmentId: typeof filters.environmentId === "string" ? filters.environmentId : null,
          actorType: typeof filters.actorType === "string" ? filters.actorType : null,
          actorId: typeof filters.actorId === "string" ? filters.actorId : null,
          action: typeof filters.action === "string" ? filters.action : null,
          subjectType: typeof filters.subjectType === "string" ? filters.subjectType : null,
          subjectId: typeof filters.subjectId === "string" ? filters.subjectId : null,
          from: typeof filters.from === "string" ? filters.from : null,
          to: typeof filters.to === "string" ? filters.to : null,
          savedViewId: savedView.id,
          returnTo,
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
  const activeSavedViewConfig =
    workspaceId && activeSavedView
      ? {
          savedViewId: activeSavedView.id,
          workspaceId,
          surface: "audit-logs" as const,
          redirectPath,
          filtersJson: JSON.stringify(persistedViewFilters),
          name: activeSavedView.name,
          hint: activeSavedView.lastOpenedAt
            ? tr("Opened {openedAt} · updated {updatedAt}", { openedAt: formatSavedViewTimestamp(activeSavedView.lastOpenedAt), updatedAt: formatSavedViewTimestamp(activeSavedView.updatedAt) })
            : tr("Created {createdAt} · update this shared lane after refining the current filters.", { createdAt: formatSavedViewTimestamp(activeSavedView.createdAt) }),
        }
      : null;
  const savedViewSections: SavedViewBarSection[] = [
    {
      key: "default",
      title: tr("Default views"),
      description: tr("Start from the built-in governance queues for service activity, workspace changes, and environment drift."),
      items: localizedQuickViews,
      emptyMessage: tr("Default audit views are unavailable right now."),
    },
    {
      key: "recent",
      title: tr("Recent views"),
      description: tr("Reopen the most recently opened audit paths without rebuilding the same governance query again."),
      items: recentSavedViews,
      emptyMessage: tr("Save an audit lane once and it will appear here for repeat review."),
    },
    {
      key: "team-shared",
      title: tr("Team shared views"),
      description: tr("Workspace-saved audit views stay available for handoffs, recurring reviews, and compliance follow-up, ordered by the latest shared edits."),
      items: teamSharedViews,
      emptyMessage: tr("No team-shared audit views exist yet."),
      allowDelete: true,
    },
  ];
  const auditFiltersPanel = (
    <>
      <CompactToolbar
        query={filterDraft.action}
        onQueryChange={(val) => handleFilterDraftChange("action", val)}
        filterCount={localizedActiveFilterChips.length}
        onResetFilters={handleFilterReset}
        placeholder={tr("Search action")}
        actions={
          <Button asChild size="sm" variant="outline" className="rounded-full">
            <Link
              href={buildExportHref({
                workspaceId,
                projectId,
                environmentId,
                actorType,
                actorId,
                action,
                subjectType,
                subjectId,
                from,
                to,
                returnTo: redirectPath,
              })}
            >
              {tr("Export Log")}
            </Link>
          </Button>
        }
      >
        <form className="space-y-4" onSubmit={handleFilterSubmit}>
          <FilterField label={tr("Project")}>
            {selectedWorkspaceId ? (
              <select
                className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
                name="projectId"
                onChange={(event) => handleFilterDraftChange("projectId", event.currentTarget.value)}
                value={filterDraft.projectId}
              >
                <option value="">{tr("All projects")}</option>
                {sortedProjects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                    {project.status === "archived" ? " (archived)" : ""}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground"
                name="projectId"
                onChange={(event) => handleFilterDraftChange("projectId", event.currentTarget.value)}
                placeholder={tr("Project")}
                value={filterDraft.projectId}
              />
            )}
          </FilterField>
          <FilterField label={tr("Environment")}>
            {selectedWorkspaceId ? (
              <select
                className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
                name="environmentId"
                onChange={(event) => handleFilterDraftChange("environmentId", event.currentTarget.value)}
                value={filterDraft.environmentId}
              >
                <option value="">{tr("All environments")}</option>
                {draftEnvironmentOptions.map((environment) => (
                  <option key={environment.id} value={environment.id}>
                    {environment.name} ({environment.runtime})
                  </option>
                ))}
              </select>
            ) : (
              <input
                className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground"
                name="environmentId"
                onChange={(event) => handleFilterDraftChange("environmentId", event.currentTarget.value)}
                placeholder={tr("Environment")}
                value={filterDraft.environmentId}
              />
            )}
          </FilterField>
          <Button size="sm" type="submit" className="w-full mt-2 rounded-full">
            {tr("Apply filters")}
          </Button>
          <button 
            type="button" 
            onClick={handleFilterReset}
            className="block w-full text-center text-[11px] text-muted-foreground hover:text-foreground mt-2"
          >
            {tr("Reset")}
          </button>
        </form>
      </CompactToolbar>
    </>
  );
  const savedViewsPanel = (
    <>
      <SavedViewBar
        variant="strip"
        createAction={savedViewsIssue ? undefined : createSavedViewAction}
        deleteAction={savedViewsIssue ? undefined : deleteSavedViewAction}
        updateAction={savedViewsIssue ? undefined : updateSavedViewAction}
        title={tr("Saved views")}
        description={tr("Saved filters for this view.")}
        sections={savedViewSections}
        notice={savedViewNoticeState}
        saveConfig={
          workspaceId && !savedViewsIssue
            ? {
                workspaceId,
                surface: "audit-logs",
                redirectPath,
                filtersJson: JSON.stringify(persistedViewFilters),
                suggestedName: suggestedSavedViewName,
              }
            : null
        }
        activeConfig={savedViewsIssue ? null : activeSavedViewConfig}
      />
      {savedViewsIssue ? (
        <ControlApiStatusCard
          issue={savedViewsIssue}
          heading={tr("Saved views are temporarily unavailable")}
          mode="inline"
        />
      ) : null}
    </>
  );
  return (
    <AppShell
      headerMode="compact"
      sidebarVariant="minimal"
      showOperatorContextCards={false}
      showSupportPanels={false}
      title={tr("Audit Logs")}
      subtitle=""
      workspaceId={selectedWorkspaceId}
      workspaceLabel={selectedWorkspace ? `${selectedWorkspace.organizationName} / ${selectedWorkspace.name}` : null}
    >
      <section className="space-y-6">
        {auditFiltersPanel}

        <ResourceTableSection
          busy={isViewBusy}
          actions={
            <Button asChild size="sm" variant="outline">
              <Link
                href={buildExportHref({
                  workspaceId,
                  projectId,
                  environmentId,
                  actorType,
                  actorId,
                  action,
                  subjectType,
                  subjectId,
                  from,
                  to,
                  returnTo: redirectPath,
                })}
              >
                {tr("Export")}
              </Link>
            </Button>
          }
          contentClassName="divide-y divide-border/60"
          meta={tr("Showing {start}-{end} of {total} audit events", {
            start: pageStart,
            end: pageEnd,
            total: auditLogResult.total,
          })}
          title={tr("Audit events")}
        >
          <div className="space-y-3 px-4 py-3">
            {loadError ? (
              <p className="text-sm text-muted-foreground">{tr(loadError)}</p>
            ) : null}
            {/* Summary strip removed, moved to Dashboard */}
          </div>

          {auditLogResult.items.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>{tr("Time")}</th>
                    <th>{tr("Action")}</th>
                    <th>{tr("Actor")}</th>
                    <th>{tr("Subject")}</th>
                    <th>{tr("Scope")}</th>
                    <th>{tr("Workspace")}</th>
                    <th>{tr("Payload")}</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLogResult.items.map((entry) => {
                    const entryProject = entry.projectId
                      ? projectById.get(entry.projectId) ?? null
                      : null;
                    const entryEnvironment = entry.environmentId
                      ? environmentById.get(entry.environmentId) ?? null
                      : null;

                    return (
                      <tr key={entry.id}>
                        <td>{formatDateTime(entry.createdAt)}</td>
                        <td>{tr(entry.action)}</td>
                        <td>
                          <div className="cell-stack">
                            <strong>{formatAuditActorLabel(entry.actorId, locale)}</strong>
                            <span className="meta">{tr(entry.actorType)}</span>
                          </div>
                        </td>
                        <td>
                          <div className="cell-stack">
                            <strong>{tr(entry.subjectType)}</strong>
                            <span className="meta mono mono--wrap">{entry.subjectId}</span>
                          </div>
                        </td>
                        <td>
                          <div className="cell-stack">
                            <strong>
                              {entryProject?.name ?? entry.projectId ?? tr("workspace-scope")}
                            </strong>
                            <span className="meta">
                              {entryEnvironment
                                ? `${entryEnvironment.name} (${entryEnvironment.runtime})`
                                : entry.environmentId ?? tr("No environment")}
                            </span>
                          </div>
                        </td>
                        <td>
                          {entry.workspaceId ? (
                            <span
                              className="block max-w-[16rem] truncate text-sm text-foreground"
                              title={workspaceLabelById.get(entry.workspaceId) ?? entry.workspaceId}
                            >
                              {workspaceLabelById.get(entry.workspaceId) ?? entry.workspaceId}
                            </span>
                          ) : (
                            tr("global")
                          )}
                        </td>
                        <td>
                          <div className="cell-stack">
                            <span>{summarizeAuditPayload(entry.payload, tr)}</span>
                            {!formatAuditPayloadDetails(entry.payload) ? (
                              <span className="meta">{tr("No payload")}</span>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="px-4 py-6">
              <EmptyState
                compact
                description={tr("No audit events matched the current filters yet.")}
                title={tr("No matching event")}
              />
            </div>
          )}

          {auditLogResult.total > 0 ? (
            <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">
                {tr("Page size")}:{" "}
                <span className="font-semibold text-foreground">
                  {defaultPageSize}
                </span>
              </p>
              <div className="pagination__controls">
                <Link
                  aria-disabled={!hasPreviousPage}
                  className={`button button--ghost${hasPreviousPage ? "" : " button--disabled"}`}
                  href={buildAuditLogsHref({
                    ...pageFilters,
                    offset: Math.max(offset - defaultPageSize, 0),
                  })}
                >
                  {tr("Previous page")}
                </Link>
                <Link
                  aria-disabled={!hasNextPage}
                  className={`button${hasNextPage ? "" : " button--disabled"}`}
                  href={buildAuditLogsHref({
                    ...pageFilters,
                    offset: offset + defaultPageSize,
                  })}
                >
                  {tr("Next page")}
                </Link>
              </div>
            </div>
          ) : null}
        </ResourceTableSection>

        {savedViewsPanel}

      </section>
    </AppShell>
  );
}
