import { Link } from "@/i18n/navigation";

import { AppShell } from "../components/app-shell";
import { ControlApiStatusCard } from "../components/control-api-status-card";
import { DisclosureSummary } from "../components/disclosure-summary";
import { LazyDisclosureSection } from "../components/lazy-disclosure-section";
import { NavigationContextNotice } from "../components/navigation-context-notice";
import { loadWorkspaceSelection } from "../lib/control-api";
import { translateInlineText, type AppLocale } from "../lib/i18n";
import enDeliveryMessages from "../messages/en/delivery.json";
import zhDeliveryMessages from "../messages/zh/delivery.json";
import { getCurrentLocale } from "../lib/i18n-server";
import {
  deliveryDecisionPrompts,
  deliveryDecisionRows,
  deliveryExecutionTracks,
  deliveryModes,
  deliveryReadinessItems,
} from "../lib/enterprise-narrative";
import { buildContextualHref, getSafeReturnTo } from "../lib/navigation";

export const dynamic = "force-dynamic";

type DeliveryPageProps = {
  searchParams?: Promise<{
    workspaceId?: string;
    returnTo?: string;
  }>;
};


function resolveDeliveryMessage(messages: Record<string, unknown>, key: string): string | null {
  const exact = messages[key];
  if (typeof exact === "string") return exact;
  const nested = key.split(".").reduce<unknown>((current, part) =>
    current && typeof current === "object" && part in (current as Record<string, unknown>)
      ? (current as Record<string, unknown>)[part]
      : null, messages);
  return typeof nested === "string" ? nested : null;
}

function createDeliveryTranslator(locale: AppLocale) {
  const messages = (locale === "zh" ? zhDeliveryMessages : enDeliveryMessages) as Record<string, unknown>;
  return (key: string, values?: Record<string, string | number>) => {
    const template = resolveDeliveryMessage(messages, key);
    if (!template) return translateInlineText(locale, key);
    return template.replace(/\{(\w+)\}/g, (_, token) => String(values?.[token] ?? `{${token}}`));
  };
}

function getModeTagClassName(slug: "cloud" | "hybrid" | "self-host-preview") {
  switch (slug) {
    case "cloud":
      return "tag tag--resolved";
    case "self-host-preview":
      return "tag tag--warning";
    default:
      return "tag";
  }
}

function getModeCardClassName(slug: "cloud" | "hybrid" | "self-host-preview") {
  switch (slug) {
    case "self-host-preview":
      return "action-card action-card--warning";
    default:
      return "action-card";
  }
}

function getReadinessCardClassName(status: "ready" | "watch" | "gap") {
  switch (status) {
    case "ready":
      return "resource-card resource-card--success";
    case "gap":
      return "resource-card resource-card--critical";
    default:
      return "resource-card resource-card--warning";
  }
}

function getReadinessTagClassName(status: "ready" | "watch" | "gap") {
  switch (status) {
    case "ready":
      return "tag tag--resolved";
    case "gap":
      return "tag tag--critical";
    default:
      return "tag tag--warning";
  }
}

function getSignalPillClassName(status: "ready" | "watch" | "gap") {
  switch (status) {
    case "ready":
      return "surface-link surface-link--resolved";
    case "gap":
      return "surface-link surface-link--critical";
    default:
      return "surface-link surface-link--warning";
  }
}

function getTrackSurfaceClassName(tone: "resolved" | "warning" | "critical") {
  switch (tone) {
    case "resolved":
      return "surface-link surface-link--resolved";
    case "critical":
      return "surface-link surface-link--critical";
    default:
      return "surface-link surface-link--warning";
  }
}

function getTrackTagClassName(tone: "resolved" | "warning" | "critical") {
  switch (tone) {
    case "resolved":
      return "tag tag--resolved";
    case "critical":
      return "tag tag--critical";
    default:
      return "tag tag--warning";
  }
}

