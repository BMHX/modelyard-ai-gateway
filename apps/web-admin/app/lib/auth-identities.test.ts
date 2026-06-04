import assert from "node:assert/strict";
import test from "node:test";

import {
  isWorkspaceIdentityMismatchMessage,
  resolveWorkspaceIdentitySelection,
} from "./auth-identities";

const identities = [
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
  {
    membershipId: "member-3",
    workspaceId: "workspace-2",
    workspaceName: "Workspace 2",
    roles: ["organization_owner", "workspace_admin"],
  },
];

test("resolveWorkspaceIdentitySelection keeps the current workspace identity when it already matches", () => {
  const selection = resolveWorkspaceIdentitySelection({
    identities,
    targetWorkspaceId: "workspace-1",
    activeMembershipId: "member-1",
    activeRole: "workspace_admin",
  });

  assert.deepEqual(selection, {
    needsSwitch: false,
    selectedMembershipId: "member-1",
    selectedRole: "workspace_admin",
    workspaceId: "workspace-1",
  });
});

test("resolveWorkspaceIdentitySelection preserves the active role in the target workspace when available", () => {
  const selection = resolveWorkspaceIdentitySelection({
    identities,
    targetWorkspaceId: "workspace-2",
    activeMembershipId: "member-1",
    activeRole: "developer",
  });

  assert.deepEqual(selection, {
    needsSwitch: true,
    selectedMembershipId: "member-2",
    selectedRole: "developer",
    workspaceId: "workspace-2",
  });
});

test("resolveWorkspaceIdentitySelection falls back to the highest-priority role when the active role is unavailable", () => {
  const selection = resolveWorkspaceIdentitySelection({
    identities,
    targetWorkspaceId: "workspace-2",
    activeMembershipId: "member-1",
    activeRole: "billing_admin",
  });

  assert.deepEqual(selection, {
    needsSwitch: true,
    selectedMembershipId: "member-3",
    selectedRole: "organization_owner",
    workspaceId: "workspace-2",
  });
});

test("resolveWorkspaceIdentitySelection returns null when the target workspace has no available identity", () => {
  const selection = resolveWorkspaceIdentitySelection({
    identities,
    targetWorkspaceId: "workspace-missing",
    activeMembershipId: "member-1",
    activeRole: "workspace_admin",
  });

  assert.equal(selection, null);
});

test("isWorkspaceIdentityMismatchMessage only matches the recoverable active-identity error", () => {
  assert.equal(
    isWorkspaceIdentityMismatchMessage(
      "The current active identity does not have access to this workspace",
    ),
    true,
  );
  assert.equal(
    isWorkspaceIdentityMismatchMessage(
      "No active workspace membership was found for this request",
    ),
    false,
  );
});
