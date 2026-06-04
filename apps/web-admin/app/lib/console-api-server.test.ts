import assert from "node:assert/strict";
import test from "node:test";

import { buildConsoleBootstrapResponse } from "./console-api-server";

const workspaceId = "22222222-2222-4222-8222-222222222222";
const otherWorkspaceId = "33333333-3333-4333-8333-333333333333";
const organizationId = "11111111-1111-4111-8111-111111111111";
const activeMembershipId = "44444444-4444-4444-8444-444444444444";
const targetMembershipId = "55555555-5555-4555-8555-555555555555";

function jsonResponse(payload: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "content-type": "application/json",
    },
    ...init,
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

test("buildConsoleBootstrapResponse reports switch_required without loading workspace permissions", async () => {
  const originalFetch = globalThis.fetch;
  const originalAuthMode = process.env.WEB_ADMIN_AUTH_MODE;
  const originalMemberEmail = process.env.CONTROL_API_MEMBER_EMAIL;
  const requestedUrls: string[] = [];

  process.env.WEB_ADMIN_AUTH_MODE = "bootstrap_member_email";
  process.env.CONTROL_API_MEMBER_EMAIL = "member@example.com";

  globalThis.fetch = (async (input) => {
    const url = toUrl(input);
    requestedUrls.push(url.pathname);

    if (url.pathname === "/v1/workspace-options") {
      return jsonResponse({
        items: [
          {
            id: workspaceId,
            organizationId,
            slug: "control-plane",
            name: "Control Plane",
            organizationName: "Modelyard",
            createdAt: "2026-04-01T00:00:00.000Z",
            updatedAt: "2026-04-01T00:00:00.000Z",
          },
        ],
      });
    }

    if (url.pathname === "/v1/auth/session") {
      return jsonResponse({
        authenticated: true,
        organizationId,
        organizationSlug: "modelyard",
        operatorId: "66666666-6666-4666-8666-666666666666",
        email: "member@example.com",
        name: "Member",
        guideExitedWorkspaceIds: [],
        expiresAt: "2026-05-01T00:00:00.000Z",
        idleExpiresAt: "2026-05-01T00:00:00.000Z",
        activeMembershipId,
        activeRole: "developer",
      });
    }

    if (url.pathname === "/v1/auth/session/identities") {
      return jsonResponse([
        {
          membershipId: activeMembershipId,
          workspaceId: otherWorkspaceId,
          workspaceName: "Sandbox",
          roles: ["developer"],
        },
        {
          membershipId: targetMembershipId,
          workspaceId,
          workspaceName: "Control Plane",
          roles: ["workspace_admin"],
        },
      ]);
    }

    throw new Error(`Unexpected fetch: ${url.toString()}`);
  }) as typeof fetch;

  try {
    const response = await buildConsoleBootstrapResponse({
      requestedWorkspaceId: workspaceId,
    });

    assert.equal(response.workspace.identityResolution.status, "switch_required");
    assert.equal(response.workspace.identityResolution.workspaceId, workspaceId);
    assert.equal(
      response.workspace.identityResolution.selectedMembershipId,
      targetMembershipId,
    );
    assert.equal(response.workspace.identityResolution.selectedRole, "workspace_admin");
    assert.equal(response.workspace.activeWorkspaceId, null);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.WEB_ADMIN_AUTH_MODE = originalAuthMode;
    process.env.CONTROL_API_MEMBER_EMAIL = originalMemberEmail;
  }

  assert.equal(
    requestedUrls.includes(`/v1/workspaces/${workspaceId}/home-overview`),
    false,
  );
});
