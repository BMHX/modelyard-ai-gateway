import assert from "node:assert/strict";
import test from "node:test";

import {
  filterBudgetSummariesForAssignedProjects,
  summarizeWorkspaceSetupCounts,
} from "./routes/workspaces.js";

test("budget visibility keeps workspace-wide budgets alongside assigned project budgets", () => {
  const visible = filterBudgetSummariesForAssignedProjects(
    [
      {
        id: "budget-workspace",
        projectId: null,
      },
      {
        id: "budget-project-a",
        projectId: "project-a",
      },
      {
        id: "budget-project-b",
        projectId: "project-b",
      },
    ] as never,
    new Set(["project-a"]),
  );

  assert.deepEqual(
    visible.map((budget) => budget.id),
    ["budget-workspace", "budget-project-a"],
  );
});

test("setup summary counts stay inside the assigned project scope while preserving workspace-wide members", () => {
  const counts = summarizeWorkspaceSetupCounts({
    projects: [
      {
        id: "project-a",
        status: "active",
      },
      {
        id: "project-b",
        status: "active",
      },
    ] as never,
    environments: [
      {
        id: "env-a",
        projectId: "project-a",
        status: "active",
      },
      {
        id: "env-b",
        projectId: "project-b",
        status: "active",
      },
    ] as never,
    providerConnections: [
      {
        id: "provider-a",
        status: "active",
        lastTestStatus: "passed",
      },
    ] as never,
    virtualKeyInventorySummary: {
      total: 1,
      active: 1,
      revoked: 0,
      expired: 0,
      neverUsed: 0,
      environmentBound: 0,
    },
    members: [
      {
        id: "workspace-admin",
        role: "workspace_admin",
        status: "active",
      },
      {
        id: "developer-a",
        role: "developer",
        status: "active",
      },
      {
        id: "developer-b",
        role: "developer",
        status: "active",
      },
    ] as never,
    assignments: [
      {
        memberId: "developer-a",
        projectId: "project-a",
      },
      {
        memberId: "developer-b",
        projectId: "project-b",
      },
    ] as never,
    assignedProjectIds: new Set(["project-a"]),
  });

  assert.deepEqual(counts, {
    projectCount: 1,
    environmentCount: 1,
    activeProviderCount: 1,
    readyProviderCount: 1,
    activeVirtualKeyCount: 1,
    memberCount: 2,
    scopedMembersWithoutProjects: 0,
  });
});
