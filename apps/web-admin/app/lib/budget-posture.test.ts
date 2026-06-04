import assert from "node:assert/strict";
import test from "node:test";

import { findActiveBudgetPolicyForScope, formatBudgetScopeLabel } from "./budget-posture";

test("formatBudgetScopeLabel localizes environment labels for Chinese budgets", () => {
  assert.equal(formatBudgetScopeLabel("environment", null, "开发", "development", "zh"), "环境 / 开发");
  assert.equal(formatBudgetScopeLabel("environment", null, "内部灰度", "staging", "zh"), "环境 / 内部灰度 (预发)");
});

test("formatBudgetScopeLabel localizes project and workspace labels for Chinese budgets", () => {
  assert.equal(formatBudgetScopeLabel("project", "结算项目", null, null, "zh"), "项目 / 结算项目");
  assert.equal(formatBudgetScopeLabel("workspace", null, null, null, "zh"), "工作区级");
});

test("formatBudgetScopeLabel keeps English output stable", () => {
  assert.equal(formatBudgetScopeLabel("environment", null, "development", "development", "en"), "environment / development");
  assert.equal(formatBudgetScopeLabel("project", "Core API", null, null, "en"), "project / Core API");
  assert.equal(formatBudgetScopeLabel("workspace", null, null, null, "en"), "workspace");
});

test("findActiveBudgetPolicyForScope matches workspace, project, and environment scopes", () => {
  const policies = [
    {
      id: "workspace-policy",
      status: "active",
      projectId: null,
      environmentId: null,
    },
    {
      id: "project-policy",
      status: "active",
      projectId: "project-1",
      environmentId: null,
    },
    {
      id: "environment-policy",
      status: "active",
      projectId: "project-1",
      environmentId: "environment-1",
    },
    {
      id: "paused-project-policy",
      status: "paused",
      projectId: "project-2",
      environmentId: null,
    },
  ] as const;

  assert.equal(
    findActiveBudgetPolicyForScope(policies as never, {
      projectId: null,
      environmentId: null,
    })?.id,
    "workspace-policy",
  );
  assert.equal(
    findActiveBudgetPolicyForScope(policies as never, {
      projectId: "project-1",
      environmentId: null,
    })?.id,
    "project-policy",
  );
  assert.equal(
    findActiveBudgetPolicyForScope(policies as never, {
      projectId: "project-1",
      environmentId: "environment-1",
    })?.id,
    "environment-policy",
  );
  assert.equal(
    findActiveBudgetPolicyForScope(policies as never, {
      projectId: "project-2",
      environmentId: null,
    }),
    null,
  );
});
