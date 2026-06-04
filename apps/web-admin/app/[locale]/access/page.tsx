import { AppShell } from "@/app/components/app-shell";
import { loadWorkspaceSelection } from "@/app/lib/control-api";
import { getCurrentLocale } from "@/app/lib/i18n-server";
import {
  buildGatewayEndpoint,
  buildGatewayRequestUrl,
  loadConsoleSettings,
} from "@/app/lib/console-settings";
import { normalizeWorkspacePreferenceValue, workspacePreferenceCookieName } from "@/app/lib/workspace-preference";
import { cookies } from "next/headers";
import { AccessView } from "./access-view";

export const dynamic = "force-dynamic";

type AccessPageProps = {
  searchParams?: Promise<{
    workspaceId?: string;
    returnTo?: string;
  }>;
};

export default async function AccessPage({ searchParams }: AccessPageProps) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const cookieStore = await cookies();
  const explicitWorkspaceId = normalizeWorkspacePreferenceValue(resolvedSearchParams.workspaceId);
  const rememberedWorkspaceId = normalizeWorkspacePreferenceValue(
    cookieStore.get(workspacePreferenceCookieName)?.value,
  );

  const workspaceSelection = await loadWorkspaceSelection(
    explicitWorkspaceId ?? rememberedWorkspaceId,
  );
  const consoleSettings = await loadConsoleSettings();
  const locale = await getCurrentLocale();
  const title = locale === "zh" ? "开发者接入" : "Developer Access";
  const subtitle =
    locale === "zh"
      ? "为当前成员申请短期开发凭据，并按已分配项目接入网关。"
      : "Issue a short-lived personal key for the current member and connect through assigned projects.";

  const selectedWorkspace = workspaceSelection.selectedWorkspaceId
    ? workspaceSelection.workspaceOptions.find((w) => w.id === workspaceSelection.selectedWorkspaceId)
    : null;

  const shellWorkspaceOptions = workspaceSelection.workspaceOptions.map((workspace) => ({
    id: workspace.id,
    label: `${workspace.organizationName} / ${workspace.name}`,
  }));

  const workspaceLabel = selectedWorkspace
    ? `${selectedWorkspace.organizationName} / ${selectedWorkspace.name}`
    : null;
  const gatewayEndpoint = buildGatewayEndpoint(consoleSettings.runtimeSettings);
  const gatewayChatCompletionsUrl = buildGatewayRequestUrl(
    consoleSettings.runtimeSettings,
    consoleSettings.runtimeSettings.gatewayChatCompletionsPath,
  );
  const workspaceDefaults = workspaceSelection.selectedWorkspaceId
    ? consoleSettings.workspaceDefaultsById[workspaceSelection.selectedWorkspaceId] ??
      consoleSettings.workspaceDefaultsDefaults
    : consoleSettings.workspaceDefaultsDefaults;

  return (
    <AppShell
      title={title}
      subtitle={subtitle}
      headerMode="compact"
      showOperatorContextCards={false}
      showSupportPanels={false}
      sidebarVariant="minimal"
      workspaceId={workspaceSelection.selectedWorkspaceId}
      workspaceLabel={workspaceLabel}
      workspaceOptions={shellWorkspaceOptions}
    >
      <AccessView
        gatewayChatCompletionsUrl={gatewayChatCompletionsUrl}
        gatewayEndpoint={gatewayEndpoint}
        locale={locale}
        workspaceDefaults={workspaceDefaults}
        workspaceId={workspaceSelection.selectedWorkspaceId}
        workspaceLabel={workspaceLabel}
      />
    </AppShell>
  );
}
