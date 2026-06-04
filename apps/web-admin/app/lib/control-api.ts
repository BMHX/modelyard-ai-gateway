import { randomUUID } from "node:crypto";
import { revalidateTag, unstable_cache } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";

import {
  AlertSchema,
  AuthSessionSchema,
  AlertQuerySchema,
  AuditLogSchema,
  BudgetPolicySchema,
  BudgetPolicySummarySchema,
  CreateBudgetPolicyInputSchema,
  CreateEnvironmentInputSchema,
  CreateExportJobInputSchema,
  CreateScheduledReportInputSchema,
  CreateProviderConnectionInputSchema,
  CreateOrganizationInputSchema,
  CreateMemberInputSchema,
  CreateProjectInputSchema,
  CreateVirtualKeyInputSchema,
  ReplaceMemberProjectAssignmentsInputSchema,
  CreateWorkspaceInputSchema,
  CreatedVirtualKeyResponseSchema,
  EnvironmentSchema,
  ExportJobSchema,
  AttestationBundleSchema,
  BuildDescriptorResponseSchema,
  LineageIssuanceSchema,
  LineageKeyVersionSchema,
  LineageListResponseSchema,
  VerifyLineageArtifactsInputSchema,
  VerifyLineageArtifactsResponseSchema,
  LineageLookupQuerySchema,
  IssueLineageInputSchema,
  RevokeLineageInputSchema,
  RotateLineageKeyVersionInputSchema,
  UpdateExportJobInputSchema,
  MemberSchema,
  MemberProjectAssignmentSchema,
  OrganizationSchema,
  OrganizationSummarySchema,
  PromptBatchReviewInputSchema,
  PromptBatchReviewResultSchema,
  PromptInspectionQuerySchema,
  PromptInspectionSchema,
  PromptInspectionSummaryQuerySchema,
  PromptInspectionSummarySchema,
  SelfServeVirtualKeyBootstrapSchema,
  IssueSelfServeVirtualKeyInputSchema,
  PromptReviewInputSchema,
  PromptPolicySchema,
  ProjectSchema,
  ProviderConnectionSchema,
  ProviderConnectionModelCatalogSchema,
  ProviderConnectionTestResponseSchema,
  SavedViewListQuerySchema,
  SavedViewSchema,
  ScheduledReportListQuerySchema,
  ScheduledReportSchema,
  UpdateBudgetPolicyInputSchema,
  UpdateScheduledReportInputSchema,
  UpdateAlertInputSchema,
  UpdateEnvironmentInputSchema,
  UpdateMemberInputSchema,
  UpdateOrganizationInputSchema,
  UpdatePromptPolicyInputSchema,
  UpdateProjectInputSchema,
  UpdateProviderConnectionInputSchema,
  UpdateWorkspaceInputSchema,
  UsageEventSchema,
  UsageEventDailyResponseSchema,
  UsageEventSummarySchema,
  WorkspaceHomeSnapshotSchema,
  WorkspaceHomeOverviewSchema,
  WorkspaceSetupSummarySchema,
  VirtualKeyListResponseSchema,
  VirtualKeyInventorySummarySchema,
  VirtualKeySchema,
  WorkspaceSchema,
  WorkspaceOptionSchema,
  type Alert,
  type AlertQuery,
  type AuditLog,
  type BudgetPolicy,
  type BudgetPolicySummary,
  type CreateBudgetPolicyInput,
  type CreateEnvironmentInput,
  type CreateExportJobInput,
  type CreateScheduledReportInput,
  type CreateProviderConnectionInput,
  type CreateOrganizationInput,
  type CreateMemberInput,
  type CreateProjectInput,
  type CreateVirtualKeyInput,
  type CreateWorkspaceInput,
  type Environment,
  type ExportJob,
  type AttestationBundle,
  type BuildDescriptorResponse,
  type IssueLineageInput,
  type LineageIssuance,
  type LineageKeyVersion,
  type LineageListResponse,
  type LineageLookupQuery,
  type RevokeLineageInput,
  type RotateLineageKeyVersionInput,
  type VerifyLineageArtifactsInput,
  type VerifyLineageArtifactsResponse,
  type UpdateExportJobInput,
  type Member,
  type MemberProjectAssignment,
  type Organization,
  type OrganizationSummary,
  type PromptBatchReviewInput,
  type PromptBatchReviewResult,
  type PromptInspection,
  type PromptInspectionSort,
  type PromptInspectionSummary,
  type SelfServeVirtualKeyBootstrap,
  type IssueSelfServeVirtualKeyInput,
  type PromptPolicy,
  type Project,
  type ProviderConnection,
  type ProviderConnectionModelCatalog,
  type ProviderConnectionTestResponse,
  type SavedView,
  type SavedViewSurface,
  type ScheduledReport,
  type UpdateScheduledReportInput,
  type UpdateBudgetPolicyInput,
  type UpdateAlertInput,
  type UpdateEnvironmentInput,
  type UpdateMemberInput,
  type UpdateOrganizationInput,
  type UpdatePromptPolicyInput,
  type UpdateProjectInput,
  type UpdateWorkspaceGuidePreferenceInput,
  type PromptReviewInput,
  type UpdateProviderConnectionInput,
  type UpdateWorkspaceInput,
  type UsageEvent,
  type UsageEventSummary,
  type UsageForecastDaily,
  type WorkspaceHomeSnapshot,
  type WorkspaceHomeOverview,
  type WorkspaceSetupSummary,
  type VirtualKey,
  type VirtualKeyInventorySummary,
  type VirtualKeyListResponse,
  type Workspace,
  type WorkspaceOption,
  type AuthSession,
  type WorkspaceHomeOverviewPermissionSummary,
  type ReplaceMemberProjectAssignmentsInput,
} from "@teamops/contracts";
import { getUserErrorMessage } from "./user-facing-error";

import { controlPlaneSessionCookieName, getWebAdminAuthMode } from "./control-plane-auth";
import type { AppLocale } from "./i18n";
import { getCurrentRequestTrace } from "./request-trace";
import { isWorkspacePreferenceValueUuid, normalizeWorkspacePreferenceValue } from "./workspace-preference";
import { AuthIdentityOptionSchema, type AuthIdentityOption } from "./auth-identities";

export type ControlApiIssueKind =
  | "missing-auth"
  | "missing-route"
  | "missing-table"
  | "invalid-selection"
  | "unavailable"
  | "unexpected";

export type ControlApiIssueResource =
  | "workspace-selection"
  | "workspace-options"
  | "saved_views"
  | "scheduled_reports"
  | "control-api";

export type WorkspaceSelectionStatus =
  | "selected"
  | "needs-selection"
  | "missing"
  | "invalid"
  | "unavailable";

export type ControlApiIssue = {
  kind: ControlApiIssueKind;
  resource: ControlApiIssueResource;
  message: string;
  path: string;
  status: number | null;
};

export type WorkspaceSelectionState = {
  workspaceOptions: WorkspaceOption[];
  selectedWorkspaceId: string | null;
  selectionStatus: WorkspaceSelectionStatus;
  requestedWorkspaceId: string | null;
  issue: ControlApiIssue | null;
};

export type WorkspaceScopedLoadResult<T> =
  | {
      ok: true;
      data: T;
    }
  | {
      ok: false;
      error: unknown;
    };

export type OptionalListState<T> = {
  items: T[];
  issue: ControlApiIssue | null;
};

class ControlApiRequestError extends Error {
  readonly path: string;
  readonly status: number | null;
  readonly errorCode: string | null;
  readonly errorResource: string | null;
  readonly requestId: string | null;
  readonly correlationId: string | null;
  readonly sourceRequestId: string | null;

  constructor(
    message: string,
    args: {
      path: string;
      status: number | null;
      errorCode?: string | null;
      errorResource?: string | null;
      requestId?: string | null;
      correlationId?: string | null;
      sourceRequestId?: string | null;
      cause?: unknown;
    },
  ) {
    super(message, args.cause ? { cause: args.cause } : undefined);
    this.name = "ControlApiRequestError";
    this.path = args.path;
    this.status = args.status;
    this.errorCode = args.errorCode ?? null;
    this.errorResource = args.errorResource ?? null;
    this.requestId = args.requestId ?? null;
    this.correlationId = args.correlationId ?? null;
    this.sourceRequestId = args.sourceRequestId ?? null;
  }
}

export function getControlApiBaseUrl() {
  return process.env.CONTROL_API_BASE_URL ?? process.env.NEXT_PUBLIC_CONTROL_API_BASE_URL ?? "http://127.0.0.1:4001";
}

export function getGatewayBaseUrl() {
  return process.env.GATEWAY_PUBLIC_BASE_URL ?? "http://127.0.0.1:4002";
}

function getControlApiAdminToken() {
  return process.env.CONTROL_API_ADMIN_TOKEN?.trim() || null;
}

function getControlApiMemberEmail() {
  return process.env.CONTROL_API_MEMBER_EMAIL?.trim().toLowerCase() || null;
}

function allowLocalControlApiAuthFallback() {
  return process.env.NODE_ENV !== "production";
}

async function getControlPlaneSessionHandle() {
  const cookieStore = await cookies();
  return cookieStore.get(controlPlaneSessionCookieName)?.value?.trim() || null;
}

function getTrimmedHeaderValue(headers: Headers, name: string) {
  const value = headers.get(name)?.trim();
  return value || null;
}

function getSessionHandleFromCookieHeader(cookieHeader: string | null | undefined) {
  if (!cookieHeader) {
    return null;
  }

  const match = cookieHeader.match(
    new RegExp(`(?:^|;\\s*)${controlPlaneSessionCookieName}=([^;]+)`),
  );
  if (!match?.[1]) {
    return null;
  }

  try {
    return decodeURIComponent(match[1]).trim() || null;
  } catch {
    return match[1].trim() || null;
  }
}

function getRequestTraceFromHeaders(headers: Headers) {
  const currentTrace = getCurrentRequestTrace();
  const sourceRequestId =
    getTrimmedHeaderValue(headers, "x-source-request-id") ??
    currentTrace?.sourceRequestId ??
    `web-admin_${randomUUID()}`;
  const correlationId =
    getTrimmedHeaderValue(headers, "x-correlation-id") ??
    currentTrace?.correlationId ??
    sourceRequestId;

  return {
    sourceRequestId,
    correlationId,
  };
}

export async function buildControlApiHeaders(initHeaders?: ConstructorParameters<typeof Headers>[0]) {
  const headers = new Headers(initHeaders);
  const authMode = getWebAdminAuthMode();

  if (!headers.has("x-teamops-web-admin-auth")) {
    const sessionHandle = await getControlPlaneSessionHandle();
    if (sessionHandle) {
      headers.set("x-teamops-web-admin-auth", `session ${sessionHandle}`);
    }
  }

  const hasSessionAuthHeader = headers.has("x-teamops-web-admin-auth");

  if (!hasSessionAuthHeader && authMode === "bootstrap_admin") {
    const adminToken = getControlApiAdminToken();
    if (adminToken && !headers.has("authorization")) {
      headers.set("authorization", `Bearer ${adminToken}`);
    }
  } else if (!hasSessionAuthHeader && authMode === "bootstrap_member_email") {
    const memberEmail = getControlApiMemberEmail();
    if (memberEmail && !headers.has("x-member-email")) {
      headers.set("x-member-email", memberEmail);
    }
  } else if (!hasSessionAuthHeader && allowLocalControlApiAuthFallback()) {
    const memberEmail = getControlApiMemberEmail();
    if (memberEmail && !headers.has("x-member-email")) {
      headers.set("x-member-email", memberEmail);
    } else {
      const adminToken = getControlApiAdminToken();
      if (adminToken && !headers.has("authorization")) {
        headers.set("authorization", `Bearer ${adminToken}`);
      }
    }
  }

  if (!headers.has("x-origin-service")) {
    headers.set("x-origin-service", "web-admin");
  }

  const trace = getRequestTraceFromHeaders(headers);
  headers.set("x-source-request-id", trace.sourceRequestId);
  headers.set("x-correlation-id", trace.correlationId);

  return headers;
}

