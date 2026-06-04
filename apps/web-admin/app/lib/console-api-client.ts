"use client";

import {
  QueryClient,
  keepPreviousData,
  queryOptions,
  useQuery,
  type UseQueryOptions,
} from "@tanstack/react-query";

import type {
  AlertsPageResponse,
  AuditPageResponse,
  ConsoleSettingsProbeResponse,
  ConsoleSettingsResponse,
  ConsoleSettingsWorkspaceContextResponse,
  ConsoleBootstrapResponse,
  HomeSnapshotResponse,
  ProviderConnectionModelCatalogResponse,
  ProvidersPageResponse,
  SelfServeModelCatalogResponse,
  SelfServeVirtualKeyBootstrapResponse,
  SelfServeVirtualKeyMutationResponse,
  WorkspaceModelCatalogPageResponse,
  WorkspacesPageResponse,
  UsagePageResponse,
} from "./console-api-contracts";

type Primitive = string | number | boolean | null | undefined;
type QueryParams = Record<string, Primitive>;

export class ConsoleHttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string | null,
  ) {
    super(message);
    this.name = "ConsoleHttpError";
  }
}

function isAuthenticationPublicPath(pathname: string) {
  const normalizedPathname = pathname.replace(/^\/(?:en|zh)(?=\/|$)/i, "") || "/";
  return normalizedPathname === "/login" || normalizedPathname.startsWith("/auth/");
}

export class ConsoleAuthRedirectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConsoleAuthRedirectError";
  }
}

function shouldRedirectForConsoleAuthFailure(status: number, errorCode: string | null) {
  return (
    status === 401 &&
    (errorCode === "AUTH_REQUIRED" || errorCode === "SESSION_EXPIRED" || errorCode === "SESSION_REVOKED")
  );
}

function handleConsoleAuthFailure(status: number, errorCode: string | null, message: string | null) {
  if (
    !shouldRedirectForConsoleAuthFailure(status, errorCode) ||
    typeof window === "undefined" ||
    isAuthenticationPublicPath(window.location.pathname)
  ) {
    return false;
  }

  const returnTo = `${window.location.pathname}${window.location.search}`;
  window.location.assign(`/login?returnTo=${encodeURIComponent(returnTo)}`);
  throw new ConsoleAuthRedirectError(message ?? "Authentication is required");
}

export async function fetchConsoleJson<T>(path: string, params?: QueryParams): Promise<T> {
  const origin =
    typeof window === "undefined" ? "http://localhost" : window.location.origin;
  const url = new URL(path, origin);

  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === undefined || value === null || value === "") {
      continue;
    }

    url.searchParams.set(key, String(value));
  }

  const response = await fetch(url.toString(), {
    cache: "no-store",
    headers: {
      accept: "application/json",
    },
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { error?: { message?: string; code?: string } }
      | null;
    const errorCode = payload?.error?.code ?? null;
    handleConsoleAuthFailure(response.status, errorCode, payload?.error?.message ?? null);

    throw new ConsoleHttpError(
      payload?.error?.message ?? `Request failed with ${response.status}`,
      response.status,
      errorCode,
    );
  }

  return (await response.json()) as T;
}

