import assert from "node:assert/strict";
import test from "node:test";

import { getActiveIdentity, getVisibleIdentityRoleOptions } from "./identity-switcher-state";

test("getVisibleIdentityRoleOptions expands one membership into multiple switchable roles", () => {
  const options = getVisibleIdentityRoleOptions({
    identities: [
      {
        membershipId: "member-1",
        workspaceId: "workspace-1",
        workspaceName: "Workspace 1",
        roles: ["workspace_admin", "developer"],
      },
    ],
    currentWorkspaceId: "workspace-1",
    activeMembershipId: null,
  });

  assert.deepEqual(
    options.map((option) => ({
      membershipId: option.identity.membershipId,
      role: option.role,
    })),
    [
      { membershipId: "member-1", role: "workspace_admin" },
      { membershipId: "member-1", role: "developer" },
    ],
  );
});

test("getActiveIdentity resolves the active membership from role-expanded options", () => {
  const identities = [
    {
      membershipId: "member-1",
      workspaceId: "workspace-1",
      workspaceName: "Workspace 1",
      roles: ["workspace_admin", "developer"],
    },
    {
      membershipId: "member-2",
      workspaceId: "workspace-1",
      workspaceName: "Workspace 1",
      roles: ["developer"],
    },
  ];

  const visibleRoleOptions = getVisibleIdentityRoleOptions({
    identities,
    currentWorkspaceId: "workspace-1",
    activeMembershipId: "member-1",
  });

  const activeIdentity = getActiveIdentity({
    identities,
    visibleRoleOptions,
    activeMembershipId: "member-1",
    activeRole: "developer",
  });

  assert.equal(activeIdentity?.membershipId, "member-1");
  assert.deepEqual(activeIdentity?.roles, ["workspace_admin", "developer"]);
});

test("getVisibleIdentityRoleOptions falls back to the active membership when the workspace filter misses", () => {
  const options = getVisibleIdentityRoleOptions({
    identities: [
      {
        membershipId: "member-1",
        workspaceId: "workspace-1",
        workspaceName: "Workspace 1",
        roles: ["workspace_admin", "developer"],
      },
      {
        membershipId: "member-2",
        workspaceId: "workspace-2",
        workspaceName: "Workspace 2",
        roles: ["developer"],
      },
    ],
    currentWorkspaceId: "workspace-missing",
    activeMembershipId: "member-1",
  });

  assert.deepEqual(
    options.map((option) => ({
      membershipId: option.identity.membershipId,
      role: option.role,
    })),
    [
      { membershipId: "member-1", role: "workspace_admin" },
      { membershipId: "member-1", role: "developer" },
    ],
  );
});
