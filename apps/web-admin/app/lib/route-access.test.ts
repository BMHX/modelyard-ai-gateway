import assert from "node:assert/strict";
import test from "node:test";

import { canAccessConsoleRoute } from "./route-access";
import { EMPTY_CAPABILITIES } from "./capabilities";

test("canAccessConsoleRoute keeps home and workspaces accessible for every shell session", () => {
  assert.equal(canAccessConsoleRoute("/", EMPTY_CAPABILITIES), true);
  assert.equal(canAccessConsoleRoute("/workspaces", EMPTY_CAPABILITIES), true);
});

test("canAccessConsoleRoute maps detail routes to their parent admin surface capability", () => {
  const capabilities = {
    ...EMPTY_CAPABILITIES,
    canAccessAdminSurfaces: false,
    canManageMembers: true,
  };

  assert.equal(canAccessConsoleRoute("/providers/provider-1", capabilities), false);
  assert.equal(canAccessConsoleRoute("/members/member-1", capabilities), true);
});

test("canAccessConsoleRoute handles localized developer routes with parent capability rules", () => {
  const capabilities = {
    ...EMPTY_CAPABILITIES,
    canAccessDeveloperTools: true,
  };

  assert.equal(canAccessConsoleRoute("/zh/virtual-keys/key-1", capabilities), true);
  assert.equal(canAccessConsoleRoute("/zh/access/request-1", capabilities), true);
});