export async function postConsoleJson<T>(
  path: string,
  payload: Record<string, unknown>,
  requestInit?: Omit<RequestInit, "body" | "method">,
): Promise<T> {
  const origin =
    typeof window === "undefined" ? "http://localhost" : window.location.origin;
  const url = new URL(path, origin);
  const headers = new Headers(requestInit?.headers);
  headers.set("accept", "application/json");
  headers.set("content-type", "application/json");

  const response = await fetch(url.toString(), {
    ...requestInit,
    method: "POST",
    cache: "no-store",
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorPayload = (await response.json().catch(() => null)) as
      | { error?: { message?: string; code?: string } }
      | null;
    const errorCode = errorPayload?.error?.code ?? null;
    handleConsoleAuthFailure(response.status, errorCode, errorPayload?.error?.message ?? null);
    throw new ConsoleHttpError(
      errorPayload?.error?.message ?? `Request failed with ${response.status}`,
      response.status,
      errorCode,
    );
  }

  return (await response.json()) as T;
}

export async function fetchConsoleSettings() {
  return fetchConsoleJson<ConsoleSettingsResponse>("/api/console/settings");
}

export async function updateConsoleRuntimeSettings(
  payload: ConsoleSettingsResponse["runtimeDefaults"],
) {
  return postConsoleJson<ConsoleSettingsResponse>(
    "/api/console/settings/runtime",
    payload,
  );
}

export async function updateConsoleWorkspaceDefaults(args: {
  workspaceId: string;
  defaults: ConsoleSettingsResponse["workspaceDefaultsDefaults"];
}) {
  return postConsoleJson<ConsoleSettingsResponse>(
    "/api/console/settings/workspace-defaults",
    {
      workspaceId: args.workspaceId,
      ...args.defaults,
    },
  );
}

export async function probeConsoleSettings(
  payload: ConsoleSettingsResponse["runtimeDefaults"],
) {
  return postConsoleJson<ConsoleSettingsProbeResponse>(
    "/api/console/settings/probe",
    payload,
  );
}

export async function fetchConsoleSettingsWorkspaceContext(workspaceId: string) {
  return fetchConsoleJson<ConsoleSettingsWorkspaceContextResponse>(
    "/api/console/settings/workspace-context",
    {
      workspaceId,
    },
  );
}

export async function postConsoleVoid(
  path: string,
  payload: Record<string, unknown>,
  requestInit?: Omit<RequestInit, "body" | "method">,
) {
  const origin =
    typeof window === "undefined" ? "http://localhost" : window.location.origin;
  const url = new URL(path, origin);
  const headers = new Headers(requestInit?.headers);
  headers.set("accept", "application/json");
  headers.set("content-type", "application/json");

  const response = await fetch(url.toString(), {
    ...requestInit,
    method: "POST",
    cache: "no-store",
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorPayload = (await response.json().catch(() => null)) as
      | { error?: { message?: string; code?: string } }
      | null;
    const errorCode = errorPayload?.error?.code ?? null;
    handleConsoleAuthFailure(response.status, errorCode, errorPayload?.error?.message ?? null);
    throw new ConsoleHttpError(
      errorPayload?.error?.message ?? `Request failed with ${response.status}`,
      response.status,
      errorCode,
    );
  }
}

export function createConsoleQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        gcTime: 5 * 60 * 1000,
        refetchOnWindowFocus: false,
      },
    },
  });
}

function providersQueryOptions(params: {
  workspaceId?: string | null;
}) {
  return queryOptions({
    queryKey: ["console", "providers", params] as const,
    queryFn: () => fetchConsoleJson<ProvidersPageResponse>("/api/console/providers", params),
  });
}

function workspacesQueryOptions(params: {
  organizationId?: string | null;
  workspaceId?: string | null;
}) {
  return queryOptions({
    queryKey: ["console", "workspaces", params] as const,
    queryFn: () => fetchConsoleJson<WorkspacesPageResponse>("/api/console/workspaces", params),
  });
}

function usageQueryOptions(params: {
  workspaceId?: string | null;
  projectId?: string | null;
  environmentId?: string | null;
  provider?: string | null;
  outcome?: string | null;
  status?: string | null;
  statusGroup?: string | null;
  surface?: string | null;
  model?: string | null;
  virtualKeyId?: string | null;
  providerConnectionId?: string | null;
  budgetPolicyId?: string | null;
  requestId?: string | null;
  providerRequestId?: string | null;
  minLatencyMs?: number | null;
  sortBy?: string | null;
  from?: string | null;
  to?: string | null;
  offset?: number | null;
}) {
  return queryOptions({
    queryKey: ["console", "usage", params] as const,
    queryFn: () => fetchConsoleJson<UsagePageResponse>("/api/console/usage", params),
  });
}