export default async function DeliveryPage({ searchParams }: DeliveryPageProps) {
  const locale = await getCurrentLocale();
  const tr = createDeliveryTranslator(locale);
  const resolvedSearchParams = (await searchParams) ?? {};
  const returnTo = getSafeReturnTo(resolvedSearchParams.returnTo);
  const workspaceSelection = await loadWorkspaceSelection(resolvedSearchParams.workspaceId);
  const { workspaceOptions, selectedWorkspaceId, selectionStatus } = workspaceSelection;
  const selectedWorkspace =
    selectedWorkspaceId ? workspaceOptions.find((workspace) => workspace.id === selectedWorkspaceId) ?? null : null;
  const deliveryIssue = workspaceSelection.issue;
  const hasInvalidWorkspaceSelection =
    selectionStatus === "invalid" || deliveryIssue?.resource === "workspace-selection";

  const deliveryHref =
    selectedWorkspaceId
      ? buildContextualHref(`/delivery?workspaceId=${selectedWorkspaceId}`, returnTo)
      : buildContextualHref("/delivery", returnTo);
  const dashboardHref =
    selectedWorkspaceId
      ? buildContextualHref(`/?workspaceId=${selectedWorkspaceId}`, deliveryHref)
      : buildContextualHref("/", deliveryHref);
  const providersHref =
    selectedWorkspaceId
      ? buildContextualHref(`/providers?workspaceId=${selectedWorkspaceId}`, deliveryHref)
      : buildContextualHref("/providers", deliveryHref);
  const exportsHref =
    selectedWorkspaceId
      ? buildContextualHref(`/exports?workspaceId=${selectedWorkspaceId}&kind=audit-logs`, deliveryHref)
      : buildContextualHref("/exports", deliveryHref);
  const organizationsHref = buildContextualHref("/organizations", deliveryHref);
  const workspacesHref = buildContextualHref("/workspaces", deliveryHref);

  const localizedDeliveryModes = deliveryModes.map((mode) => ({
    ...mode,
    name: tr(mode.name),
    commercialStatus: tr(mode.commercialStatus),
    summary: tr(mode.summary),
    userValue: tr(mode.userValue),
    operatorMotion: tr(mode.operatorMotion),
    controlPlane: tr(mode.controlPlane),
    gateway: tr(mode.gateway),
    credentials: tr(mode.credentials),
    upgrades: tr(mode.upgrades),
    support: tr(mode.support),
    bestFit: tr(mode.bestFit),
  }));

  const localizedDeliveryDecisionRows = deliveryDecisionRows.map((row) => ({
    ...row,
    question: tr(row.question),
    cloud: tr(row.cloud),
    hybrid: tr(row.hybrid),
    selfHostPreview: tr(row.selfHostPreview),
  }));

  const localizedDeliveryReadinessItems = deliveryReadinessItems.map((item) => ({
    ...item,
    title: tr(item.title),
    owner: tr(item.owner),
    summary: tr(item.summary),
    nextStep: tr(item.nextStep),
  }));

  const localizedDeliveryExecutionTracks = deliveryExecutionTracks.map((track) => ({
    ...track,
    audience: tr(track.audience),
    title: tr(track.title),
    summary: tr(track.summary),
    ctaLabel: tr(track.ctaLabel),
  }));

  const localizedDeliveryDecisionPrompts = deliveryDecisionPrompts.map((prompt) => ({
    ...prompt,
    question: tr(prompt.question),
    reason: tr(prompt.reason),
  }));

  const readyCount = localizedDeliveryReadinessItems.filter((item) => item.status === "ready").length;
  const gapCount = localizedDeliveryReadinessItems.filter((item) => item.status === "gap").length;
  const previewReadySignals: Array<{
    label: string;
    value: string;
    detail: string;
    status: "ready" | "watch" | "gap";
  }> = [
    {
      label: tr("Default SKU"),
      value: tr("Cloud"),
      detail: tr("Cloud default"),
      status: "ready" as const,
    },
    {
      label: tr("Hybrid"),
      value: tr("Defined"),
      detail: tr("Hybrid when the gateway must be customer-run"),
      status: "watch" as const,
    },
    {
      label: tr("Preview support"),
      value: `${readyCount}/${localizedDeliveryReadinessItems.length} ${tr("ready")}`,
      detail: tr("Packaging, upgrade, and health are ready. Identity and KMS still need work."),
      status: gapCount ? ("watch" as const) : ("ready" as const),
    },
    {
      label: tr("GA blockers"),
      value: `${gapCount} ${tr("remaining")}`,
      detail: tr("Do not present Preview as GA while identity, KMS, and SLA gaps remain."),
      status: gapCount ? ("gap" as const) : ("ready" as const),
    },
  ];

  const modeNextActions = {
    cloud: {
      href: dashboardHref,
      ctaLabel: tr("Open home"),
      toneLabel: "default",
    },
    hybrid: {
      href: providersHref,
      ctaLabel: tr("Open providers"),
      toneLabel: "hybrid",
    },
    "self-host-preview": {
      href: exportsHref,
      ctaLabel: tr("Open exports"),
      toneLabel: "preview",
    },
  } as const;

  const trackHrefByDestination = {
    dashboard: dashboardHref,
    providers: providersHref,
    exports: exportsHref,
    organizations: organizationsHref,
    workspaces: workspacesHref,
  } as const;

  const deliveryTimeline = [
    {
      title: tr("Set tenant structure"),
      summary: tr("Confirm organization and workspace scope."),
      href: selectedWorkspace ? workspacesHref : organizationsHref,
      ctaLabel: selectedWorkspace ? tr("Open workspaces") : tr("Open organizations"),
      current: !selectedWorkspace,
    },
    {
      title: tr("Validate route ownership"),
      summary: tr("Check managed, customer, and private routes."),
      href: providersHref,
      ctaLabel: tr("Open providers"),
      current: Boolean(selectedWorkspace),
    },
    {
      title: tr("Export evidence"),
      summary: tr("Export the deployment evidence set."),
      href: exportsHref,
      ctaLabel: tr("Open exports"),
      current: false,
    },
  ];

  return (
    <AppShell
      headerMode="compact"
      sidebarVariant="minimal"
      showOperatorContextCards={false}
      showSupportPanels={false}
      title={tr("Delivery")}
      subtitle=""
      workspaceId={selectedWorkspaceId}
      workspaceLabel={selectedWorkspace ? `${selectedWorkspace.organizationName} / ${selectedWorkspace.name}` : null}
    >
      <section className="space-y-6">
        {deliveryIssue ? (
          <ControlApiStatusCard
            issue={deliveryIssue}
            heading={
              hasInvalidWorkspaceSelection
                ? tr("Delivery workspace is invalid")
                : selectedWorkspaceId
                  ? tr("Delivery data unavailable")
                  : tr("Delivery setup required")
            }
          />
        ) : null}

        {returnTo ? (
          <NavigationContextNotice
            returnTo={returnTo}
            headingPrefix={tr("Opened from")}
          />
        ) : null}

        <section className="rounded-xl border border-border/60 bg-[color:color-mix(in_srgb,var(--surface-1)_96%,var(--surface-canvas)_4%)] px-4 py-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                {tr("Default path")}
              </p>
              <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-foreground">
                {tr("Delivery modes")}
              </h2>
              <p className="text-sm text-muted-foreground">
                {tr("Cloud is the default. Hybrid and Self-host Preview stay secondary until buyers require them.")}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link className="button" href={providersHref}>
                {tr("Open providers")}
              </Link>
              <Link className="button button--ghost" href={exportsHref}>
                {tr("Open exports")}
              </Link>
            </div>
          </div>

          <div className="mt-4 grid gap-3">
            {localizedDeliveryModes.map((mode) => {
              const nextAction = modeNextActions[mode.slug];
              return (
                <div
                  key={mode.slug}
                  className="flex flex-col gap-3 rounded-lg border border-border/60 bg-background/60 px-4 py-4 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="text-sm text-foreground">{mode.name}</strong>
                      <span className={getModeTagClassName(mode.slug)}>{mode.commercialStatus}</span>
                    </div>
                    <p className="text-sm text-muted-foreground">{mode.summary}</p>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
                      <span>{tr("Control plane")}: {mode.controlPlane}</span>
                      <span>{tr("Gateway")}: {mode.gateway}</span>
                      <span>{tr("Credentials")}: {mode.credentials}</span>
                    </div>
                  </div>
                  <div className="flex items-start">
                    <Link className="button" href={nextAction.href}>
                      {nextAction.ctaLabel}
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="rounded-xl border border-border/60 bg-[color:color-mix(in_srgb,var(--surface-1)_96%,var(--surface-canvas)_4%)] px-4 py-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                {tr("Preview readiness")}
              </p>
              <p className="text-sm text-muted-foreground">
                {gapCount ? `${gapCount} ${tr("gaps remain before Preview can move beyond evaluation.")}` : tr("Preview blockers are cleared.")}
              </p>
            </div>
            <span className={gapCount ? "tag tag--warning" : "tag tag--resolved"}>
              {gapCount ? tr("{count} gaps", { count: gapCount }) : tr("ready")}
            </span>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {localizedDeliveryReadinessItems.map((item) => (
              <div
                key={item.title}
                className="rounded-lg border border-border/60 bg-background/60 px-4 py-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <strong className="text-sm text-foreground">{item.title}</strong>
                  <span className={getReadinessTagClassName(item.status)}>{tr(item.status)}</span>
                </div>
                <p className="mt-2 text-[12px] text-muted-foreground">{item.nextStep}</p>
              </div>
            ))}
          </div>
        </section>

        <LazyDisclosureSection
          variant="section"
          className="rounded-xl border border-border/60 bg-[color:color-mix(in_srgb,var(--surface-1)_96%,var(--surface-canvas)_4%)]"
          summary={
            <DisclosureSummary
              description={tr("Collapse by default")}
              eyebrow={tr("Secondary")}
              meta={tr("Collapse by default")}
              title={tr("Decision guide")}
              variant="section"
            />
          }
          bodyClassName="space-y-4 border-t border-border/60 px-4 py-4"
          deferBodyVisibility
        >
            <div className="grid gap-3">
              {localizedDeliveryDecisionPrompts.map((prompt) => {
                const mode = localizedDeliveryModes.find((entry) => entry.slug === prompt.recommendedMode);
                if (!mode) {
                  return null;
                }
                return (
                  <div key={prompt.question} className="rounded-lg border border-border/60 bg-background/60 px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="text-sm text-foreground">{prompt.question}</strong>
                      <span className={getModeTagClassName(mode.slug)}>{mode.name}</span>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">{prompt.reason}</p>
                  </div>
                );
              })}
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              {deliveryTimeline.map((step) => (
                <Link key={step.title} className="rounded-lg border border-border/60 bg-background/60 px-4 py-3 transition-colors hover:border-border hover:bg-background" href={step.href}>
                  <div className="space-y-1">
                    <strong className="text-sm text-foreground">{step.title}</strong>
                    <p className="text-sm text-muted-foreground">{step.summary}</p>
                    <span className={step.current ? "tag tag--warning" : "tag"}>{step.ctaLabel}</span>
                  </div>
                </Link>
              ))}
            </div>
        </LazyDisclosureSection>
      </section>
    </AppShell>

  );
}
