import { Link } from "@/i18n/navigation";
import { cookies } from "next/headers";

import { Button } from "@/components/ui/button";

import { AppShell } from "../components/app-shell";
import { GettingStartedChecklist } from "../components/getting-started-checklist";
import { ResourceInlineNotice } from "../components/resource-inline-notice";
import { ResourceSummaryStrip } from "../components/resource-summary-strip";
import {
  getSetupNextStep,
  getSetupProgress,
  loadWorkspaceSetupSummary,
} from "../components/setup-summary";
import {
  loadOrganizationsState,
  loadWorkspaceSelection,
} from "../lib/control-api";
import { translateInlineText } from "../lib/i18n";
import { getCurrentLocale, getT } from "../lib/i18n-server";
import { buildContextualHref, getSafeReturnTo } from "../lib/navigation";
import {
  normalizeWorkspacePreferenceValue,
  workspacePreferenceCookieName,
} from "../lib/workspace-preference";

export const dynamic = "force-dynamic";

type SetupPageProps = {
  searchParams?: Promise<{
    workspaceId?: string;
    returnTo?: string;
  }>;
};

function buildDashboardHref(args?: {
  workspaceId?: string | null;
  returnTo?: string | null;
}) {
  const params = new URLSearchParams();

  if (args?.workspaceId) {
    params.set("workspaceId", args.workspaceId);
  }

  const href = params.toString() ? `/?${params.toString()}` : "/";
  return buildContextualHref(href, args?.returnTo);
}

function buildSetupHref(args?: {
  workspaceId?: string | null;
  returnTo?: string | null;
}) {
  const params = new URLSearchParams();

  if (args?.workspaceId) {
    params.set("workspaceId", args.workspaceId);
  }

  const href = params.toString() ? `/setup?${params.toString()}` : "/setup";
  return buildContextualHref(href, args?.returnTo);
}