function auditQueryOptions(params: {
  workspaceId?: string | null;
  projectId?: string | null;
  environmentId?: string | null;
  actorType?: string | null;
  actorId?: string | null;
  action?: string | null;
  subjectType?: string | null;
  subjectId?: string | null;
  from?: string | null;
  to?: string | null;
  offset?: number | null;
}) {
  return queryOptions({
    queryKey: ["console", "audit", params] as const,
    queryFn: () => fetchConsoleJson<AuditPageResponse>("/api/console/audit", params),
  });
}

function alertsQueryOptions(params: {
  workspaceId?: string | null;
  projectId?: string | null;
  environmentId?: string | null;
  status?: string | null;
  severity?: string | null;
  code?: string | null;
  budgetPolicyId?: string | null;
}) {
  return queryOptions({
    queryKey: ["console", "alerts", params] as const,
    queryFn: () => fetchConsoleJson<AlertsPageResponse>("/api/console/alerts", params),
  });
}

function homeSnapshotQueryOptions(workspaceId: string | null | undefined) {
  return queryOptions({
    queryKey: ["console", "home-snapshot", workspaceId ?? null] as const,
    queryFn: () =>
      fetchConsoleJson<HomeSnapshotResponse>("/api/console/home-snapshot", {
        workspaceId,
      }),
  });
}

type BootstrapOptions = {
  workspaceId?: string | null;
  enabled?: boolean;
};

export function getConsoleBootstrapQueryKey(workspaceId?: string | null) {
  return ["console", "bootstrap", workspaceId ?? null] as const;
}

export async function fetchConsoleBootstrap(workspaceId?: string | null) {
  return fetchConsoleJson<ConsoleBootstrapResponse>("/api/console/bootstrap", {
    workspaceId,
  });
}

export function useConsoleBootstrapQuery({ workspaceId, enabled = true }: BootstrapOptions = {}) {
  return useQuery({
    queryKey: getConsoleBootstrapQueryKey(workspaceId),
    queryFn: () => fetchConsoleBootstrap(workspaceId),
    enabled: enabled && typeof window !== "undefined",
    placeholderData: keepPreviousData,
  });
}

export function useProvidersPageQuery(params: {
  workspaceId?: string | null;
}) {
  return useQuery({
    ...providersQueryOptions(params),
    enabled: typeof window !== "undefined",
    placeholderData: keepPreviousData,
  });
}

export function useWorkspacesPageQuery(
  params: {
    organizationId?: string | null;
    workspaceId?: string | null;
  },
  options?: Pick<UseQueryOptions<WorkspacesPageResponse>, "enabled" | "initialData">,
) {
  return useQuery({
    ...workspacesQueryOptions(params),
    enabled: (options?.enabled ?? true) && typeof window !== "undefined",
    initialData: options?.initialData,
    placeholderData: keepPreviousData,
  });
}

export function useUsagePageQuery(params: {
  workspaceId?: string | null;
  projectId?: string | null;
  environmentId?: string | null;
  provider?: string | null;
  outcome?: string | null;
  status?: string | null;
  statusGroup?: string | null;
  surface?: string | null;
  model?: string | null;
  virtualKeyId?: string | null;
  providerConnectionId?: string | null;
  budgetPolicyId?: string | null;
  requestId?: string | null;
  providerRequestId?: string | null;
  minLatencyMs?: number | null;
  sortBy?: string | null;
  from?: string | null;
  to?: string | null;
  offset?: number | null;
}) {
  return useQuery({
    ...usageQueryOptions(params),
    enabled: typeof window !== "undefined",
    placeholderData: keepPreviousData,
  });
}

