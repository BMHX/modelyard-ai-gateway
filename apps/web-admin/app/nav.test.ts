import assert from "node:assert/strict";
import test from "node:test";

import { EMPTY_CAPABILITIES } from "./lib/capabilities";
import { getNavSections } from "./nav";

test("unresolved capabilities do not render admin navigation by default", () => {
  const sections = getNavSections(EMPTY_CAPABILITIES);

  assert.deepEqual(sections, []);
});

test("self-serve identities keep access in navigation", () => {
  const sections = getNavSections({
    ...EMPTY_CAPABILITIES,
    canAccessDeveloperTools: true,
    canSelfServeVirtualKeys: true,
  });

  assert.deepEqual(
    sections.map((section) => section.items.map((item) => item.href)),
    [["/models", "/access"]],
  );
});

test("admin identities do not show access in navigation", () => {
  const sections = getNavSections({
    ...EMPTY_CAPABILITIES,
    canAccessAdminSurfaces: true,
    canAccessDeveloperTools: true,
    canManageGovernance: true,
    canManageInfrastructure: true,
    canManageMembers: true,
    canManageProjects: true,
    canReviewPrompts: true,
    canViewUsage: true,
    isAdvancedUser: true,
    isManager: true,
  });

  assert.equal(
    sections.some((section) => section.items.some((item) => item.href === "/access")),
    false,
  );
  assert.equal(
    sections.some((section) => section.items.some((item) => item.href === "/virtual-keys")),
    true,
  );
});
