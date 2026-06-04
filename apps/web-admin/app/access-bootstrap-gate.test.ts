import assert from "node:assert/strict";
import test from "node:test";

import { getAccessBootstrapGate } from "./[locale]/access/access-bootstrap-gate";

test("access bootstrap waits for shell session before loading member-scoped data", () => {
  assert.equal(
    getAccessBootstrapGate({
      workspaceId: "workspace-1",
      shellSessionStatus: "loading",
      identityResolution: null,
      workspaceIdentityState: {
        status: "idle",
        workspaceId: null,
      },
    }),
    "loading_session",
  );
});

test("access bootstrap waits for workspace identity switching on the requested workspace", () => {
  assert.equal(
    getAccessBootstrapGate({
      workspaceId: "workspace-1",
      shellSessionStatus: "authenticated",
      identityResolution: {
        status: "switch_required",
        workspaceId: "workspace-1",
        selectedMembershipId: "member-1",
        selectedRole: "developer",
      },
      workspaceIdentityState: {
        status: "switching",
        workspaceId: "workspace-1",
      },
    }),
    "switching_identity",
  );
});

test("access bootstrap exposes retry state when workspace identity sync failed", () => {
  assert.equal(
    getAccessBootstrapGate({
      workspaceId: "workspace-1",
      shellSessionStatus: "authenticated",
      identityResolution: {
        status: "switch_required",
        workspaceId: "workspace-1",
        selectedMembershipId: "member-1",
        selectedRole: "developer",
      },
      workspaceIdentityState: {
        status: "failed",
        workspaceId: "workspace-1",
      },
    }),
    "switch_failed",
  );
});

test("access bootstrap proceeds once the workspace identity already matches", () => {
  assert.equal(
    getAccessBootstrapGate({
      workspaceId: "workspace-1",
      shellSessionStatus: "authenticated",
      identityResolution: {
        status: "matched",
        workspaceId: "workspace-1",
        selectedMembershipId: "member-1",
        selectedRole: "developer",
      },
      workspaceIdentityState: {
        status: "ready",
        workspaceId: "workspace-1",
      },
    }),
    "ready",
  );
});