export async function buildControlApiHeadersForRequest(
  request: Pick<Request, "headers">,
  initHeaders?: ConstructorParameters<typeof Headers>[0],
) {
  const headers = new Headers(initHeaders);

  if (!headers.has("x-teamops-web-admin-auth")) {
    const sessionHandle = getSessionHandleFromCookieHeader(request.headers.get("cookie"));
    if (sessionHandle) {
      headers.set("x-teamops-web-admin-auth", `session ${sessionHandle}`);
    }
  }

  if (!headers.has("authorization")) {
    const authorization = request.headers.get("authorization")?.trim();
    if (authorization) {
      headers.set("authorization", authorization);
    }
  }

  if (!headers.has("x-member-email")) {
    const memberEmail = request.headers.get("x-member-email")?.trim();
    if (memberEmail) {
      headers.set("x-member-email", memberEmail);
    }
  }

  return buildControlApiHeaders(headers);
}

function hasControlApiRequestBody(body: RequestInit["body"] | null | undefined): body is NonNullable<RequestInit["body"]> {
  return body !== undefined && body !== null;
}

function shouldSetJsonContentType(body: NonNullable<RequestInit["body"]>) {
  if (typeof body === "string") {
    return true;
  }

  return body instanceof Blob && body.type === "application/json";
}

async function buildControlApiRequestInit(init?: RequestInit): Promise<RequestInit> {
  const headers = await buildControlApiHeaders(init?.headers);
  const body = init?.body;

  if (!hasControlApiRequestBody(body)) {
    headers.delete("content-type");
  } else if (!headers.has("content-type") && shouldSetJsonContentType(body)) {
    headers.set("content-type", "application/json");
  }

  return {
    ...init,
    headers,
  };
}

function getResponseTrace(response: Response, requestHeaders: Headers) {
  return {
    requestId: response.headers.get("x-request-id")?.trim() || null,
    correlationId: response.headers.get("x-correlation-id")?.trim() || getTrimmedHeaderValue(requestHeaders, "x-correlation-id"),
    sourceRequestId:
      response.headers.get("x-source-request-id")?.trim() || getTrimmedHeaderValue(requestHeaders, "x-source-request-id"),
  };
}

function formatTraceSuffix(trace: {
  requestId?: string | null;
  correlationId?: string | null;
  sourceRequestId?: string | null;
}) {
  const parts = [
    trace.requestId ? `requestId=${trace.requestId}` : null,
    trace.correlationId ? `correlationId=${trace.correlationId}` : null,
    trace.sourceRequestId ? `sourceRequestId=${trace.sourceRequestId}` : null,
  ].filter((value): value is string => value !== null);

  return parts.length ? ` [${parts.join(", ")}]` : "";
}

async function readErrorPayload(response: Response) {
  try {
    const payload = (await response.json()) as {
      error?: {
        message?: string;
        code?: string;
        resource?: string;
      };
    };

    return {
      message: payload.error?.message ?? `Control API request failed with ${response.status}`,
      code: payload.error?.code ?? null,
      resource: payload.error?.resource ?? null,
    };
  } catch {
    return {
      message: `Control API request failed with ${response.status}`,
      code: null,
      resource: null,
    };
  }
}

export async function fetchAuthSession(): Promise<AuthSession | null> {
  const payload = await controlApiFetchOptional("/v1/auth/session");
  if (!payload) {
    return null;
  }

  return AuthSessionSchema.parse(payload);
}

export async function fetchAuthIdentityOptions(): Promise<AuthIdentityOption[]> {
  const payload = await controlApiFetch("/v1/auth/session/identities");
  return z.array(AuthIdentityOptionSchema).parse(payload);
}

export async function getWorkspaceHomeOverviewPermissions(
  workspaceId: string,
): Promise<WorkspaceHomeOverviewPermissionSummary> {
  const overview = await getWorkspaceHomeOverview(workspaceId);
  return overview.permissions;
}

export async function updateWorkspaceGuidePreference(input: UpdateWorkspaceGuidePreferenceInput) {
  const payload = await controlApiFetch("/v1/auth/session/guide-preferences", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      workspaceId: input.workspaceId,
      exited: input.exited,
    }),
  });

  const record = payload as { guideExitedWorkspaceIds?: unknown };
  return {
    guideExitedWorkspaceIds: Array.isArray(record.guideExitedWorkspaceIds)
      ? record.guideExitedWorkspaceIds.filter((value): value is string => typeof value === "string")
      : [],
  };
}

