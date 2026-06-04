import type {
  Alert,
  AuditLog,
  BudgetPolicySummary,
  CreatedVirtualKeyResponse,
  Environment,
  Project,
  ProviderConnection,
  ProviderConnectionModelCatalog,
  SelfServeModelCatalog,
  SavedView,
  SelfServeVirtualKeyBootstrap,
  UsageEvent,
  UsageEventDailyResponse,
  UsageEventSummary,
  VirtualKeyListResponse,
  WorkspaceHomeOverview,
  WorkspaceModelCatalogResponse,
  WorkspaceOption,
  WorkspaceSetupSummary,
  Workspace,
} from "@teamops/contracts";
import type { AuthIdentityOption } from "./auth-identities";
import type { Capabilities } from "./capabilities";

export type ConsoleIssue = {
  kind:
    | "missing-auth"
    | "missing-route"
    | "missing-table"
    | "invalid-selection"
    | "unavailable"
    | "unexpected";
  resource:
    | "workspace-selection"
    | "workspace-options"
    | "saved_views"
    | "scheduled_reports"
    | "control-api";
  message: string;
  path: string;
  status: number | null;
};

export type ConsoleSelectionStatus =
  | "selected"
  | "needs-selection"
  | "missing"
  | "invalid"
  | "unavailable";

export type WorkspaceIdentityResolution = {
  status: "matched" | "switch_required" | "switch_failed";
  workspaceId: string | null;
  selectedMembershipId: string | null;
  selectedRole: string | null;
};

export type ConsoleBootstrapResponse = {
  auth: {
    status: "authenticated" | "unauthenticated";
    user: {
      id: string;
      email: string;
      name: string | null;
    } | null;
    activeMembershipId: string | null;
    activeRole: string | null;
  };
  identities: AuthIdentityOption[];
  workspace: {
    requestedWorkspaceId: string | null;
    activeWorkspaceId: string | null;
    options: WorkspaceOption[];
    selectionStatus: ConsoleSelectionStatus;
    identityResolution: WorkspaceIdentityResolution;
  };
  capabilities: Capabilities;
  selectionStatus: ConsoleSelectionStatus;
  issues: ConsoleIssue[];
  user: {
    id: string;
    email: string;
    name: string | null;
  } | null;
  activeMembershipId: string | null;
  activeRole: string | null;
  workspaceOptions: WorkspaceOption[];
  preferredWorkspaceId: string | null;
};

export type WorkspaceScopedConsoleResponse = {
  workspaceOptions: WorkspaceOption[];
  selectedWorkspaceId: string | null;
  selectionStatus: ConsoleSelectionStatus;
  issue: ConsoleIssue | null;
};

export type ProvidersPageResponse = WorkspaceScopedConsoleResponse & {
  providerConnections: ProviderConnection[];
};

export type ConsoleSettingsResponse = {
  preferencesDefaults: {
    themeMode: "light" | "dark" | "system";
    accentPreset: "blue" | "green" | "amber";
    fontSize: "small" | "medium" | "large";
    density: "compact" | "standard" | "comfortable";
    sidebarWidth: "narrow" | "standard" | "wide";
    defaultLandingPage: "home" | "workspaces" | "providers" | "usage-events";
    rememberLastWorkspace: boolean;
    rememberLastFilters: boolean;
    showSupportPanelsByDefault: boolean;
  };
  runtimeDefaults: {
    gatewayBaseUrl: string;
    gatewayRequestBasePath: string;
    gatewayChatCompletionsPath: string;
    gatewayResponsesPath: string;
    gatewayModelsPath: string;
    gatewayHealthPath: string;
    gatewayRequestTimeoutMs: number;
  };
  workspaceDefaultsDefaults: {
    defaultProviderConnectionId: string | null;
    defaultModelCatalogSourceHint: string | null;
    defaultVirtualKeyTtlHours: number;
    defaultVirtualKeyScopesTemplate: string[];
    defaultProjectId: string | null;
  };
  references: {
    controlApiBaseUrl: string;
    gatewayProxyPathPrefix: string;
    webAdminHealthPath: string;
  };
  filePath: string;
  runtimeSettings: {
    gatewayBaseUrl: string;
    gatewayRequestBasePath: string;
    gatewayChatCompletionsPath: string;
    gatewayResponsesPath: string;
    gatewayModelsPath: string;
    gatewayHealthPath: string;
    gatewayRequestTimeoutMs: number;
    updatedAt: string | null;
  };
  workspaceDefaultsById: Record<
    string,
    {
      defaultProviderConnectionId: string | null;
      defaultModelCatalogSourceHint: string | null;
      defaultVirtualKeyTtlHours: number;
      defaultVirtualKeyScopesTemplate: string[];
      defaultProjectId: string | null;
    }
  >;
  updatedAt: string | null;
  source: "defaults" | "file";
};

export type ConsoleSettingsProbeResponse = {
  ok: boolean;
  url: string;
  durationMs: number;
  httpStatus: number | null;
  service: string | null;
  timestamp: string | null;
  message: string | null;
};

export type ConsoleSettingsWorkspaceContextResponse = WorkspaceScopedConsoleResponse & {
  projects: Project[];
  providerConnections: ProviderConnection[];
};

export type WorkspacesPageResponse = {
  organizationId: string | null;
  workspaces: Workspace[];
  setupSummariesByWorkspaceId: Record<string, WorkspaceSetupSummary | null>;
};

export type UsagePageResponse = WorkspaceScopedConsoleResponse & {
  projects: Project[];
  environments: Environment[];
  usage: {
    items: UsageEvent[];
    total: number;
  };
  summary: UsageEventSummary;
  savedViews: SavedView[];
  savedViewsIssue: ConsoleIssue | null;
  loadError: string | null;
};

export type AuditPageResponse = WorkspaceScopedConsoleResponse & {
  projects: Project[];
  environments: Environment[];
  audit: {
    items: AuditLog[];
    total: number;
  };
  savedViews: SavedView[];
  savedViewsIssue: ConsoleIssue | null;
  loadError: string | null;
};

export type AlertsPageResponse = WorkspaceScopedConsoleResponse & {
  projects: Project[];
  environments: Environment[];
  allAlerts: Alert[];
  alerts: Alert[];
  alertsIssue: ConsoleIssue | null;
};

export type HomeSnapshotResponse = {
  workspaceId: string;
  overview: WorkspaceHomeOverview | null;
  providerConnections: ProviderConnection[];
  virtualKeys: VirtualKeyListResponse;
  recentUsage: {
    items: UsageEvent[];
    total: number;
  };
  recentAudit: {
    items: AuditLog[];
    total: number;
  };
  budgetSummaries: BudgetPolicySummary[];
  openAlerts: Alert[];
  dailyUsage: UsageEventDailyResponse;
  activationAuditEntries: Array<{
    action: string;
    entry: AuditLog | null;
  }>;
};

export type SelfServeVirtualKeyBootstrapResponse = SelfServeVirtualKeyBootstrap;

export type SelfServeModelCatalogResponse = SelfServeModelCatalog;
export type ProviderConnectionModelCatalogResponse = ProviderConnectionModelCatalog;
export type WorkspaceModelCatalogPageResponse = WorkspaceModelCatalogResponse;

export type SelfServeVirtualKeyMutationResponse = CreatedVirtualKeyResponse;
