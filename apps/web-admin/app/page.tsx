import { Link } from "@/i18n/navigation";
import { cookies } from "next/headers";

import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";

import { AppShell } from "./components/app-shell";
import { HomeGlobalOverview } from "./components/home-global-overview";
import { HomeMemberOverview } from "./components/home-member-overview";
import { ResourceInlineNotice } from "./components/resource-inline-notice";
import {
  getSetupNextStep,
  getSetupProgress,
  loadWorkspaceSetupSummary,
  type WorkspaceSetupSummary,
} from "./components/setup-summary";
import {
  fetchAuthIdentityOptions,
  fetchAuthSession,
  loadGlobalHomeDashboardData,
  loadOrganizationsState,
  loadWorkspaceSelection,
  pickFirstControlApiIssue,
} from "./lib/control-api";
import { resolveWorkspaceIdentitySelection } from "./lib/auth-identities";
import { getCapabilitiesFromPermissions } from "./lib/capabilities";
import {
  buildContextualHref,
  getSafeReturnTo,
} from "./lib/navigation";
import { translateInlineText } from "./lib/i18n";
import { getCurrentLocale, getT } from "./lib/i18n-server";
import {
  normalizeWorkspacePreferenceValue,
  workspacePreferenceCookieName,
} from "./lib/workspace-preference";

export const dynamic = "force-dynamic";