export function useAuditPageQuery(params: {
  workspaceId?: string | null;
  projectId?: string | null;
  environmentId?: string | null;
  actorType?: string | null;
  actorId?: string | null;
  action?: string | null;
  subjectType?: string | null;
  subjectId?: string | null;
  from?: string | null;
  to?: string | null;
  offset?: number | null;
}) {
  return useQuery({
    ...auditQueryOptions(params),
    enabled: typeof window !== "undefined",
    placeholderData: keepPreviousData,
  });
}

export function useAlertsPageQuery(params: {
  workspaceId?: string | null;
  projectId?: string | null;
  environmentId?: string | null;
  status?: string | null;
  severity?: string | null;
  code?: string | null;
  budgetPolicyId?: string | null;
}) {
  return useQuery({
    ...alertsQueryOptions(params),
    enabled: typeof window !== "undefined",
    placeholderData: keepPreviousData,
  });
}

export function useHomeSnapshotQuery(
  workspaceId: string | null | undefined,
  options?: Pick<UseQueryOptions<HomeSnapshotResponse>, "enabled">,
) {
  return useQuery({
    ...homeSnapshotQueryOptions(workspaceId),
    enabled: Boolean(workspaceId) && (options?.enabled ?? true) && typeof window !== "undefined",
    placeholderData: keepPreviousData,
  });
}

export async function fetchSelfServeVirtualKeyBootstrap(workspaceId: string) {
  return fetchConsoleJson<SelfServeVirtualKeyBootstrapResponse>(
    "/api/console/self-serve-virtual-keys/bootstrap",
    { workspaceId },
  );
}

export async function issueSelfServeVirtualKeyMutation(args: {
  workspaceId: string;
  projectId: string;
  protocol: "openai-compatible" | "anthropic";
}) {
  return postConsoleJson<SelfServeVirtualKeyMutationResponse>(
    "/api/console/self-serve-virtual-keys/issue",
    args,
  );
}

export async function fetchSelfServeProviderModels(args: {
  workspaceId: string;
  providerConnectionId: string;
}) {
  return fetchConsoleJson<SelfServeModelCatalogResponse>(
    "/api/console/self-serve-virtual-keys/models",
    args,
  );
}

export async function fetchProviderConnectionModelCatalog(args: {
  workspaceId: string;
  providerConnectionId: string;
}) {
  return fetchConsoleJson<ProviderConnectionModelCatalogResponse>(
    `/api/console/providers/${args.providerConnectionId}/models`,
    {
      workspaceId: args.workspaceId,
    },
  );
}

export async function fetchWorkspaceModelCatalog(workspaceId: string) {
  return fetchConsoleJson<WorkspaceModelCatalogPageResponse>(
    "/api/console/model-catalog",
    { workspaceId },
  );
}

export async function createCatalogModel(args: {
  workspaceId: string;
  modelId: string;
  label: string;
  sourceProviderConnectionId: string;
}) {
  return postConsoleJson(
    "/api/console/model-catalog",
    args,
  );
}

export async function syncWorkspaceModelAssignments(args: {
  workspaceId: string;
  modelIds: string[];
}) {
  return postConsoleJson<WorkspaceModelCatalogPageResponse>(
    "/api/console/model-catalog/assignments",
    args,
  );
}

export async function fetchProviderConnectionModelCatalogPreview(args: {
  workspaceId: string;
  provider: "anthropic" | "openai" | "openai-compatible";
  label: string;
  apiKey: string;
  baseUrl?: string;
  anthropicVersion?: string;
  metadata?: Record<string, string>;
}) {
  const metadata: Record<string, string> = {
    ...(args.metadata ?? {}),
  };

  if (args.baseUrl?.trim()) {
    metadata.baseUrl = args.baseUrl.trim();
  }

  if (args.provider === "anthropic" && args.anthropicVersion?.trim()) {
    metadata.anthropicVersion = args.anthropicVersion.trim();
  }

  return postConsoleJson<ProviderConnectionModelCatalogResponse>(
    "/api/console/providers/models/preview",
    {
      workspaceId: args.workspaceId,
      provider: args.provider,
      label: args.label,
      apiKey: args.apiKey,
      metadata,
    },
  );
}