export default async function SetupPage({ searchParams }: SetupPageProps) {
  const locale = await getCurrentLocale();
  const t = await getT("home");
  const fallbackTr = (text: string) => translateInlineText(locale, text);
  const resolvedSearchParams = (await searchParams) ?? {};
  const cookieStore = await cookies();
  const returnTo = getSafeReturnTo(resolvedSearchParams.returnTo);
  const explicitWorkspaceId = normalizeWorkspacePreferenceValue(
    resolvedSearchParams.workspaceId,
  );
  const rememberedWorkspaceId = normalizeWorkspacePreferenceValue(
    cookieStore.get(workspacePreferenceCookieName)?.value,
  );

  const workspaceSelection = await loadWorkspaceSelection(
    explicitWorkspaceId ?? rememberedWorkspaceId,
  );

  let organizations: Awaited<ReturnType<typeof loadOrganizationsState>>["items"] =
    [];

  if (!workspaceSelection.selectedWorkspaceId) {
    const organizationsState = await loadOrganizationsState();
    organizations = organizationsState.items;
  }

  const selectedWorkspaceId = workspaceSelection.selectedWorkspaceId ?? null;
  const selectedWorkspace = selectedWorkspaceId
    ? (workspaceSelection.workspaceOptions.find(
        (workspace) => workspace.id === selectedWorkspaceId,
      ) ?? null)
    : null;
  const workspaceSelectionSource =
    explicitWorkspaceId && selectedWorkspaceId === explicitWorkspaceId
      ? "explicit"
      : !explicitWorkspaceId &&
          rememberedWorkspaceId &&
          selectedWorkspaceId === rememberedWorkspaceId
        ? "remembered"
        : selectedWorkspaceId
          ? "default"
          : "none";
  const hasOrganizations = selectedWorkspaceId ? true : organizations.length > 0;
  const hasAnyWorkspace = workspaceSelection.workspaceOptions.length > 0;
  const workspaceSetupState = !hasOrganizations
    ? "no-organization"
    : !hasAnyWorkspace
      ? "no-workspace"
      : selectedWorkspaceId
        ? "active"
        : "pick-workspace";
  const dashboardHref = buildDashboardHref({
    workspaceId: selectedWorkspaceId,
    returnTo,
  });
  const setupHref = buildSetupHref({
    workspaceId: selectedWorkspaceId,
    returnTo,
  });
  const workspacesHref = buildContextualHref("/workspaces", setupHref);
  const organizationsHref = buildContextualHref("/organizations", setupHref);
  const setupPrimaryHref =
    workspaceSetupState === "no-organization"
      ? organizationsHref
      : workspacesHref;
  const setupPrimaryLabel =
    workspaceSetupState === "no-organization"
      ? t("setup.button.createOrganization")
      : workspaceSetupState === "no-workspace"
        ? t("setup.button.createWorkspace")
        : t("setup.button.useWorkspace");
  const setupCardTitle =
    workspaceSetupState === "no-organization"
      ? t("setup.card.title.organizationRequired")
      : workspaceSetupState === "no-workspace"
        ? t("setup.card.title.workspaceRequired")
        : t("setup.card.title.chooseWorkspace");
  const setupCardDescription =
    workspaceSetupState === "no-organization"
      ? t("setup.card.description.organizationRequired")
      : workspaceSetupState === "no-workspace"
        ? t("setup.card.description.workspaceRequired")
        : t("setup.card.description.chooseWorkspace");
  const workspaceLabel = selectedWorkspace
    ? `${selectedWorkspace.organizationName} / ${selectedWorkspace.name}`
    : null;
  const shellWorkspaceOptions = workspaceSelection.workspaceOptions.map(
    (workspace) => ({
      id: workspace.id,
      label: `${workspace.organizationName} / ${workspace.name}`,
    }),
  );

  let setupSummary: Awaited<ReturnType<typeof loadWorkspaceSetupSummary>> | null = null;

  if (selectedWorkspaceId) {
    try {
      setupSummary = await loadWorkspaceSetupSummary({
        workspaceId: selectedWorkspaceId,
        locale,
        returnTo: setupHref,
      });
    } catch {
      setupSummary = null;
    }
  }
  const setupProgress = setupSummary ? getSetupProgress(setupSummary) : null;
  const nextSetupStep = setupSummary ? getSetupNextStep(setupSummary) : null;
  const setupChecklistItems = setupSummary
    ? setupSummary.steps.map((step) => ({
        title: fallbackTr(step.title),
        description: fallbackTr(step.description),
        href: step.href,
        ctaLabel: fallbackTr(step.ctaLabel),
        status: step.status,
      }))
    : [];

  const stepLinks = setupSummary
    ? Object.fromEntries(
        setupSummary.steps.map((step) => [step.id, step.href]),
      )
    : {};

  const summaryStripItems = setupSummary
    ? [
        {
          label: fallbackTr("Projects"),
          value: setupSummary.counts.projectCount,
          meta: fallbackTr("active"),
          href: stepLinks.project_environment,
        },
        {
          label: fallbackTr("Environments"),
          value: setupSummary.counts.environmentCount,
          meta: fallbackTr("active"),
          href: stepLinks.project_environment,
        },
        {
          label: fallbackTr("Providers ready"),
          value: `${setupSummary.counts.readyProviderCount}/${setupSummary.counts.activeProviderCount}`,
          meta: fallbackTr("tested"),
          href: stepLinks.provider_connection,
          tone:
            setupSummary.counts.readyProviderCount &&
            setupSummary.counts.readyProviderCount ===
              setupSummary.counts.activeProviderCount
              ? ("default" as const)
              : ("warning" as const),
        },
        {
          label: fallbackTr("Active keys"),
          value: setupSummary.counts.activeVirtualKeyCount,
          meta: fallbackTr("virtual keys"),
          href: stepLinks.virtual_key,
        },
        {
          label: fallbackTr("Members"),
          value: setupSummary.counts.memberCount,
          meta: fallbackTr("active"),
          href: stepLinks.members,
        },
        {
          label: fallbackTr("Scope gaps"),
          value: setupSummary.counts.scopedMembersWithoutProjects,
          meta: fallbackTr("members"),
          href: stepLinks.project_assignment,
          tone: setupSummary.counts.scopedMembersWithoutProjects ? ("warning" as const) : ("default" as const),
        },
      ]
    : [];

  return (
    <AppShell
      title={fallbackTr("Setup")}
      subtitle={workspaceLabel ?? ""}
      workspaceId={selectedWorkspaceId}
      workspaceLabel={workspaceLabel}
      workspaceOptions={shellWorkspaceOptions}
      workspaceSelectionSource={workspaceSelectionSource}
      headerMode="compact"
      sidebarVariant="minimal"
      showSupportPanels={false}
    >
      <section className="space-y-6">
        {!selectedWorkspaceId ? (
          <section className="max-w-[56rem] rounded-xl border border-border/50 bg-[color:color-mix(in_srgb,var(--surface-1)_95%,var(--surface-canvas)_5%)] p-5 shadow-none">
            <div className="space-y-5">
              <div className="space-y-2">
                <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-foreground">
                  {setupCardTitle}
                </h2>
                <p className="max-w-[54ch] text-[13px] leading-5 text-muted-foreground sm:text-sm">
                  {setupCardDescription}
                </p>
              </div>

              {hasAnyWorkspace ? (
                <div className="space-y-4">
                  <p className="max-w-[54ch] text-[13px] leading-5 text-muted-foreground sm:text-sm">
                    {fallbackTr("Use the workspace switcher in the header to choose the active workspace for setup.")}
                  </p>
                  <Button asChild size="sm" variant="outline">
                    <Link href={setupPrimaryHref}>{setupPrimaryLabel}</Link>
                  </Button>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button asChild size="sm">
                    <Link href={setupPrimaryHref}>{setupPrimaryLabel}</Link>
                  </Button>
                </div>
              )}
            </div>
          </section>
        ) : (
          <div className="space-y-6">
            <section className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  {fallbackTr("Workspace setup")}
                </p>
                <h1 className="text-[20px] font-semibold tracking-[-0.02em] text-foreground">
                  {fallbackTr("Finish the core access flow")}
                </h1>
                {setupProgress ? (
                  <p className="text-[13px] text-muted-foreground sm:text-sm">
                    {fallbackTr(
                      `${setupProgress.doneCount} / ${setupProgress.totalCount} setup steps complete`,
                    )}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button asChild size="sm">
                  <Link href={setupSummary?.mode === "ready" ? dashboardHref : setupHref}>
                    {setupSummary?.mode === "ready"
                      ? fallbackTr("Open operations")
                      : fallbackTr("Continue setup")}
                  </Link>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link href={dashboardHref}>{fallbackTr("Open Home")}</Link>
                </Button>
              </div>
            </section>

            {setupSummary ? (
              <ResourceInlineNotice
                label={
                  setupSummary.mode === "ready"
                    ? fallbackTr("Setup complete")
                    : fallbackTr("Next step")
                }
                message={
                  setupSummary.mode === "ready"
                    ? fallbackTr("Core setup is complete.")
                    : nextSetupStep ? fallbackTr(nextSetupStep.title) : fallbackTr("Continue setup")
                }
                detail={
                  setupSummary.mode === "ready"
                    ? fallbackTr("Open operations or review setup details.")
                    : nextSetupStep ? fallbackTr(nextSetupStep.description) : undefined
                }
                tone={setupSummary.mode === "ready" ? "success" : "warning"}
              />
            ) : null}

            {summaryStripItems.length ? (
              <ResourceSummaryStrip items={summaryStripItems} />
            ) : null}

            {setupChecklistItems.length ? (
              <GettingStartedChecklist
                title={fallbackTr("Setup steps")}
                items={setupChecklistItems}
              />
            ) : null}
          </div>
        )}
      </section>
    </AppShell>
  );
}