async function controlApiFetch(path: string, init?: RequestInit) {
  let response: Response;
  const requestInit = await buildControlApiRequestInit(init);
  const requestHeaders =
    requestInit.headers instanceof Headers ? requestInit.headers : await buildControlApiHeaders(requestInit.headers);
  const requestTrace = getRequestTraceFromHeaders(requestHeaders);

  try {
    response = await fetch(`${getControlApiBaseUrl()}${path}`, requestInit);
  } catch (error) {
    throw new ControlApiRequestError(
      `Unable to reach Control API at ${getControlApiBaseUrl()}${formatTraceSuffix(requestTrace)}`,
      {
        path,
        status: null,
        correlationId: requestTrace.correlationId,
        sourceRequestId: requestTrace.sourceRequestId,
        cause: error,
      },
    );
  }

  if (!response.ok) {
    const responseTrace = getResponseTrace(response, requestHeaders);
    const errorPayload = await readErrorPayload(response);
    throw new ControlApiRequestError(`${errorPayload.message}${formatTraceSuffix(responseTrace)}`, {
      path,
      status: response.status,
      errorCode: errorPayload.code,
      errorResource: errorPayload.resource,
      requestId: responseTrace.requestId,
      correlationId: responseTrace.correlationId,
      sourceRequestId: responseTrace.sourceRequestId,
    });
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

async function controlApiFetchOptional(path: string, init?: RequestInit) {
  let response: Response;
  const requestInit = await buildControlApiRequestInit(init);
  const requestHeaders =
    requestInit.headers instanceof Headers ? requestInit.headers : await buildControlApiHeaders(requestInit.headers);
  const requestTrace = getRequestTraceFromHeaders(requestHeaders);

  try {
    response = await fetch(`${getControlApiBaseUrl()}${path}`, requestInit);
  } catch (error) {
    throw new ControlApiRequestError(
      `Unable to reach Control API at ${getControlApiBaseUrl()}${formatTraceSuffix(requestTrace)}`,
      {
        path,
        status: null,
        correlationId: requestTrace.correlationId,
        sourceRequestId: requestTrace.sourceRequestId,
        cause: error,
      },
    );
  }

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const responseTrace = getResponseTrace(response, requestHeaders);
    const errorPayload = await readErrorPayload(response);
    throw new ControlApiRequestError(`${errorPayload.message}${formatTraceSuffix(responseTrace)}`, {
      path,
      status: response.status,
      errorCode: errorPayload.code,
      errorResource: errorPayload.resource,
      requestId: responseTrace.requestId,
      correlationId: responseTrace.correlationId,
      sourceRequestId: responseTrace.sourceRequestId,
    });
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

function parseListPayload<T>(payload: unknown, schema: { parse: (value: unknown) => T }) {
  const items = payload && typeof payload === "object" && "items" in payload ? (payload as { items?: unknown[] }).items : [];
  return (items ?? []).map((item) => schema.parse(item));
}

function parseUsageListPayload(payload: unknown) {
  const record = payload && typeof payload === "object" ? (payload as { items?: unknown[]; total?: unknown }) : {};
  return {
    items: (record.items ?? []).map((item) => UsageEventSchema.parse(item)),
    total: typeof record.total === "number" ? record.total : Number(record.total ?? 0),
  };
}

function parseAuditListPayload(payload: unknown) {
  const record = payload && typeof payload === "object" ? (payload as { items?: unknown[]; total?: unknown }) : {};
  return {
    items: (record.items ?? []).map((item) => AuditLogSchema.parse(item)),
    total: typeof record.total === "number" ? record.total : Number(record.total ?? 0),
  };
}

function parseVirtualKeyListPayload(payload: unknown): VirtualKeyListResponse {
  const parsed = VirtualKeyListResponseSchema.parse(payload);
  return {
    ...parsed,
    summary: VirtualKeyInventorySummarySchema.parse(parsed.summary),
  };
}

function appendQueryValue(params: URLSearchParams, key: string, value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return;
  }

  params.set(key, String(value));
}

function getCurrentMonthStartIso(now = new Date()) {
  const currentMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return currentMonthStart.toISOString();
}

function buildUnexpectedIssue(error: unknown, path: string): ControlApiIssue {
  return {
    kind: "unexpected",
    resource: "control-api",
    message: getUserErrorMessage(error, "Can't load this right now."),
    path,
    status: error instanceof ControlApiRequestError ? error.status : null,
  };
}

function buildWorkspaceSelectionIssue(
  requestedWorkspaceId: string,
  options: {
    malformed: boolean;
  },
): ControlApiIssue {
  return {
    kind: "invalid-selection",
    resource: "workspace-selection",
    message:
      options.malformed
        ? "This workspace link is invalid."
        : "This workspace is no longer available.",
    path: "/workspace-selection",
    status: options.malformed ? 400 : 404,
  };
}

export function diagnoseControlApiIssue(error: unknown): ControlApiIssue | null {
  if (!(error instanceof Error)) {
    return null;
  }

  const path = error instanceof ControlApiRequestError ? error.path : "";
  const status = error instanceof ControlApiRequestError ? error.status : null;
  const errorCode = error instanceof ControlApiRequestError ? error.errorCode : null;
  const errorResource = error instanceof ControlApiRequestError ? error.errorResource : null;
  const normalizedMessage = error.message.toLowerCase();
  const friendlyMessage = getUserErrorMessage(error, "Can't load this right now.");

  if (
    status === 401 &&
    (
      errorCode === "AUTH_REQUIRED" ||
      errorCode === "SESSION_EXPIRED" ||
      errorCode === "SESSION_REVOKED" ||
      normalizedMessage.includes("missing control api admin token or x-member-email header") ||
      normalizedMessage.includes("authentication is required")
    )
  ) {
    return {
      kind: "missing-auth",
      resource: "control-api",
      message: friendlyMessage,
      path,
      status,
    };
  }

  if (
    status === 404 &&
    (path === "/v1/workspace-options" || normalizedMessage.includes("/v1/workspace-options"))
  ) {
    return {
      kind: "missing-route",
      resource: "workspace-options",
      message: friendlyMessage,
      path: path || "/v1/workspace-options",
      status,
    };
  }

  if (errorCode === "TEAMOPS_MISSING_TABLE" && errorResource === "saved_views") {
    return {
      kind: "missing-table",
      resource: "saved_views",
      message: friendlyMessage,
      path,
      status,
    };
  }

  if (errorCode === "TEAMOPS_MISSING_TABLE" && errorResource === "scheduled_reports") {
    return {
      kind: "missing-table",
      resource: "scheduled_reports",
      message: friendlyMessage,
      path,
      status,
    };
  }

  if (normalizedMessage.includes("saved_views") && normalizedMessage.includes("does not exist")) {
    return {
      kind: "missing-table",
      resource: "saved_views",
      message: friendlyMessage,
      path,
      status,
    };
  }

  if (normalizedMessage.includes("scheduled_reports") && normalizedMessage.includes("does not exist")) {
    return {
      kind: "missing-table",
      resource: "scheduled_reports",
      message: friendlyMessage,
      path,
      status,
    };
  }

  if (
    status === null ||
    normalizedMessage.includes("unable to reach control api") ||
    normalizedMessage.includes("fetch failed") ||
    normalizedMessage.includes("econnrefused")
  ) {
    return {
      kind: "unavailable",
      resource: "control-api",
      message: friendlyMessage,
      path,
      status,
    };
  }

  if (status === 404) {
    return {
      kind: "missing-route",
      resource: "control-api",
      message: friendlyMessage,
      path,
      status,
    };
  }

  if (status !== null && status >= 500) {
    return {
      kind: "unavailable",
      resource: "control-api",
      message: friendlyMessage,
      path,
      status,
    };
  }

  if (status === 403) {
    return null;
  }

  return {
    kind: "unexpected",
    resource: "control-api",
    message: friendlyMessage,
    path,
    status,
  };
}

export function pickFirstControlApiIssue(...issues: Array<ControlApiIssue | null | undefined>) {
  return issues.find((issue) => issue !== null && issue !== undefined) ?? null;
}

export async function listOrganizations(): Promise<Organization[]> {
  const payload = await controlApiFetch("/v1/organizations");
  return parseListPayload(payload, OrganizationSchema);
}

export async function loadOrganizationsState() {
  try {
    return {
      items: await listOrganizations(),
      issue: null,
    };
  } catch (error) {
    return {
      items: [] as Organization[],
      issue: diagnoseControlApiIssue(error) ?? buildUnexpectedIssue(error, "/v1/organizations"),
    };
  }
}

export async function listOrganizationSummaries(): Promise<OrganizationSummary[]> {
  const payload = await controlApiFetch("/v1/organizations?includeWorkspaceCounts=1");
  return parseListPayload(payload, OrganizationSummarySchema);
}

export async function createOrganization(input: CreateOrganizationInput) {
  const payload = await controlApiFetch("/v1/organizations", {
    method: "POST",
    body: JSON.stringify(CreateOrganizationInputSchema.parse(input)),
  });

  return OrganizationSchema.parse(payload);
}

export async function updateOrganization(organizationId: string, input: UpdateOrganizationInput) {
  const payload = await controlApiFetch(`/v1/organizations/${organizationId}`, {
    method: "PATCH",
    body: JSON.stringify(UpdateOrganizationInputSchema.parse(input)),
  });

  return OrganizationSchema.parse(payload);
}

export async function deleteOrganization(organizationId: string) {
  await controlApiFetch(`/v1/organizations/${organizationId}`, {
    method: "DELETE",
  });
}

export async function listWorkspacesByOrganization(organizationId: string): Promise<Workspace[]> {
  const payload = await controlApiFetch(`/v1/workspaces?organizationId=${organizationId}`);
  return parseListPayload(payload, WorkspaceSchema);
}

export async function createWorkspace(input: CreateWorkspaceInput) {
  const payload = await controlApiFetch("/v1/workspaces", {
    method: "POST",
    body: JSON.stringify(CreateWorkspaceInputSchema.parse(input)),
  });

  return WorkspaceSchema.parse(payload);
}

export async function updateWorkspace(workspaceId: string, input: UpdateWorkspaceInput) {
  const payload = await controlApiFetch(`/v1/workspaces/${workspaceId}`, {
    method: "PATCH",
    body: JSON.stringify(UpdateWorkspaceInputSchema.parse(input)),
  });

  return WorkspaceSchema.parse(payload);
}

export async function deleteWorkspace(workspaceId: string) {
  await controlApiFetch(`/v1/workspaces/${workspaceId}`, {
    method: "DELETE",
  });
}

async function listWorkspaceOptionsFromWorkspaceRoute() {
  const payload = await controlApiFetch("/v1/workspace-options");
  return parseListPayload(payload, WorkspaceOptionSchema);
}

async function listWorkspaceOptionsFromLegacyRoutes() {
  const organizations = await listOrganizations();
  const workspacesByOrganization = await Promise.all(
    organizations.map(async (organization) => ({
      organizationName: organization.name,
      workspaces: await listWorkspacesByOrganization(organization.id),
    })),
  );

  return workspacesByOrganization.flatMap(({ organizationName, workspaces }) =>
    workspaces.map((workspace) =>
      WorkspaceOptionSchema.parse({
        ...workspace,
        organizationName,
      }),
    ),
  );
}

const workspaceOptionsCacheTag = "workspace-options";
const workspaceOptionsCacheKey = ["control-api", "workspace-options"];
const workspaceOptionsCacheRevalidateSeconds = 30;
const controlApiServerCacheDisabled = process.env.WEB_ADMIN_DISABLE_SERVER_CACHE === "1";

async function loadWorkspaceOptionsUncached() {
  try {
    return await listWorkspaceOptionsFromWorkspaceRoute();
  } catch (error) {
    const issue = diagnoseControlApiIssue(error);
    if (issue?.kind === "missing-route" && issue.resource === "workspace-options") {
      return listWorkspaceOptionsFromLegacyRoutes();
    }

    throw error;
  }
}

const shouldCacheWorkspaceOptions =
  process.env.NODE_ENV === "production" &&
  !controlApiServerCacheDisabled &&
  getWebAdminAuthMode() === "bootstrap_admin";

const listWorkspaceOptionsCached =
  shouldCacheWorkspaceOptions
    ? unstable_cache(loadWorkspaceOptionsUncached, workspaceOptionsCacheKey, {
        tags: [workspaceOptionsCacheTag],
        revalidate: workspaceOptionsCacheRevalidateSeconds,
      })
    : loadWorkspaceOptionsUncached;

export async function listWorkspaceOptions() {
  return listWorkspaceOptionsCached();
}

export function revalidateWorkspaceOptionsCache() {
  revalidateTag(workspaceOptionsCacheTag);
}

export async function loadWorkspaceSelection(requestedWorkspaceId?: string | null): Promise<WorkspaceSelectionState> {
  try {
    const workspaceOptions = await listWorkspaceOptions();
    const normalizedRequestedWorkspaceId = normalizeWorkspacePreferenceValue(requestedWorkspaceId);
    const defaultWorkspaceId = workspaceOptions[0]?.id ?? null;

    if (!normalizedRequestedWorkspaceId) {
      return {
        workspaceOptions,
        selectedWorkspaceId: defaultWorkspaceId,
        selectionStatus: defaultWorkspaceId ? "selected" : "missing",
        requestedWorkspaceId: null,
        issue: null,
      };
    }

    if (!isWorkspacePreferenceValueUuid(normalizedRequestedWorkspaceId)) {
      return {
        workspaceOptions,
        selectedWorkspaceId: defaultWorkspaceId,
        selectionStatus: "invalid",
        requestedWorkspaceId: normalizedRequestedWorkspaceId,
        issue: buildWorkspaceSelectionIssue(normalizedRequestedWorkspaceId, {
          malformed: true,
        }),
      };
    }

    const selectedWorkspaceId =
      workspaceOptions.find((workspace) => workspace.id === normalizedRequestedWorkspaceId)?.id ?? null;

    if (!selectedWorkspaceId) {
      return {
        workspaceOptions,
        selectedWorkspaceId: defaultWorkspaceId,
        selectionStatus: "invalid",
        requestedWorkspaceId: normalizedRequestedWorkspaceId,
        issue: buildWorkspaceSelectionIssue(normalizedRequestedWorkspaceId, {
          malformed: false,
        }),
      };
    }

    return {
      workspaceOptions,
      selectedWorkspaceId,
      selectionStatus: "selected",
      requestedWorkspaceId: normalizedRequestedWorkspaceId,
      issue: null,
    };
  } catch (error) {
    return {
      workspaceOptions: [],
      selectedWorkspaceId: null,
      selectionStatus: "unavailable",
      requestedWorkspaceId: normalizeWorkspacePreferenceValue(requestedWorkspaceId),
      issue: diagnoseControlApiIssue(error) ?? buildUnexpectedIssue(error, "/v1/workspace-options"),
    };
  }
}

export async function resolveOrganizationSelection(requestedOrganizationId?: string | null) {
  const { items: organizations } = await loadOrganizationsState();
  const selectedOrganizationId =
    requestedOrganizationId && organizations.some((organization) => organization.id === requestedOrganizationId)
      ? requestedOrganizationId
      : organizations[0]?.id ?? null;

  return {
    organizations,
    selectedOrganizationId,
  };
}

export async function resolveWorkspaceSelection(requestedWorkspaceId?: string | null) {
  const { workspaceOptions, selectedWorkspaceId, selectionStatus, requestedWorkspaceId: normalizedRequestedWorkspaceId, issue } =
    await loadWorkspaceSelection(requestedWorkspaceId);
  return {
    workspaceOptions,
    selectedWorkspaceId,
    selectionStatus,
    requestedWorkspaceId: normalizedRequestedWorkspaceId,
    issue,
  };
}

async function loadWorkspaceScopedResult<T>(
  workspaceId: string,
  load: (workspaceId: string) => Promise<T>,
): Promise<WorkspaceScopedLoadResult<T>> {
  try {
    return {
      ok: true,
      data: await load(workspaceId),
    };
  } catch (error) {
    return {
      ok: false,
      error,
    };
  }
}

export async function loadWorkspaceSelectionWithOptimisticData<T>(
  requestedWorkspaceId: string | null | undefined,
  load: (workspaceId: string) => Promise<T>,
): Promise<WorkspaceSelectionState & { dataResult: WorkspaceScopedLoadResult<T> | null }> {
  const normalizedRequestedWorkspaceId = normalizeWorkspacePreferenceValue(requestedWorkspaceId);
  const optimisticWorkspaceId =
    normalizedRequestedWorkspaceId && isWorkspacePreferenceValueUuid(normalizedRequestedWorkspaceId)
      ? normalizedRequestedWorkspaceId
      : null;
  const optimisticResultPromise = optimisticWorkspaceId
    ? loadWorkspaceScopedResult(optimisticWorkspaceId, load)
    : null;
  const selection = await loadWorkspaceSelection(normalizedRequestedWorkspaceId);

  if (!selection.selectedWorkspaceId) {
    return {
      ...selection,
      dataResult: null,
    };
  }

  if (optimisticWorkspaceId && optimisticWorkspaceId === selection.selectedWorkspaceId && optimisticResultPromise) {
    return {
      ...selection,
      dataResult: await optimisticResultPromise,
    };
  }

  return {
    ...selection,
    dataResult: await loadWorkspaceScopedResult(selection.selectedWorkspaceId, load),
  };
}

export async function getWorkspaceHomeOverview(workspaceId: string): Promise<WorkspaceHomeOverview> {
  const payload = await controlApiFetch(`/v1/workspaces/${workspaceId}/home-overview`);
  return WorkspaceHomeOverviewSchema.parse(payload);
}

export async function getWorkspaceHomeSnapshot(workspaceId: string): Promise<WorkspaceHomeSnapshot> {
  const payload = await controlApiFetch(`/v1/workspaces/${workspaceId}/home-snapshot`);
  return WorkspaceHomeSnapshotSchema.parse(payload);
}

export async function getWorkspaceSetupSummary(workspaceId: string): Promise<WorkspaceSetupSummary> {
  const payload = await controlApiFetch(`/v1/workspaces/${workspaceId}/setup-summary`);
  return WorkspaceSetupSummarySchema.parse(payload);
}

export async function listProjects(workspaceId: string): Promise<Project[]> {
  const payload = await controlApiFetch(`/v1/projects?workspaceId=${workspaceId}`);
  return parseListPayload(payload, ProjectSchema);
}

export async function listEnvironments(projectId: string): Promise<Environment[]> {
  const payload = await controlApiFetch(`/v1/environments?projectId=${projectId}`);
  return parseListPayload(payload, EnvironmentSchema);
}

export async function listWorkspaceEnvironments(workspaceId: string) {
  const payload = await controlApiFetch(`/v1/environments?workspaceId=${workspaceId}`);
  return parseListPayload(payload, EnvironmentSchema);
}

export async function listMembers(workspaceId: string): Promise<Member[]> {
  const payload = await controlApiFetch(`/v1/members?workspaceId=${workspaceId}`);
  return parseListPayload(payload, MemberSchema);
}

export async function listMemberProjectAssignments(workspaceId: string): Promise<MemberProjectAssignment[]> {
  const payload = await controlApiFetch(`/v1/member-project-assignments?workspaceId=${workspaceId}`);
  return parseListPayload(payload, MemberProjectAssignmentSchema);
}

export async function createProject(input: CreateProjectInput) {
  const payload = await controlApiFetch("/v1/projects", {
    method: "POST",
    body: JSON.stringify(CreateProjectInputSchema.parse(input)),
  });

  return ProjectSchema.parse(payload);
}

export async function updateProject(projectId: string, input: UpdateProjectInput) {
  const payload = await controlApiFetch(`/v1/projects/${projectId}`, {
    method: "PATCH",
    body: JSON.stringify(UpdateProjectInputSchema.parse(input)),
  });

  return ProjectSchema.parse(payload);
}

export async function archiveProject(projectId: string) {
  await controlApiFetch(`/v1/projects/${projectId}`, {
    method: "DELETE",
  });
}

export async function createEnvironment(input: CreateEnvironmentInput) {
  const payload = await controlApiFetch("/v1/environments", {
    method: "POST",
    body: JSON.stringify(CreateEnvironmentInputSchema.parse(input)),
  });

  return EnvironmentSchema.parse(payload);
}

export async function updateEnvironment(environmentId: string, input: UpdateEnvironmentInput) {
  const payload = await controlApiFetch(`/v1/environments/${environmentId}`, {
    method: "PATCH",
    body: JSON.stringify(UpdateEnvironmentInputSchema.parse(input)),
  });

  return EnvironmentSchema.parse(payload);
}

export async function archiveEnvironment(environmentId: string) {
  await controlApiFetch(`/v1/environments/${environmentId}`, {
    method: "DELETE",
  });
}

export async function createMember(input: CreateMemberInput) {
  const payload = await controlApiFetch("/v1/members", {
    method: "POST",
    body: JSON.stringify(CreateMemberInputSchema.parse(input)),
  });

  return MemberSchema.parse(payload);
}

export async function updateMember(memberId: string, input: UpdateMemberInput) {
  const payload = await controlApiFetch(`/v1/members/${memberId}`, {
    method: "PATCH",
    body: JSON.stringify(UpdateMemberInputSchema.parse(input)),
  });

  return MemberSchema.parse(payload);
}

export async function deleteMember(memberId: string) {
  await controlApiFetch(`/v1/members/${memberId}`, {
    method: "DELETE",
  });
}

export async function replaceMemberProjectAssignments(
  memberId: string,
  input: ReplaceMemberProjectAssignmentsInput,
) {
  const payload = await controlApiFetch(`/v1/members/${memberId}/project-assignments`, {
    method: "PUT",
    body: JSON.stringify(ReplaceMemberProjectAssignmentsInputSchema.parse(input)),
  });

  return payload as {
    memberId: string;
    projectIds: string[];
  };
}

export async function listProviderConnections(workspaceId: string): Promise<ProviderConnection[]> {
  const payload = await controlApiFetch(`/v1/provider-connections?workspaceId=${workspaceId}`);
  return parseListPayload(payload, ProviderConnectionSchema);
}

export async function createProviderConnection(input: CreateProviderConnectionInput) {
  const payload = await controlApiFetch("/v1/provider-connections", {
    method: "POST",
    body: JSON.stringify(CreateProviderConnectionInputSchema.parse(input)),
  });

  return ProviderConnectionSchema.parse(payload);
}

export async function updateProviderConnection(
  workspaceId: string,
  providerConnectionId: string,
  input: UpdateProviderConnectionInput,
) {
  const payload = await controlApiFetch(
    `/v1/provider-connections/${providerConnectionId}?workspaceId=${encodeURIComponent(workspaceId)}`,
    {
    method: "PATCH",
    body: JSON.stringify(UpdateProviderConnectionInputSchema.parse(input)),
    },
  );

  return ProviderConnectionSchema.parse(payload);
}

export async function testProviderConnection(
  workspaceId: string,
  providerConnectionId: string,
): Promise<ProviderConnectionTestResponse> {
  const payload = await controlApiFetch(
    `/v1/provider-connections/${providerConnectionId}/test?workspaceId=${encodeURIComponent(workspaceId)}`,
    {
      method: "POST",
    },
  );

  return ProviderConnectionTestResponseSchema.parse(payload);
}

export async function testProviderConnectionDraft(
  input: CreateProviderConnectionInput,
): Promise<ProviderConnectionTestResponse> {
  const payload = await controlApiFetch("/v1/provider-connections/test", {
    method: "POST",
    body: JSON.stringify(CreateProviderConnectionInputSchema.parse(input)),
  });

  return ProviderConnectionTestResponseSchema.parse(payload);
}

export async function fetchProviderConnectionModelCatalog(
  workspaceId: string,
  providerConnectionId: string,
): Promise<ProviderConnectionModelCatalog> {
  const payload = await controlApiFetch(
    `/v1/provider-connections/${providerConnectionId}/models?workspaceId=${encodeURIComponent(workspaceId)}`,
  );

  return ProviderConnectionModelCatalogSchema.parse(payload);
}

export async function fetchProviderConnectionModelCatalogPreview(
  input: CreateProviderConnectionInput,
): Promise<ProviderConnectionModelCatalog> {
  const payload = await controlApiFetch("/v1/provider-connections/models/preview", {
    method: "POST",
    body: JSON.stringify(CreateProviderConnectionInputSchema.parse(input)),
  });

  return ProviderConnectionModelCatalogSchema.parse(payload);
}

export async function revokeProviderConnection(workspaceId: string, providerConnectionId: string) {
  const payload = await controlApiFetch(
    `/v1/provider-connections/${providerConnectionId}/revoke?workspaceId=${encodeURIComponent(workspaceId)}`,
    {
      method: "POST",
    },
  );

  return ProviderConnectionSchema.parse(payload);
}

export async function listVirtualKeys(
  workspaceId: string,
  options?: {
    limit?: number;
    offset?: number;
  },
): Promise<VirtualKeyListResponse> {
  const params = new URLSearchParams();
  appendQueryValue(params, "workspaceId", workspaceId);
  appendQueryValue(params, "limit", options?.limit ?? 50);
  appendQueryValue(params, "offset", options?.offset ?? 0);

  const payload = await controlApiFetch(`/v1/virtual-keys?${params.toString()}`);
  return parseVirtualKeyListPayload(payload);
}

export async function createVirtualKey(input: CreateVirtualKeyInput) {
  const payload = await controlApiFetch("/v1/virtual-keys", {
    method: "POST",
    body: JSON.stringify(CreateVirtualKeyInputSchema.parse(input)),
  });

  return CreatedVirtualKeyResponseSchema.parse(payload);
}

export async function revokeVirtualKey(virtualKeyId: string) {
  const payload = await controlApiFetch(`/v1/virtual-keys/${virtualKeyId}/revoke`, {
    method: "POST",
  });

  return VirtualKeySchema.parse(payload);
}

export async function rotateVirtualKey(virtualKeyId: string) {
  const payload = await controlApiFetch(`/v1/virtual-keys/${virtualKeyId}/rotate`, {
    method: "POST",
  });

  return CreatedVirtualKeyResponseSchema.parse(payload);
}

export async function getSelfServeVirtualKeyBootstrap(workspaceId: string): Promise<SelfServeVirtualKeyBootstrap> {
  const payload = await controlApiFetch(`/v1/workspaces/${workspaceId}/self-serve-virtual-keys/bootstrap`);
  return SelfServeVirtualKeyBootstrapSchema.parse(payload);
}

export async function issueSelfServeVirtualKey(
  workspaceId: string,
  input: IssueSelfServeVirtualKeyInput,
) {
  const payload = await controlApiFetch(`/v1/workspaces/${workspaceId}/self-serve-virtual-keys/issue`, {
    method: "POST",
    body: JSON.stringify(IssueSelfServeVirtualKeyInputSchema.parse(input)),
  });

  return CreatedVirtualKeyResponseSchema.parse(payload);
}

export async function rotateSelfServeVirtualKey(workspaceId: string, virtualKeyId: string) {
  const payload = await controlApiFetch(
    `/v1/workspaces/${workspaceId}/self-serve-virtual-keys/${virtualKeyId}/rotate`,
    {
      method: "POST",
    },
  );

  return CreatedVirtualKeyResponseSchema.parse(payload);
}

export async function revokeSelfServeVirtualKey(workspaceId: string, virtualKeyId: string) {
  const payload = await controlApiFetch(
    `/v1/workspaces/${workspaceId}/self-serve-virtual-keys/${virtualKeyId}/revoke`,
    {
      method: "POST",
    },
  );

  return VirtualKeySchema.parse(payload);
}

export async function listUsageEvents(
  workspaceId?: string | null,
  options?: {
    projectId?: string | null;
    environmentId?: string | null;
    virtualKeyId?: string | null;
    providerConnectionId?: string | null;
    budgetPolicyId?: string | null;
    limit?: number;
    offset?: number;
    status?: UsageEvent["status"];
    statusGroup?: "attention";
    minLatencyMs?: number | null;
    sortBy?: "newest" | "oldest" | "latency_desc" | "cost_desc" | "tokens_desc";
    provider?: ProviderConnection["provider"];
    model?: string | null;
    requestId?: string | null;
    providerRequestId?: string | null;
    surface?: "metadata" | "streamed" | "interrupted";
    from?: string | null;
    to?: string | null;
  },
) {
  const searchParams = new URLSearchParams();
  appendQueryValue(searchParams, "workspaceId", workspaceId);
  appendQueryValue(searchParams, "projectId", options?.projectId);
  appendQueryValue(searchParams, "environmentId", options?.environmentId);
  appendQueryValue(searchParams, "virtualKeyId", options?.virtualKeyId);
  appendQueryValue(searchParams, "providerConnectionId", options?.providerConnectionId);
  appendQueryValue(searchParams, "budgetPolicyId", options?.budgetPolicyId);
  appendQueryValue(searchParams, "provider", options?.provider);
  appendQueryValue(searchParams, "model", options?.model);
  appendQueryValue(searchParams, "requestId", options?.requestId);
  appendQueryValue(searchParams, "providerRequestId", options?.providerRequestId);
  appendQueryValue(searchParams, "status", options?.status);
  appendQueryValue(searchParams, "statusGroup", options?.statusGroup);
  appendQueryValue(searchParams, "surface", options?.surface);
  appendQueryValue(searchParams, "minLatencyMs", options?.minLatencyMs ?? undefined);
  appendQueryValue(searchParams, "sortBy", options?.sortBy);
  appendQueryValue(searchParams, "from", options?.from);
  appendQueryValue(searchParams, "to", options?.to);
  appendQueryValue(searchParams, "limit", options?.limit ?? 25);
  appendQueryValue(searchParams, "offset", options?.offset ?? 0);

  const payload = await controlApiFetch(`/v1/usage-events?${searchParams.toString()}`);
  return parseUsageListPayload(payload);
}

export async function getUsageEventSummary(filters: {
  workspaceId?: string | null;
  projectId?: string | null;
  environmentId?: string | null;
  virtualKeyId?: string | null;
  providerConnectionId?: string | null;
  budgetPolicyId?: string | null;
  provider?: ProviderConnection["provider"] | null;
  model?: string | null;
  requestId?: string | null;
  providerRequestId?: string | null;
  status?: UsageEvent["status"] | null;
  statusGroup?: "attention" | null;
  surface?: "metadata" | "streamed" | "interrupted" | null;
  minLatencyMs?: number | null;
  from?: string | null;
  to?: string | null;
}) {
  const params = new URLSearchParams();
  appendQueryValue(params, "workspaceId", filters.workspaceId);
  appendQueryValue(params, "projectId", filters.projectId);
  appendQueryValue(params, "environmentId", filters.environmentId);
  appendQueryValue(params, "virtualKeyId", filters.virtualKeyId);
  appendQueryValue(params, "providerConnectionId", filters.providerConnectionId);
  appendQueryValue(params, "budgetPolicyId", filters.budgetPolicyId);
  appendQueryValue(params, "provider", filters.provider);
  appendQueryValue(params, "model", filters.model);
  appendQueryValue(params, "requestId", filters.requestId);
  appendQueryValue(params, "providerRequestId", filters.providerRequestId);
  appendQueryValue(params, "status", filters.status);
  appendQueryValue(params, "statusGroup", filters.statusGroup);
  appendQueryValue(params, "surface", filters.surface);
  appendQueryValue(params, "minLatencyMs", filters.minLatencyMs ?? undefined);
  appendQueryValue(params, "from", filters.from);
  appendQueryValue(params, "to", filters.to);

  const payload = await controlApiFetch(`/v1/usage-events/summary?${params.toString()}`);
  return UsageEventSummarySchema.parse(payload);
}

export type UsageEventDailyFilters = {
  workspaceId?: string | null;
  projectId?: string | null;
  environmentId?: string | null;
  window?: "7" | "30" | null;
};

export async function getUsageEventDaily(filters: UsageEventDailyFilters) {
  const params = new URLSearchParams();
  appendQueryValue(params, "workspaceId", filters.workspaceId);
  appendQueryValue(params, "projectId", filters.projectId);
  appendQueryValue(params, "environmentId", filters.environmentId);
  appendQueryValue(params, "window", filters.window);

  const query = params.toString();
  const payload = await controlApiFetch(`/v1/usage-events/daily${query ? `?${query}` : ""}`);
  return UsageEventDailyResponseSchema.parse(payload);
}

export async function getUsageEvent(usageEventId: string) {
  const payload = await controlApiFetchOptional(`/v1/usage-events/${usageEventId}`);
  return payload ? UsageEventSchema.parse(payload) : null;
}

export async function getPromptPolicy(workspaceId: string) {
  const payload = await controlApiFetch(`/v1/workspaces/${workspaceId}/prompt-policy`);
  return PromptPolicySchema.parse(payload);
}

export async function updatePromptPolicy(workspaceId: string, input: UpdatePromptPolicyInput) {
  const payload = await controlApiFetch(`/v1/workspaces/${workspaceId}/prompt-policy`, {
    method: "PATCH",
    body: JSON.stringify(UpdatePromptPolicyInputSchema.parse(input)),
  });

  return PromptPolicySchema.parse(payload);
}

export async function listPromptInspections(
  filters: {
    workspaceId?: string | null;
    projectId?: string | null;
    environmentId?: string | null;
    virtualKeyId?: string | null;
    providerConnectionId?: string | null;
    usageEventId?: string | null;
    requestId?: string | null;
    provider?: ProviderConnection["provider"] | null;
    model?: string | null;
    verdict?: PromptInspection["verdict"] | null;
    reviewStatus?: PromptInspection["reviewStatus"] | null;
    riskCategory?: PromptInspection["riskCategories"][number] | null;
    activityLabel?: PromptInspection["topActivityLabel"] | null;
    escalatedOnly?: boolean | null;
    sortBy?: PromptInspectionSort | null;
    from?: string | null;
    to?: string | null;
    limit?: number;
    offset?: number;
  },
) {
  const normalizedFilters = Object.fromEntries(
    Object.entries({
      ...filters,
      limit: filters.limit ?? 25,
      offset: filters.offset ?? 0,
    }).filter(([, value]) => value !== null),
  );
  const query = PromptInspectionQuerySchema.parse(normalizedFilters);
  const params = new URLSearchParams();
  appendQueryValue(params, "workspaceId", query.workspaceId);
  appendQueryValue(params, "projectId", query.projectId);
  appendQueryValue(params, "environmentId", query.environmentId);
  appendQueryValue(params, "virtualKeyId", query.virtualKeyId);
  appendQueryValue(params, "providerConnectionId", query.providerConnectionId);
  appendQueryValue(params, "usageEventId", query.usageEventId);
  appendQueryValue(params, "requestId", query.requestId);
  appendQueryValue(params, "provider", query.provider);
  appendQueryValue(params, "model", query.model);
  appendQueryValue(params, "verdict", query.verdict);
  appendQueryValue(params, "reviewStatus", query.reviewStatus);
  appendQueryValue(params, "riskCategory", query.riskCategory);
  appendQueryValue(params, "activityLabel", query.activityLabel);
  appendQueryValue(params, "escalatedOnly", query.escalatedOnly ? "true" : undefined);
  appendQueryValue(params, "sortBy", query.sortBy);
  appendQueryValue(params, "from", filters.from);
  appendQueryValue(params, "to", filters.to);
  appendQueryValue(params, "limit", query.limit);
  appendQueryValue(params, "offset", query.offset);

  const payload = await controlApiFetch(`/v1/prompt-inspections?${params.toString()}`);
  const record =
    payload && typeof payload === "object" ? (payload as { items?: unknown[]; total?: unknown }) : {};
  return {
    items: (record.items ?? []).map((item) => PromptInspectionSchema.parse(item)),
    total: typeof record.total === "number" ? record.total : Number(record.total ?? 0),
  };
}

export async function getPromptInspectionSummary(filters: {
  workspaceId?: string | null;
  projectId?: string | null;
  environmentId?: string | null;
  virtualKeyId?: string | null;
  providerConnectionId?: string | null;
  usageEventId?: string | null;
  requestId?: string | null;
  provider?: ProviderConnection["provider"] | null;
  model?: string | null;
  verdict?: PromptInspection["verdict"] | null;
  reviewStatus?: PromptInspection["reviewStatus"] | null;
  riskCategory?: PromptInspection["riskCategories"][number] | null;
  activityLabel?: PromptInspection["topActivityLabel"] | null;
  escalatedOnly?: boolean | null;
  sortBy?: PromptInspectionSort | null;
  from?: string | null;
  to?: string | null;
}) {
  const normalizedFilters = Object.fromEntries(
    Object.entries(filters).filter(([, value]) => value !== null),
  );
  const query = PromptInspectionSummaryQuerySchema.parse(normalizedFilters);
  const params = new URLSearchParams();
  appendQueryValue(params, "workspaceId", query.workspaceId);
  appendQueryValue(params, "projectId", query.projectId);
  appendQueryValue(params, "environmentId", query.environmentId);
  appendQueryValue(params, "virtualKeyId", query.virtualKeyId);
  appendQueryValue(params, "providerConnectionId", query.providerConnectionId);
  appendQueryValue(params, "usageEventId", query.usageEventId);
  appendQueryValue(params, "requestId", query.requestId);
  appendQueryValue(params, "provider", query.provider);
  appendQueryValue(params, "model", query.model);
  appendQueryValue(params, "verdict", query.verdict);
  appendQueryValue(params, "reviewStatus", query.reviewStatus);
  appendQueryValue(params, "riskCategory", query.riskCategory);
  appendQueryValue(params, "activityLabel", query.activityLabel);
  appendQueryValue(params, "escalatedOnly", query.escalatedOnly ? "true" : undefined);
  appendQueryValue(params, "sortBy", query.sortBy);
  appendQueryValue(params, "from", filters.from);
  appendQueryValue(params, "to", filters.to);

  const payload = await controlApiFetch(`/v1/prompt-inspections/summary?${params.toString()}`);
  return PromptInspectionSummarySchema.parse(payload);
}

export async function getPromptInspection(promptInspectionId: string) {
  const payload = await controlApiFetchOptional(`/v1/prompt-inspections/${promptInspectionId}`);
  return payload ? PromptInspectionSchema.parse(payload) : null;
}

export async function reviewPromptInspection(promptInspectionId: string, input: PromptReviewInput) {
  const payload = await controlApiFetch(`/v1/prompt-inspections/${promptInspectionId}/review`, {
    method: "PATCH",
    body: JSON.stringify(PromptReviewInputSchema.parse(input)),
  });

  return PromptInspectionSchema.parse(payload);
}

export async function batchReviewPromptInspections(input: PromptBatchReviewInput) {
  const payload = await controlApiFetch("/v1/prompt-inspections/batch-review", {
    method: "POST",
    body: JSON.stringify(PromptBatchReviewInputSchema.parse(input)),
  });

  return PromptBatchReviewResultSchema.parse(payload);
}

export async function listAuditLogs(filters: {
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
  limit?: number;
  offset?: number;
}) {
  const params = new URLSearchParams();
  appendQueryValue(params, "workspaceId", filters.workspaceId);
  appendQueryValue(params, "projectId", filters.projectId);
  appendQueryValue(params, "environmentId", filters.environmentId);
  appendQueryValue(params, "actorType", filters.actorType);
  appendQueryValue(params, "actorId", filters.actorId);
  appendQueryValue(params, "action", filters.action);
  appendQueryValue(params, "subjectType", filters.subjectType);
  appendQueryValue(params, "subjectId", filters.subjectId);
  appendQueryValue(params, "from", filters.from);
  appendQueryValue(params, "to", filters.to);
  appendQueryValue(params, "limit", filters.limit ?? 50);
  appendQueryValue(params, "offset", filters.offset ?? 0);

  const query = params.toString();
  const payload = await controlApiFetch(`/v1/audit-logs${query ? `?${query}` : ""}`);
  return parseAuditListPayload(payload);
}

export async function listSavedViews(workspaceId: string, surface: SavedViewSurface): Promise<SavedView[]> {
  const params = SavedViewListQuerySchema.parse({
    workspaceId,
    surface,
  });
  const payload = await controlApiFetch(`/v1/saved-views?${new URLSearchParams(params).toString()}`);
  return parseListPayload(payload, SavedViewSchema);
}

export async function loadSavedViewsState(
  workspaceId: string,
  surface: SavedViewSurface,
): Promise<OptionalListState<SavedView>> {
  try {
    return {
      items: await listSavedViews(workspaceId, surface),
      issue: null,
    };
  } catch (error) {
    return {
      items: [],
      issue: diagnoseControlApiIssue(error) ?? buildUnexpectedIssue(error, "/v1/saved-views"),
    };
  }
}

export async function createSavedView(input: {
  workspaceId: string;
  surface: SavedViewSurface;
  name: string;
  filters: Record<string, unknown>;
}) {
  const payload = await controlApiFetch("/v1/saved-views", {
    method: "POST",
    body: JSON.stringify({
      workspaceId: input.workspaceId,
      surface: input.surface,
      name: input.name,
      filters: input.filters,
    }),
  });

  return SavedViewSchema.parse(payload);
}

export async function deleteSavedView(savedViewId: string) {
  await controlApiFetch(`/v1/saved-views/${savedViewId}`, {
    method: "DELETE",
  });
}

export async function updateSavedView(
  savedViewId: string,
  input: {
    name?: string;
    filters?: Record<string, unknown>;
  },
) {
  const payload = await controlApiFetch(`/v1/saved-views/${savedViewId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });

  return SavedViewSchema.parse(payload);
}

export async function markSavedViewOpened(savedViewId: string) {
  const payload = await controlApiFetch(`/v1/saved-views/${savedViewId}/open`, {
    method: "POST",
  });

  return SavedViewSchema.parse(payload);
}

export async function listScheduledReports(workspaceId: string): Promise<ScheduledReport[]> {
  const params = ScheduledReportListQuerySchema.parse({
    workspaceId,
  });
  const payload = await controlApiFetch(`/v1/scheduled-reports?${new URLSearchParams(params).toString()}`);
  return parseListPayload(payload, ScheduledReportSchema);
}

export async function loadScheduledReportsState(workspaceId: string): Promise<OptionalListState<ScheduledReport>> {
  try {
    return {
      items: await listScheduledReports(workspaceId),
      issue: null,
    };
  } catch (error) {
    return {
      items: [],
      issue: diagnoseControlApiIssue(error) ?? buildUnexpectedIssue(error, "/v1/scheduled-reports"),
    };
  }
}

export async function createScheduledReport(input: CreateScheduledReportInput) {
  const payload = await controlApiFetch("/v1/scheduled-reports", {
    method: "POST",
    body: JSON.stringify(CreateScheduledReportInputSchema.parse(input)),
  });

  return ScheduledReportSchema.parse(payload);
}

export async function triggerScheduledReport(scheduledReportId: string) {
  const payload = await controlApiFetch(`/v1/scheduled-reports/${scheduledReportId}/trigger`, {
    method: "POST",
  });
  const record =
    payload && typeof payload === "object"
      ? (payload as { scheduledReport?: unknown; exportJob?: unknown })
      : {};

  return {
    scheduledReport: ScheduledReportSchema.parse(record.scheduledReport),
    exportJob: ExportJobSchema.parse(record.exportJob),
  };
}

export async function updateScheduledReport(scheduledReportId: string, input: UpdateScheduledReportInput) {
  const payload = await controlApiFetch(`/v1/scheduled-reports/${scheduledReportId}`, {
    method: "PATCH",
    body: JSON.stringify(UpdateScheduledReportInputSchema.parse(input)),
  });

  return ScheduledReportSchema.parse(payload);
}

export async function deleteScheduledReport(scheduledReportId: string) {
  await controlApiFetch(`/v1/scheduled-reports/${scheduledReportId}`, {
    method: "DELETE",
  });
}

export async function listExportJobs(workspaceId: string): Promise<ExportJob[]> {
  const payload = await controlApiFetch(`/v1/export-jobs?workspaceId=${workspaceId}`);
  return parseListPayload(payload, ExportJobSchema);
}

export async function createExportJob(input: CreateExportJobInput) {
  const payload = await controlApiFetch("/v1/export-jobs", {
    method: "POST",
    body: JSON.stringify(CreateExportJobInputSchema.parse(input)),
  });

  return ExportJobSchema.parse(payload);
}

export async function retryExportJob(exportJobId: string) {
  const payload = await controlApiFetch(`/v1/export-jobs/${exportJobId}/retry`, {
    method: "POST",
  });

  return ExportJobSchema.parse(payload);
}

export async function updateExportJob(exportJobId: string, input: UpdateExportJobInput) {
  const payload = await controlApiFetch(`/v1/export-jobs/${exportJobId}`, {
    method: "PATCH",
    body: JSON.stringify(UpdateExportJobInputSchema.parse(input)),
  });

  return ExportJobSchema.parse(payload);
}

export function getExportDownloadUrl(job: ExportJob) {
  if (!job.downloadPath) {
    return null;
  }

  return `/exports/${job.id}/download`;
}

export async function listLineageKeyVersions() {
  const payload = await controlApiFetch("/v1/lineage-key-versions");
  return parseListPayload(payload, LineageKeyVersionSchema);
}

export async function rotateLineageKeyVersion(input: RotateLineageKeyVersionInput) {
  const payload = await controlApiFetch("/v1/lineage-key-versions/rotate", {
    method: "POST",
    body: JSON.stringify(RotateLineageKeyVersionInputSchema.parse(input)),
  });

  return LineageKeyVersionSchema.parse(payload);
}

export async function issueLineage(organizationId: string, input: IssueLineageInput) {
  const payload = await controlApiFetch(`/v1/organizations/${organizationId}/lineage/issue`, {
    method: "POST",
    body: JSON.stringify(IssueLineageInputSchema.parse(input)),
  });

  return LineageIssuanceSchema.parse(payload);
}

export async function lookupLineageIssuances(query: LineageLookupQuery): Promise<LineageListResponse> {
  const params = new URLSearchParams();
  const normalized = LineageLookupQuerySchema.parse(query);

  appendQueryValue(params, "lineageId", normalized.lineageId);
  appendQueryValue(params, "lineageToken", normalized.lineageToken);
  appendQueryValue(params, "customerId", normalized.customerId);
  appendQueryValue(params, "deploymentId", normalized.deploymentId);
  appendQueryValue(params, "releaseId", normalized.releaseId);
  appendQueryValue(params, "manifestHash", normalized.manifestHash);
  appendQueryValue(params, "status", normalized.status);
  appendQueryValue(params, "limit", normalized.limit);
  appendQueryValue(params, "offset", normalized.offset);

  const payload = await controlApiFetch(`/v1/lineage/lookup?${params.toString()}`);
  return LineageListResponseSchema.parse(payload);
}

export async function getLineage(lineageId: string) {
  const payload = await controlApiFetch(`/v1/lineage/${lineageId}`);
  return LineageIssuanceSchema.parse(payload);
}

export async function revokeLineage(lineageId: string, input: RevokeLineageInput) {
  const payload = await controlApiFetch(`/v1/lineage/${lineageId}/revoke`, {
    method: "POST",
    body: JSON.stringify(RevokeLineageInputSchema.parse(input)),
  });

  return LineageIssuanceSchema.parse(payload);
}

export async function listLineageAttestationBundles(lineageId: string) {
  const payload = await controlApiFetch(`/v1/lineage/${lineageId}/attestation-bundles`);
  return parseListPayload(payload, AttestationBundleSchema);
}

export async function getLineageBuildDescriptor(lineageId: string): Promise<BuildDescriptorResponse> {
  const payload = await controlApiFetch(`/v1/lineage/${lineageId}/build-descriptor`);
  return BuildDescriptorResponseSchema.parse(payload);
}

export async function verifyLineageArtifacts(
  lineageId: string,
  input: VerifyLineageArtifactsInput,
): Promise<VerifyLineageArtifactsResponse> {
  const payload = await controlApiFetch(`/v1/lineage/${lineageId}/artifacts/verify`, {
    method: "POST",
    body: JSON.stringify(VerifyLineageArtifactsInputSchema.parse(input)),
  });

  return VerifyLineageArtifactsResponseSchema.parse(payload);
}

export async function listBudgetSummaries(workspaceId: string) {
  const payload = await controlApiFetch(`/v1/budgets?workspaceId=${workspaceId}`);
  return parseListPayload(payload, BudgetPolicySummarySchema);
}

export async function createBudgetPolicy(input: CreateBudgetPolicyInput) {
  const payload = await controlApiFetch("/v1/budgets", {
    method: "POST",
    body: JSON.stringify(CreateBudgetPolicyInputSchema.parse(input)),
  });

  return BudgetPolicySchema.parse(payload);
}

export async function updateBudgetPolicy(budgetPolicyId: string, input: UpdateBudgetPolicyInput) {
  const payload = await controlApiFetch(`/v1/budgets/${budgetPolicyId}`, {
    method: "PATCH",
    body: JSON.stringify(UpdateBudgetPolicyInputSchema.parse(input)),
  });

  return BudgetPolicySchema.parse(payload);
}

export async function deleteBudgetPolicy(budgetPolicyId: string) {
  await controlApiFetch(`/v1/budgets/${budgetPolicyId}`, {
    method: "DELETE",
  });
}

export async function listAlerts(filters: AlertQuery): Promise<Alert[]> {
  const query = AlertQuerySchema.parse(filters);
  const params = new URLSearchParams();
  appendQueryValue(params, "workspaceId", query.workspaceId);
  appendQueryValue(params, "projectId", query.projectId);
  appendQueryValue(params, "environmentId", query.environmentId);
  appendQueryValue(params, "status", query.status);
  appendQueryValue(params, "severity", query.severity);
  appendQueryValue(params, "code", query.code);
  appendQueryValue(params, "budgetPolicyId", query.budgetPolicyId);

  const payload = await controlApiFetch(`/v1/alerts?${params.toString()}`);
  return parseListPayload(payload, AlertSchema);
}

export async function getAlert(alertId: string) {
  const payload = await controlApiFetchOptional(`/v1/alerts/${alertId}`);
  return payload ? AlertSchema.parse(payload) : null;
}

export async function updateAlert(alertId: string, input: UpdateAlertInput) {
  const payload = await controlApiFetch(`/v1/alerts/${alertId}`, {
    method: "PATCH",
    body: JSON.stringify(UpdateAlertInputSchema.parse(input)),
  });

  return AlertSchema.parse(payload);
}

type WorkspaceScopedPageContext = {
  workspaceOptions: WorkspaceOption[];
  selectedWorkspaceId: string | null;
  workspaceSelectionIssue: ControlApiIssue | null;
  workspaceSelectionStatus: WorkspaceSelectionStatus;
};

export type WorkspaceBudgetPageData = WorkspaceScopedPageContext & {
  budgets: BudgetPolicySummary[];
  alerts: Alert[];
  projects: Project[];
  environments: Environment[];
  workspaceUsageSummary: UsageEventSummary;
};

export type WorkspaceProjectsPageData = WorkspaceScopedPageContext & {
  projects: Project[];
  environments: Environment[];
  members: Member[];
  memberProjectAssignments: MemberProjectAssignment[];
};

export type WorkspaceMembersPageData = WorkspaceScopedPageContext & {
  members: Member[];
  projects: Project[];
  memberProjectAssignments: MemberProjectAssignment[];
};

export type WorkspaceAlertsPageData = WorkspaceScopedPageContext & {
  alerts: Alert[];
  allAlerts: Alert[];
  projects: Project[];
  environments: Environment[];
};

export type WorkspaceVirtualKeysPageData = WorkspaceScopedPageContext & {
  virtualKeys: VirtualKey[];
  virtualKeysTotal: number;
  virtualKeySummary: VirtualKeyInventorySummary;
  providerConnections: ProviderConnection[];
  projects: Project[];
  environments: Environment[];
  gatewayBaseUrl: string;
  canRevealExistingToken: boolean;
  pageOffset: number;
  pageSize: number;
};

export async function loadBudgetPageData(requestedWorkspaceId?: string | null): Promise<WorkspaceBudgetPageData> {
  const { workspaceOptions, selectedWorkspaceId, issue, selectionStatus, dataResult } =
    await loadWorkspaceSelectionWithOptimisticData(requestedWorkspaceId, async (workspaceId) =>
      Promise.all([
        listBudgetSummaries(workspaceId),
        listAlerts({
          workspaceId,
        }),
        listProjects(workspaceId),
        listWorkspaceEnvironments(workspaceId),
        getUsageEventSummary({
          workspaceId,
          from: getCurrentMonthStartIso(),
        }),
      ]),
    );

  if (!selectedWorkspaceId) {
    return {
      workspaceOptions,
      selectedWorkspaceId: null,
      workspaceSelectionIssue: issue,
      workspaceSelectionStatus: selectionStatus,
      budgets: [],
      alerts: [],
      projects: [],
      environments: [],
      workspaceUsageSummary: {
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
      },
    };
  }

  if (!dataResult?.ok) {
    throw dataResult?.error;
  }

  const [budgets, alerts, projects, environments, workspaceUsageSummary] = dataResult.data;

  return {
    workspaceOptions,
    selectedWorkspaceId,
    workspaceSelectionIssue: issue,
    workspaceSelectionStatus: selectionStatus,
    budgets,
    alerts,
    projects,
    environments,
    workspaceUsageSummary,
  };
}

export async function loadAlertsPageData(
  requestedWorkspaceId?: string | null,
  filters?: Omit<AlertQuery, "workspaceId">,
): Promise<WorkspaceAlertsPageData> {
  const { workspaceOptions, selectedWorkspaceId, issue, selectionStatus, dataResult } =
    await loadWorkspaceSelectionWithOptimisticData(requestedWorkspaceId, async (workspaceId) =>
      Promise.all([
        listAlerts({
          workspaceId,
          ...filters,
        }),
        listAlerts({
          workspaceId,
        }),
        listProjects(workspaceId),
        listWorkspaceEnvironments(workspaceId),
      ]),
    );

  if (!selectedWorkspaceId) {
    return {
      workspaceOptions,
      selectedWorkspaceId: null,
      workspaceSelectionIssue: issue,
      workspaceSelectionStatus: selectionStatus,
      alerts: [],
      allAlerts: [],
      projects: [],
      environments: [],
    };
  }

  if (!dataResult?.ok) {
    throw dataResult?.error;
  }

  const [alerts, allAlerts, projects, environments] = dataResult.data;

  return {
    workspaceOptions,
    selectedWorkspaceId,
    workspaceSelectionIssue: issue,
    workspaceSelectionStatus: selectionStatus,
    alerts,
    allAlerts,
    projects,
    environments,
  };
}

export async function loadProjectsPageData(requestedWorkspaceId?: string | null): Promise<WorkspaceProjectsPageData> {
  const { workspaceOptions, selectedWorkspaceId, issue, selectionStatus, dataResult } =
    await loadWorkspaceSelectionWithOptimisticData(requestedWorkspaceId, async (workspaceId) =>
      Promise.all([
        listProjects(workspaceId),
        listWorkspaceEnvironments(workspaceId),
        listMembers(workspaceId),
        listMemberProjectAssignments(workspaceId),
      ]),
    );

  if (!selectedWorkspaceId) {
    return {
      workspaceOptions,
      selectedWorkspaceId: null,
      workspaceSelectionIssue: issue,
      workspaceSelectionStatus: selectionStatus,
      projects: [],
      environments: [],
      members: [],
      memberProjectAssignments: [],
    };
  }

  if (!dataResult?.ok) {
    throw dataResult?.error;
  }

  const [projects, environments, members, memberProjectAssignments] = dataResult.data;

  return {
    workspaceOptions,
    selectedWorkspaceId,
    workspaceSelectionIssue: issue,
    workspaceSelectionStatus: selectionStatus,
    projects,
    environments,
    members,
    memberProjectAssignments,
  };
}

export async function loadMembersPageData(requestedWorkspaceId?: string | null): Promise<WorkspaceMembersPageData> {
  const { workspaceOptions, selectedWorkspaceId, issue, selectionStatus, dataResult } =
    await loadWorkspaceSelectionWithOptimisticData(requestedWorkspaceId, async (workspaceId) =>
      Promise.all([listMembers(workspaceId), listProjects(workspaceId), listMemberProjectAssignments(workspaceId)]),
    );

  if (!selectedWorkspaceId) {
    return {
      workspaceOptions,
      selectedWorkspaceId: null,
      workspaceSelectionIssue: issue,
      workspaceSelectionStatus: selectionStatus,
      members: [],
      projects: [],
      memberProjectAssignments: [],
    };
  }

  if (!dataResult?.ok) {
    throw dataResult?.error;
  }

  const [members, projects, memberProjectAssignments] = dataResult.data;

  return {
    workspaceOptions,
    selectedWorkspaceId,
    workspaceSelectionIssue: issue,
    workspaceSelectionStatus: selectionStatus,
    members,
    projects,
    memberProjectAssignments,
  };
}

export async function loadVirtualKeysPageData(
  requestedWorkspaceId?: string | null,
  options?: {
    includeProviderConnections?: boolean;
    limit?: number;
    offset?: number;
  },
): Promise<WorkspaceVirtualKeysPageData> {
  const includeProviderConnections = options?.includeProviderConnections ?? true;
  const pageOffset = options?.offset ?? 0;
  const pageSize = options?.limit ?? 50;
  const { workspaceOptions, selectedWorkspaceId, issue, selectionStatus, dataResult } =
    await loadWorkspaceSelectionWithOptimisticData(requestedWorkspaceId, async (workspaceId) =>
      Promise.all([
        listVirtualKeys(workspaceId, {
          limit: pageSize,
          offset: pageOffset,
        }),
        includeProviderConnections ? listProviderConnections(workspaceId) : Promise.resolve([]),
        listProjects(workspaceId),
        listWorkspaceEnvironments(workspaceId),
      ]),
    );

  if (!selectedWorkspaceId) {
    return {
      workspaceOptions,
      selectedWorkspaceId: null,
      workspaceSelectionIssue: issue,
      workspaceSelectionStatus: selectionStatus,
      virtualKeys: [],
      virtualKeysTotal: 0,
      virtualKeySummary: {
        total: 0,
        active: 0,
        revoked: 0,
        expired: 0,
        neverUsed: 0,
        environmentBound: 0,
      },
      providerConnections: [],
      projects: [],
      environments: [],
      gatewayBaseUrl: getGatewayBaseUrl(),
      canRevealExistingToken: false,
      pageOffset,
      pageSize,
    };
  }

  if (!dataResult?.ok) {
    throw dataResult?.error;
  }

  const [virtualKeyResult, providerConnections, projects, environments] = dataResult.data;

  return {
    workspaceOptions,
    selectedWorkspaceId,
    workspaceSelectionIssue: issue,
    workspaceSelectionStatus: selectionStatus,
    virtualKeys: virtualKeyResult.items,
    virtualKeysTotal: virtualKeyResult.total,
    virtualKeySummary: virtualKeyResult.summary,
    providerConnections,
    projects,
    environments,
    gatewayBaseUrl: getGatewayBaseUrl(),
    canRevealExistingToken: false,
    pageOffset,
    pageSize,
  };
}

export type ExportPageData = WorkspaceScopedPageContext & {
  exportJobs: ExportJob[];
};

export type GlobalHomeBreakdownItem = {
  id: string;
  label: string;
  meta: string;
  totalCostUsd: number;
  totalEvents: number;
};

export type GlobalHomeWorkspaceBreakdownItem = GlobalHomeBreakdownItem & {
  workspaceId: string;
  organizationName: string;
  projectCount: number;
  environmentCount: number;
  openAlertCount: number;
};

export type GlobalHomeProjectBreakdownItem = GlobalHomeBreakdownItem & {
  workspaceId: string;
  workspaceName: string;
  organizationName: string;
  status: Project["status"];
};

export type GlobalHomeDashboardData = {
  organizations: OrganizationSummary[];
  workspaceCount: number;
  usageSummary: UsageEventSummary;
  dailyUsage: Awaited<ReturnType<typeof getUsageEventDaily>>;
  recentUsage: Awaited<ReturnType<typeof listUsageEvents>>;
  recentAudit: Awaited<ReturnType<typeof listAuditLogs>>;
  organizationBreakdown: GlobalHomeBreakdownItem[];
  workspaceBreakdown: GlobalHomeWorkspaceBreakdownItem[];
  projectBreakdown: GlobalHomeProjectBreakdownItem[];
  providerSummary: {
    active: number;
    attention: number;
    revoked: number;
  };
  keySummary: {
    active: number;
    expiringSoon: number;
    dormantWideAccess: number;
    neverUsed: number;
  };
  budgetSummary: {
    active: number;
    openAlerts: number;
    blockingAlerts: number;
  };
  alertSummary: {
    open: number;
    critical: number;
  };
  resourceSummary: {
    projects: number;
    environments: number;
  };
  permissions: WorkspaceHomeOverview["permissions"] | null;
  issue: ControlApiIssue | null;
};


function createEmptyUsageSummary(): UsageEventSummary {
  return {
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
}

function createEmptyDailyUsage(window = 30): Awaited<ReturnType<typeof getUsageEventDaily>> {
  return {
    window,
    items: [],
  };
}

function createEmptyUsageList(): Awaited<ReturnType<typeof listUsageEvents>> {
  return {
    items: [],
    total: 0,
  };
}

function createEmptyAuditList(): Awaited<ReturnType<typeof listAuditLogs>> {
  return {
    items: [],
    total: 0,
  };
}

function getFirstRejectedIssue(
  results: PromiseSettledResult<unknown>[],
  getPath: (index: number) => string,
): ControlApiIssue | null {
  const failureIndex = results.findIndex((result) => result.status === "rejected");
  if (failureIndex === -1) {
    return null;
  }

  const failure = results[failureIndex];
  if (failure?.status !== "rejected") {
    return null;
  }

  const diagnosedIssue = diagnoseControlApiIssue(failure.reason);
  if (diagnosedIssue) {
    return diagnosedIssue;
  }

  if (failure.reason instanceof ControlApiRequestError && failure.reason.status === 403) {
    return null;
  }

  return buildUnexpectedIssue(failure.reason, getPath(failureIndex));
}

function getDaysUntil(value: string | null, now = new Date()) {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Math.ceil((parsed - now.getTime()) / (24 * 60 * 60 * 1000));
}

function isExpired(value: string | null, now = new Date()) {
  if (!value) {
    return false;
  }

  return Date.parse(value) <= now.getTime();
}

function isExpiringSoon(value: string | null, now = new Date()) {
  const daysUntil = getDaysUntil(value, now);
  return daysUntil !== null && daysUntil >= 0 && daysUntil <= 14;
}

export async function loadGlobalHomeDashboardData(args: {
  organizations: OrganizationSummary[];
  workspaceOptions: WorkspaceOption[];
  selectedWorkspaceId?: string | null;
  locale?: AppLocale;
  suspendForIdentitySwitch?: boolean;
}): Promise<GlobalHomeDashboardData> {
  if (!args.organizations.length || !args.workspaceOptions.length) {
    return {
      organizations: args.organizations,
      workspaceCount: args.workspaceOptions.length,
      usageSummary: createEmptyUsageSummary(),
      dailyUsage: createEmptyDailyUsage(30),
      recentUsage: createEmptyUsageList(),
      recentAudit: createEmptyAuditList(),
      organizationBreakdown: [],
      workspaceBreakdown: [],
      projectBreakdown: [],
      providerSummary: {
        active: 0,
        attention: 0,
        revoked: 0,
      },
      keySummary: {
        active: 0,
        expiringSoon: 0,
        dormantWideAccess: 0,
        neverUsed: 0,
      },
      budgetSummary: {
        active: 0,
        openAlerts: 0,
        blockingAlerts: 0,
      },
      alertSummary: {
        open: 0,
        critical: 0,
      },
      resourceSummary: {
        projects: 0,
        environments: 0,
      },
      permissions: null,
      issue: null,
    };
  }

  if (args.suspendForIdentitySwitch) {
    return {
      organizations: args.organizations,
      workspaceCount: args.workspaceOptions.length,
      usageSummary: createEmptyUsageSummary(),
      dailyUsage: createEmptyDailyUsage(30),
      recentUsage: createEmptyUsageList(),
      recentAudit: createEmptyAuditList(),
      organizationBreakdown: [],
      workspaceBreakdown: [],
      projectBreakdown: [],
      providerSummary: {
        active: 0,
        attention: 0,
        revoked: 0,
      },
      keySummary: {
        active: 0,
        expiringSoon: 0,
        dormantWideAccess: 0,
        neverUsed: 0,
      },
      budgetSummary: {
        active: 0,
        openAlerts: 0,
        blockingAlerts: 0,
      },
      alertSummary: {
        open: 0,
        critical: 0,
      },
      resourceSummary: {
        projects: 0,
        environments: 0,
      },
      permissions: null,
      issue: null,
    };
  }

  const currentMonthStart = getCurrentMonthStartIso();
  const authMode = getWebAdminAuthMode();
  const selectedWorkspaceId = normalizeWorkspacePreferenceValue(args.selectedWorkspaceId);
  const sessionHandle = await getControlPlaneSessionHandle();
  const shouldScopeHomeQueries = Boolean(sessionHandle) || authMode !== "bootstrap_admin";
  const scopedHomeWorkspaceId = shouldScopeHomeQueries ? selectedWorkspaceId : null;
  const canLoadHomeOverview = !shouldScopeHomeQueries || Boolean(scopedHomeWorkspaceId);
  const [usageSummaryResult, dailyUsageResult, recentAttentionResult, recentUsageResult, recentAuditResult] =
    canLoadHomeOverview
      ? await Promise.allSettled([
          getUsageEventSummary({
            workspaceId: scopedHomeWorkspaceId,
            from: currentMonthStart,
          }),
          getUsageEventDaily({
            workspaceId: scopedHomeWorkspaceId,
            window: "30",
          }),
          listUsageEvents(scopedHomeWorkspaceId, {
            limit: 3,
            statusGroup: "attention",
          }),
          listUsageEvents(scopedHomeWorkspaceId, {
            limit: 3,
            sortBy: "newest",
          }),
          listAuditLogs({
            workspaceId: scopedHomeWorkspaceId,
            limit: 3,
          }),
        ])
      : await Promise.allSettled([
          Promise.resolve(createEmptyUsageSummary()),
          Promise.resolve(createEmptyDailyUsage(30)),
          Promise.resolve(createEmptyUsageList()),
          Promise.resolve(createEmptyUsageList()),
          Promise.resolve(createEmptyAuditList()),
        ]);

  const usageSummary =
    usageSummaryResult.status === "fulfilled" ? usageSummaryResult.value : createEmptyUsageSummary();
  const dailyUsage =
    dailyUsageResult.status === "fulfilled" ? dailyUsageResult.value : createEmptyDailyUsage(30);
  const recentUsageAttention =
    recentAttentionResult.status === "fulfilled" ? recentAttentionResult.value : createEmptyUsageList();
  const recentUsageFallback =
    recentUsageResult.status === "fulfilled" ? recentUsageResult.value : createEmptyUsageList();
  const recentAudit =
    recentAuditResult.status === "fulfilled" ? recentAuditResult.value : createEmptyAuditList();

  const workspaceResults = await Promise.allSettled(
    args.workspaceOptions.map(async (workspace) => {
      const [snapshot, projects] = await Promise.all([
        getWorkspaceHomeSnapshot(workspace.id),
        listProjects(workspace.id),
      ]);

      const projectUsageResults = await Promise.allSettled(
        projects.map(async (project) => ({
          project,
          usage: await getUsageEventSummary({
            workspaceId: workspace.id,
            projectId: project.id,
            from: currentMonthStart,
          }),
        })),
      );

      return {
        workspace,
        snapshot,
        projects,
        projectUsageResults,
      };
    }),
  );

  const organizationBreakdownMap = new Map<
    string,
    {
      label: string;
      workspaceCount: number;
      projectCount: number;
      environmentCount: number;
      totalCostUsd: number;
      totalEvents: number;
    }
  >(
    args.organizations.map((organization) => [
      organization.id,
      {
        label: organization.name,
        workspaceCount: organization.workspaceCount,
        projectCount: 0,
        environmentCount: 0,
        totalCostUsd: 0,
        totalEvents: 0,
      },
    ]),
  );
  const workspaceBreakdown: GlobalHomeWorkspaceBreakdownItem[] = [];
  const projectBreakdown: GlobalHomeProjectBreakdownItem[] = [];

  let activeProviderCount = 0;
  let attentionProviderCount = 0;
  let revokedProviderCount = 0;
  let activeVirtualKeyCount = 0;
  let expiringSoonKeyCount = 0;
  let dormantWideAccessCount = 0;
  let neverUsedKeyCount = 0;
  let activeBudgetCount = 0;
  let openBudgetAlertCount = 0;
  let blockingBudgetAlertCount = 0;
  let openAlertCount = 0;
  let criticalAlertCount = 0;
  let totalProjectCount = 0;
  let totalEnvironmentCount = 0;

  let selectedWorkspacePermissions: WorkspaceHomeOverview["permissions"] | null = null;

  for (const result of workspaceResults) {
    if (result.status !== "fulfilled") {
      continue;
    }

    const {
      workspace,
      snapshot,
      projects,
      projectUsageResults,
    } = result.value;
    const overview = snapshot.overview;

    if (workspace.id === selectedWorkspaceId) {
      selectedWorkspacePermissions = overview?.permissions ?? null;
    }
    const workspaceUsageSummary = overview?.usageSummary ?? createEmptyUsageSummary();
    const organizationAggregate = organizationBreakdownMap.get(workspace.organizationId);

    if (organizationAggregate) {
      organizationAggregate.projectCount += overview?.projectCount ?? 0;
      organizationAggregate.environmentCount += overview?.environmentCount ?? 0;
      organizationAggregate.totalCostUsd += workspaceUsageSummary.totalCostUsd;
      organizationAggregate.totalEvents += workspaceUsageSummary.totalEvents;
    }

    workspaceBreakdown.push({
      id: workspace.id,
      workspaceId: workspace.id,
      label: workspace.name,
      meta: workspace.organizationName,
      organizationName: workspace.organizationName,
      totalCostUsd: workspaceUsageSummary.totalCostUsd,
      totalEvents: workspaceUsageSummary.totalEvents,
      projectCount: overview?.projectCount ?? 0,
      environmentCount: overview?.environmentCount ?? 0,
      openAlertCount: snapshot.openAlerts.filter((alert) => alert.status === "open").length,
    });

    for (const projectUsageResult of projectUsageResults) {
      if (projectUsageResult.status !== "fulfilled") {
        continue;
      }

      projectBreakdown.push({
        id: projectUsageResult.value.project.id,
        label: projectUsageResult.value.project.name,
        meta: `${workspace.organizationName} / ${workspace.name}`,
        totalCostUsd: projectUsageResult.value.usage.totalCostUsd,
        totalEvents: projectUsageResult.value.usage.totalEvents,
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        organizationName: workspace.organizationName,
        status: projectUsageResult.value.project.status,
      });
    }

    const activeProviderConnections = snapshot.providerConnections.filter(
      (providerConnection) => providerConnection.status === "active",
    );
    activeProviderCount += activeProviderConnections.length;
    attentionProviderCount += activeProviderConnections.filter(
      (providerConnection) => providerConnection.lastTestStatus !== "passed",
    ).length;
    revokedProviderCount += snapshot.providerConnections.filter(
      (providerConnection) => providerConnection.status !== "active",
    ).length;

    activeVirtualKeyCount += snapshot.virtualKeys.summary.active;
    neverUsedKeyCount += snapshot.virtualKeys.summary.neverUsed;
    expiringSoonKeyCount += snapshot.virtualKeys.items.filter(
      (virtualKey) =>
        virtualKey.status === "active" &&
        !isExpired(virtualKey.expiresAt) &&
        isExpiringSoon(virtualKey.expiresAt),
    ).length;
    dormantWideAccessCount += snapshot.virtualKeys.items.filter(
      (virtualKey) =>
        virtualKey.status === "active" &&
        !virtualKey.lastUsedAt &&
        !virtualKey.expiresAt &&
        !virtualKey.projectId &&
        !virtualKey.environmentId,
    ).length;

    const budgetSummary = overview?.budgetSummary;
    activeBudgetCount += budgetSummary?.activeBudgetCount ?? 0;
    openBudgetAlertCount += budgetSummary?.openBudgetAlertCount ?? 0;
    blockingBudgetAlertCount += budgetSummary?.blockingBudgetAlertCount ?? 0;

    const workspaceOpenAlerts = snapshot.openAlerts.filter((alert) => alert.status === "open");
    openAlertCount += workspaceOpenAlerts.length;
    criticalAlertCount += workspaceOpenAlerts.filter((alert) => alert.severity === "critical").length;

    totalProjectCount += overview?.projectCount ?? projects.length;
    totalEnvironmentCount += overview?.environmentCount ?? 0;
  }

  const workspaceIssue = getFirstRejectedIssue(
    workspaceResults,
    (index) =>
      `/v1/workspaces/${args.workspaceOptions[index]?.id ?? "unknown"}/home-snapshot`,
  );
  const projectSummaryIssue = getFirstRejectedIssue(
    workspaceResults
      .filter((result): result is PromiseFulfilledResult<{
        workspace: WorkspaceOption;
        snapshot: WorkspaceHomeSnapshot;
        projects: Project[];
        projectUsageResults: PromiseSettledResult<{
          project: Project;
          usage: UsageEventSummary;
        }>[];
      }> => result.status === "fulfilled")
      .flatMap((result) => result.value.projectUsageResults),
    () => "/v1/usage-events/summary",
  );

  const issue = pickFirstControlApiIssue(
    usageSummaryResult.status === "rejected"
      ? diagnoseControlApiIssue(usageSummaryResult.reason) ??
          buildUnexpectedIssue(usageSummaryResult.reason, "/v1/usage-events/summary")
      : null,
    dailyUsageResult.status === "rejected"
      ? diagnoseControlApiIssue(dailyUsageResult.reason) ??
          buildUnexpectedIssue(dailyUsageResult.reason, "/v1/usage-events/daily")
      : null,
    recentAttentionResult.status === "rejected"
      ? diagnoseControlApiIssue(recentAttentionResult.reason) ??
          buildUnexpectedIssue(recentAttentionResult.reason, "/v1/usage-events")
      : null,
    recentUsageResult.status === "rejected"
      ? diagnoseControlApiIssue(recentUsageResult.reason) ??
          buildUnexpectedIssue(recentUsageResult.reason, "/v1/usage-events")
      : null,
    recentAuditResult.status === "rejected"
      ? diagnoseControlApiIssue(recentAuditResult.reason) ??
          buildUnexpectedIssue(recentAuditResult.reason, "/v1/audit-logs")
      : null,
    workspaceIssue,
    projectSummaryIssue,
  );

  return {
    organizations: args.organizations,
    workspaceCount: args.workspaceOptions.length,
    usageSummary,
    dailyUsage,
    recentUsage:
      recentUsageAttention.items.length > 0 ? recentUsageAttention : recentUsageFallback,
    recentAudit,
    organizationBreakdown: [...organizationBreakdownMap.entries()]
      .map(([id, organization]) => ({
        id,
        label: organization.label,
        meta:
          args.locale === "zh"
            ? `${organization.workspaceCount} 个工作区`
            : `${organization.workspaceCount} workspaces`,
        totalCostUsd: organization.totalCostUsd,
        totalEvents: organization.totalEvents,
      }))
      .sort(
        (left, right) =>
          right.totalCostUsd - left.totalCostUsd ||
          right.totalEvents - left.totalEvents ||
          left.label.localeCompare(right.label),
      ),
    workspaceBreakdown: workspaceBreakdown.sort(
      (left, right) =>
        right.totalCostUsd - left.totalCostUsd ||
        right.totalEvents - left.totalEvents ||
        left.label.localeCompare(right.label),
    ),
    projectBreakdown: projectBreakdown.sort(
      (left, right) =>
        right.totalCostUsd - left.totalCostUsd ||
        right.totalEvents - left.totalEvents ||
        left.label.localeCompare(right.label),
    ),
    providerSummary: {
      active: activeProviderCount,
      attention: attentionProviderCount,
      revoked: revokedProviderCount,
    },
    keySummary: {
      active: activeVirtualKeyCount,
      expiringSoon: expiringSoonKeyCount,
      dormantWideAccess: dormantWideAccessCount,
      neverUsed: neverUsedKeyCount,
    },
    budgetSummary: {
      active: activeBudgetCount,
      openAlerts: openBudgetAlertCount,
      blockingAlerts: blockingBudgetAlertCount,
    },
    alertSummary: {
      open: openAlertCount,
      critical: criticalAlertCount,
    },
    resourceSummary: {
      projects: totalProjectCount,
      environments: totalEnvironmentCount,
    },
    permissions: selectedWorkspacePermissions,
    issue,
  };
}

export async function loadExportPageData(requestedWorkspaceId?: string | null): Promise<ExportPageData> {
  const { workspaceOptions, selectedWorkspaceId, issue, selectionStatus, dataResult } =
    await loadWorkspaceSelectionWithOptimisticData(requestedWorkspaceId, listExportJobs);

  if (!selectedWorkspaceId) {
    return {
      workspaceOptions,
      selectedWorkspaceId: null,
      workspaceSelectionIssue: issue,
      workspaceSelectionStatus: selectionStatus,
      exportJobs: [],
    };
  }

  if (!dataResult?.ok) {
    throw dataResult?.error;
  }

  return {
    workspaceOptions,
    selectedWorkspaceId,
    workspaceSelectionIssue: issue,
    workspaceSelectionStatus: selectionStatus,
    exportJobs: dataResult.data,
  };
}