function getOptionalFilter(value: string | null) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function parseOffset(value: string | null) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }

  return parsed;
}

export async function prefetchConsoleRouteData(
  queryClient: QueryClient,
  href: string,
  options?: { skip?: boolean },
) {
  if (options?.skip) {
    return;
  }

  const url = new URL(href, "http://localhost");
  const workspaceId = getOptionalFilter(url.searchParams.get("workspaceId"));

  if (!workspaceId && url.pathname !== "/") {
    return;
  }

  if (url.pathname === "/providers") {
    await queryClient.prefetchQuery(providersQueryOptions({ workspaceId }));
    return;
  }

  if (url.pathname === "/usage-events") {
    await queryClient.prefetchQuery(
      usageQueryOptions({
        workspaceId,
        projectId: getOptionalFilter(url.searchParams.get("projectId")),
        environmentId: getOptionalFilter(url.searchParams.get("environmentId")),
        provider: getOptionalFilter(url.searchParams.get("provider")),
        outcome: getOptionalFilter(url.searchParams.get("outcome")),
        status: getOptionalFilter(url.searchParams.get("status")),
        statusGroup: getOptionalFilter(url.searchParams.get("statusGroup")),
        surface: getOptionalFilter(url.searchParams.get("surface")),
        model: getOptionalFilter(url.searchParams.get("model")),
        virtualKeyId: getOptionalFilter(url.searchParams.get("virtualKeyId")),
        providerConnectionId: getOptionalFilter(url.searchParams.get("providerConnectionId")),
        budgetPolicyId: getOptionalFilter(url.searchParams.get("budgetPolicyId")),
        requestId: getOptionalFilter(url.searchParams.get("requestId")),
        providerRequestId: getOptionalFilter(url.searchParams.get("providerRequestId")),
        minLatencyMs: getOptionalFilter(url.searchParams.get("minLatencyMs"))
          ? Number(url.searchParams.get("minLatencyMs"))
          : null,
        sortBy: getOptionalFilter(url.searchParams.get("sortBy")),
        from: getOptionalFilter(url.searchParams.get("from")),
        to: getOptionalFilter(url.searchParams.get("to")),
        offset: parseOffset(url.searchParams.get("offset")),
      }),
    );
    return;
  }

  if (url.pathname === "/audit-logs") {
    await queryClient.prefetchQuery(
      auditQueryOptions({
        workspaceId,
        projectId: getOptionalFilter(url.searchParams.get("projectId")),
        environmentId: getOptionalFilter(url.searchParams.get("environmentId")),
        actorType: getOptionalFilter(url.searchParams.get("actorType")),
        actorId: getOptionalFilter(url.searchParams.get("actorId")),
        action: getOptionalFilter(url.searchParams.get("action")),
        subjectType: getOptionalFilter(url.searchParams.get("subjectType")),
        subjectId: getOptionalFilter(url.searchParams.get("subjectId")),
        from: getOptionalFilter(url.searchParams.get("from")),
        to: getOptionalFilter(url.searchParams.get("to")),
        offset: parseOffset(url.searchParams.get("offset")),
      }),
    );
    return;
  }

  if (url.pathname === "/alerts") {
    await queryClient.prefetchQuery(
      alertsQueryOptions({
        workspaceId,
        projectId: getOptionalFilter(url.searchParams.get("projectId")),
        environmentId: getOptionalFilter(url.searchParams.get("environmentId")),
        status: getOptionalFilter(url.searchParams.get("status")),
        severity: getOptionalFilter(url.searchParams.get("severity")),
        code: getOptionalFilter(url.searchParams.get("code")),
        budgetPolicyId: getOptionalFilter(url.searchParams.get("budgetPolicyId")),
      }),
    );
    return;
  }

  if (url.pathname === "/") {
    return;
  }
}