type DashboardPageProps = {
  searchParams?: Promise<{
    workspaceId?: string;
    returnTo?: string;
    tab?: string;
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

export default async function DashboardPage({
  searchParams,
}: DashboardPageProps) {
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
  const organizationsState = await loadOrganizationsState();
  const organizations = organizationsState.items;
  const organizationWorkspaceCounts = workspaceSelection.workspaceOptions.reduce(
    (counts, workspace) => {
      counts.set(
        workspace.organizationId,
        (counts.get(workspace.organizationId) ?? 0) + 1,
      );
      return counts;
    },
    new Map<string, number>(),
  );
  const organizationSummaries = organizations.map((organization) => ({
    ...organization,
    workspaceCount: organizationWorkspaceCounts.get(organization.id) ?? 0,
  }));

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
    returnTo: dashboardHref,
  });
  const workspaceLabel = selectedWorkspace
    ? `${selectedWorkspace.organizationName} / ${selectedWorkspace.name}`
    : null;
  const shellWorkspaceOptions = workspaceSelection.workspaceOptions.map((workspace) => ({
    id: workspace.id,
    label: `${workspace.organizationName} / ${workspace.name}`,
  }));
  const authSession = await fetchAuthSession().catch(() => null);
  const workspaceIdentitySelection =
    selectedWorkspaceId && authSession
      ? await fetchAuthIdentityOptions()
          .then((identities) =>
            resolveWorkspaceIdentitySelection({
              identities,
              targetWorkspaceId: selectedWorkspaceId,
              activeMembershipId: authSession.activeMembershipId,
              activeRole: authSession.activeRole,
            }),
          )
          .catch(() => null)
      : null;
  const shouldHoldHomeContentForIdentitySwitch = Boolean(
    workspaceIdentitySelection?.needsSwitch,
  );
  const globalHomeData = await loadGlobalHomeDashboardData({
    organizations: organizationSummaries,
    workspaceOptions: workspaceSelection.workspaceOptions,
    selectedWorkspaceId,
    locale,
    suspendForIdentitySwitch: shouldHoldHomeContentForIdentitySwitch,
  });
  const capabilities = getCapabilitiesFromPermissions(globalHomeData.permissions);
  const showMemberOverview =
    capabilities.canSelfServeVirtualKeys && !capabilities.canAccessAdminSurfaces;

  const workspaceSelectionIssue =
    workspaceSelection.selectedWorkspaceId &&
    workspaceSelection.issue?.resource === "workspace-selection"
      ? null
      : workspaceSelection.issue;
  const dashboardIssue = pickFirstControlApiIssue(
    workspaceSelectionIssue,
    organizationsState.issue,
    globalHomeData.issue,
  );
  const organizationsHref = buildContextualHref("/organizations", dashboardHref);
  const workspacesHref = buildContextualHref("/workspaces", dashboardHref);
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
  let setupSummary: WorkspaceSetupSummary | null = null;

  if (selectedWorkspaceId && !shouldHoldHomeContentForIdentitySwitch) {
    try {
      setupSummary = await loadWorkspaceSetupSummary({
        workspaceId: selectedWorkspaceId,
        locale,
        returnTo: dashboardHref,
      });
    } catch {
      setupSummary = null;
    }
  }

  const setupProgress = setupSummary ? getSetupProgress(setupSummary) : null;
  const nextSetupStep = setupSummary ? getSetupNextStep(setupSummary) : null;
  const setupReminder =
    selectedWorkspaceId && setupSummary?.mode === "setup" && setupProgress
      ? {
          remainingCount: Math.max(
            setupProgress.totalCount - setupProgress.doneCount,
            0,
          ),
          href: setupHref,
          nextTitle: nextSetupStep ? fallbackTr(nextSetupStep.title) : null,
        }
      : null;
  const showGlobalOverview = hasOrganizations && hasAnyWorkspace;
  const homeContent = shouldHoldHomeContentForIdentitySwitch ? null : showGlobalOverview ? (
    showMemberOverview ? (
      <HomeMemberOverview data={globalHomeData} locale={locale} />
    ) : (
      <HomeGlobalOverview
        dashboardHref={dashboardHref}
        data={globalHomeData}
        initialGuideExitedWorkspaceIds={authSession?.guideExitedWorkspaceIds ?? []}
        locale={locale}
        selectedWorkspaceId={selectedWorkspaceId}
        setupReminder={setupReminder}
      />
    )
  ) : (
    <section className="max-w-2xl rounded-xl border border-dashed border-border/60 bg-background px-6 py-7 shadow-none">
      <div className="space-y-5">
        <div className="space-y-2.5">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">
            {setupCardTitle}
          </h2>
          <p className="max-w-[54ch] text-sm leading-6 text-muted-foreground">
            {setupCardDescription}
          </p>
        </div>

        {hasAnyWorkspace ? (
          <div className="space-y-3 pt-1">
            <p className="max-w-[54ch] text-sm leading-6 text-muted-foreground">
              {fallbackTr("Use the workspace switcher in the header to choose the active workspace.")}
            </p>
            <Button asChild size="sm" variant="outline" className="rounded-md px-4 shadow-none">
              <Link href={setupPrimaryHref}>{setupPrimaryLabel}</Link>
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2 pt-1">
            <Button asChild size="sm" className="rounded-md px-4 shadow-none">
              <Link href={setupPrimaryHref}>{setupPrimaryLabel}</Link>
            </Button>
          </div>
        )}
      </div>
    </section>
  );

  return (
    <AppShell
      title={t("title")}
      subtitle=""
      workspaceId={selectedWorkspaceId}
      workspaceLabel={workspaceLabel}
      workspaceOptions={shellWorkspaceOptions}
      workspaceSelectionSource={workspaceSelectionSource}
      headerMode="compact"
      sidebarVariant="minimal"
      showSupportPanels={false}
    >
      <section className="space-y-5 sm:space-y-6">
        <div className="w-full space-y-6 sm:space-y-8">
          {dashboardIssue && !showMemberOverview && !shouldHoldHomeContentForIdentitySwitch ? (
            <ResourceInlineNotice
              tone="warning"
              label={t("serviceStatus.label")}
              message={fallbackTr(dashboardIssue.message)}
              detail={
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge
                    className="h-5 px-1.5 text-[10px] font-bold uppercase tracking-wider"
                    status="warning"
                  >
                    {t("serviceStatus.degradedBadge")}
                  </StatusBadge>
                  <p className="text-[13px] font-medium text-foreground/80 leading-relaxed">
                    {t("serviceStatus.degradedDescription")}
                  </p>
                </div>
              }
              actions={
                <Button asChild size="sm" variant="outline" className="rounded-full px-4 border-warning-border/30 hover:bg-warning-soft/20 text-warning-strong">
                  <Link href={selectedWorkspaceId ? workspacesHref : setupPrimaryHref}>
                    {selectedWorkspaceId ? t("changeWorkspace") : setupPrimaryLabel}
                  </Link>
                </Button>
              }
              className="rounded-2xl border-warning-border/20 bg-warning-soft/10"
            />
          ) : null}
          {homeContent}
        </div>
      </section>
    </AppShell>
  );
}
