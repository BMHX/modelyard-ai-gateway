import assert from "node:assert/strict";
import test from "node:test";

import { loadGlobalHomeDashboardData } from "./control-api";

const organizationId = "11111111-1111-4111-8111-111111111111";
const workspaceId = "22222222-2222-4222-8222-222222222222";
const secondaryWorkspaceId = "33333333-3333-4333-8333-333333333333";
const nowIso = "2026-04-18T00:00:00.000Z";

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "content-type": "application/json",
    },
  });
}

function toUrl(input: string | URL | Request) {
  if (typeof input === "string") {
    return new URL(input);
  }

  if (input instanceof URL) {
    return input;
  }

  return new URL(input.url);
}

function createEmptyUsageSummary() {
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

function createWorkspaceSnapshot() {
  return {
    workspaceId,
    overview: {
      workspaceId,
      permissions: {
        projects: true,
        budgets: true,
        usage: true,
        providers: true,
        virtualKeys: true,
        selfServeVirtualKeys: false,
        auditLogs: true,
        exports: true,
        members: true,
        promptInspections: true,
        promptInspectionReview: true,
        promptPolicyWrite: true,
      },
      projectCount: 0,
      environmentCount: 0,
      budgetSummary: {
        activeBudgetCount: 0,
        openBudgetAlertCount: 0,
        blockingBudgetAlertCount: 0,
      },
      usageSummary: createEmptyUsageSummary(),
    },
    providerConnections: [],
    virtualKeys: {
      items: [],
      total: 0,
      summary: {
        total: 0,
        active: 0,
        revoked: 0,
        expired: 0,
        neverUsed: 0,
        environmentBound: 0,
      },
    },
    recentUsage: {
      items: [],
      total: 0,
    },
    recentAudit: {
      items: [],
      total: 0,
    },
    budgetSummaries: [],
    openAlerts: [],
    dailyUsage: {
      window: 30,
      items: [],
    },
    activationAuditEntries: [],
  };
}

function createHomeLoaderArgs(selectedWorkspaceId?: string | null) {
  return {
    organizations: [
      {
        id: organizationId,
        slug: "modelyard",
        name: "Modelyard",
        customerId: "cus_modelyard",
        workspaceCount: 1,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    ],
    workspaceOptions: [
      {
        id: workspaceId,
        organizationId,
        slug: "control-plane",
        name: "Control Plane",
        organizationName: "Modelyard",
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    ],
    selectedWorkspaceId,
  };
}

test("loadGlobalHomeDashboardData scopes member overview queries to the selected workspace", async () => {
  const originalFetch = globalThis.fetch;
  const originalAuthMode = process.env.WEB_ADMIN_AUTH_MODE;
  const originalMemberEmail = process.env.CONTROL_API_MEMBER_EMAIL;
  const requestedUrls: URL[] = [];

  process.env.WEB_ADMIN_AUTH_MODE = "bootstrap_member_email";
  process.env.CONTROL_API_MEMBER_EMAIL = "member@example.com";

  globalThis.fetch = (async (input) => {
    const url = toUrl(input);
    requestedUrls.push(url);

    if (url.pathname === "/v1/usage-events/summary") {
      return jsonResponse(createEmptyUsageSummary());
    }

    if (url.pathname === "/v1/usage-events/daily") {
      return jsonResponse({
        window: 30,
        items: [],
      });
    }

    if (url.pathname === "/v1/usage-events") {
      return jsonResponse({
        items: [],
        total: 0,
      });
    }

    if (url.pathname === "/v1/audit-logs") {
      return jsonResponse({
        items: [],
        total: 0,
      });
    }

    if (url.pathname === `/v1/workspaces/${workspaceId}/home-snapshot`) {
      return jsonResponse(createWorkspaceSnapshot());
    }

    if (url.pathname === "/v1/projects") {
      return jsonResponse({
        items: [],
      });
    }

    throw new Error(`Unexpected fetch: ${url.toString()}`);
  }) as typeof fetch;

  try {
    await loadGlobalHomeDashboardData(createHomeLoaderArgs(workspaceId));
  } finally {
    globalThis.fetch = originalFetch;
    process.env.WEB_ADMIN_AUTH_MODE = originalAuthMode;
    process.env.CONTROL_API_MEMBER_EMAIL = originalMemberEmail;
  }

  const overviewRequests = requestedUrls.filter((url) =>
    url.pathname === "/v1/usage-events/summary" ||
    url.pathname === "/v1/usage-events/daily" ||
    url.pathname === "/v1/usage-events" ||
    url.pathname === "/v1/audit-logs",
  );

  assert.ok(overviewRequests.length > 0);
  for (const url of overviewRequests) {
    assert.equal(url.searchParams.get("workspaceId"), workspaceId);
  }
});

test("loadGlobalHomeDashboardData skips member overview queries until a workspace is selected", async () => {
  const originalFetch = globalThis.fetch;
  const originalAuthMode = process.env.WEB_ADMIN_AUTH_MODE;
  const originalMemberEmail = process.env.CONTROL_API_MEMBER_EMAIL;
  const requestedUrls: URL[] = [];

  process.env.WEB_ADMIN_AUTH_MODE = "bootstrap_member_email";
  process.env.CONTROL_API_MEMBER_EMAIL = "member@example.com";

  globalThis.fetch = (async (input) => {
    const url = toUrl(input);
    requestedUrls.push(url);

    if (url.pathname === `/v1/workspaces/${workspaceId}/home-snapshot`) {
      return jsonResponse(createWorkspaceSnapshot());
    }

    if (url.pathname === "/v1/projects") {
      return jsonResponse({
        items: [],
      });
    }

    throw new Error(`Unexpected fetch: ${url.toString()}`);
  }) as typeof fetch;

  try {
    await loadGlobalHomeDashboardData(createHomeLoaderArgs(null));
  } finally {
    globalThis.fetch = originalFetch;
    process.env.WEB_ADMIN_AUTH_MODE = originalAuthMode;
    process.env.CONTROL_API_MEMBER_EMAIL = originalMemberEmail;
  }

  assert.equal(
    requestedUrls.some((url) =>
      url.pathname === "/v1/usage-events/summary" ||
      url.pathname === "/v1/usage-events/daily" ||
      url.pathname === "/v1/usage-events" ||
      url.pathname === "/v1/audit-logs",
    ),
    false,
  );
});

test("loadGlobalHomeDashboardData skips workspace requests while identity switching is pending", async () => {
  const originalFetch = globalThis.fetch;
  const originalAuthMode = process.env.WEB_ADMIN_AUTH_MODE;
  const originalMemberEmail = process.env.CONTROL_API_MEMBER_EMAIL;
  const requestedUrls: URL[] = [];

  process.env.WEB_ADMIN_AUTH_MODE = "bootstrap_member_email";
  process.env.CONTROL_API_MEMBER_EMAIL = "member@example.com";

  globalThis.fetch = (async (input) => {
    const url = toUrl(input);
    requestedUrls.push(url);
    throw new Error(`Unexpected fetch: ${url.toString()}`);
  }) as typeof fetch;

  try {
    const result = await loadGlobalHomeDashboardData({
      ...createHomeLoaderArgs(workspaceId),
      suspendForIdentitySwitch: true,
    });

    assert.equal(result.issue, null);
    assert.equal(result.permissions, null);
    assert.equal(result.usageSummary.totalEvents, 0);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.WEB_ADMIN_AUTH_MODE = originalAuthMode;
    process.env.CONTROL_API_MEMBER_EMAIL = originalMemberEmail;
  }

  assert.equal(requestedUrls.length, 0);
});

test("loadGlobalHomeDashboardData ignores forbidden secondary workspaces for member home", async () => {
  const originalFetch = globalThis.fetch;
  const originalAuthMode = process.env.WEB_ADMIN_AUTH_MODE;
  const originalMemberEmail = process.env.CONTROL_API_MEMBER_EMAIL;

  process.env.WEB_ADMIN_AUTH_MODE = "bootstrap_member_email";
  process.env.CONTROL_API_MEMBER_EMAIL = "member@example.com";

  globalThis.fetch = (async (input) => {
    const url = toUrl(input);

    if (url.pathname === "/v1/usage-events/summary") {
      return jsonResponse(createEmptyUsageSummary());
    }

    if (url.pathname === "/v1/usage-events/daily") {
      return jsonResponse({
        window: 30,
        items: [],
      });
    }

    if (url.pathname === "/v1/usage-events" || url.pathname === "/v1/audit-logs") {
      return jsonResponse({
        items: [],
        total: 0,
      });
    }

    if (url.pathname === `/v1/workspaces/${workspaceId}/home-snapshot`) {
      return jsonResponse(createWorkspaceSnapshot());
    }

    if (url.pathname === `/v1/workspaces/${secondaryWorkspaceId}/home-snapshot`) {
      return new Response(
        JSON.stringify({
          error: {
            code: "WORKSPACE_ACCESS_DENIED",
            message: "The current active identity does not have access to this workspace",
            resource: "workspace",
          },
        }),
        {
          status: 403,
          headers: {
            "content-type": "application/json",
          },
        },
      );
    }

    if (url.pathname === "/v1/projects") {
      const workspaceIdParam = url.searchParams.get("workspaceId");
      return jsonResponse({
        items: workspaceIdParam === secondaryWorkspaceId ? [] : [],
      });
    }

    throw new Error(`Unexpected fetch: ${url.toString()}`);
  }) as typeof fetch;

  try {
    const result = await loadGlobalHomeDashboardData({
      organizations: createHomeLoaderArgs(workspaceId).organizations,
      workspaceOptions: [
        ...createHomeLoaderArgs(workspaceId).workspaceOptions,
        {
          id: secondaryWorkspaceId,
          organizationId,
          slug: "sandbox",
          name: "Sandbox",
          organizationName: "Modelyard",
          createdAt: nowIso,
          updatedAt: nowIso,
        },
      ],
      selectedWorkspaceId: workspaceId,
    });

    assert.equal(result.issue, null);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.WEB_ADMIN_AUTH_MODE = originalAuthMode;
    process.env.CONTROL_API_MEMBER_EMAIL = originalMemberEmail;
  }
});
