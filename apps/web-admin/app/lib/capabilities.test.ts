import assert from "node:assert/strict";
import test from "node:test";

import { getCapabilitiesFromPermissions } from "./capabilities";

const basePermissions = {
  projects: false,
  budgets: false,
  usage: false,
  providers: false,
  virtualKeys: false,
  selfServeVirtualKeys: false,
  auditLogs: false,
  exports: false,
  members: false,
  promptInspections: false,
  promptInspectionReview: false,
  promptPolicyWrite: false,
} as const;

test("admin surface access only turns on for admin-only write capabilities", () => {
  const developerCapabilities = getCapabilitiesFromPermissions({
    ...basePermissions,
    budgets: true,
    members: true,
    providers: true,
    usage: true,
    virtualKeys: true,
    selfServeVirtualKeys: true,
    auditLogs: true,
    exports: true,
    promptInspections: true,
  });

  assert.equal(developerCapabilities.isManager, true);
  assert.equal(developerCapabilities.canAccessAdminSurfaces, false);

  const workspaceAdminCapabilities = getCapabilitiesFromPermissions({
    ...basePermissions,
    projects: true,
    budgets: true,
    usage: true,
    providers: true,
    virtualKeys: true,
    auditLogs: true,
    exports: true,
    members: true,
    promptInspections: true,
    promptInspectionReview: true,
    promptPolicyWrite: true,
  });

  assert.equal(workspaceAdminCapabilities.canAccessAdminSurfaces, true);
});
