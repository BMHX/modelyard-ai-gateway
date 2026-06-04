import assert from "node:assert/strict";
import test from "node:test";

import type { Environment } from "@teamops/contracts";

import { formatEnvironmentOptionLabel } from "./resource-scope";

function makeEnvironment(input: Pick<Environment, "id" | "projectId" | "name" | "runtime" | "status">): Environment {
  return {
    ...input,
    slug: input.id,
    workspaceId: "workspace_core",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

test("formatEnvironmentOptionLabel localizes translated environment names for Chinese", () => {
  assert.equal(
    formatEnvironmentOptionLabel(
      makeEnvironment({
        id: "env_prod",
        projectId: "project_core",
        name: "Production",
        runtime: "production",
        status: "active",
      }),
      "zh",
    ),
    "生产",
  );

  assert.equal(
    formatEnvironmentOptionLabel(
      makeEnvironment({
        id: "env_stage",
        projectId: "project_core",
        name: "Staging",
        runtime: "staging",
        status: "active",
      }),
      "zh",
    ),
    "预发",
  );
});

test("formatEnvironmentOptionLabel keeps explicit custom names with localized runtime context", () => {
  assert.equal(
    formatEnvironmentOptionLabel(
      makeEnvironment({
        id: "env_internal",
        projectId: "project_core",
        name: "内部灰度",
        runtime: "staging",
        status: "active",
      }),
      "zh",
    ),
    "内部灰度 (预发)",
  );
});
