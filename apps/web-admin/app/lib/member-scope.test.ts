import assert from "node:assert/strict";
import test from "node:test";

import { memberUsesProjectAssignments } from "@teamops/contracts";

test("member scope stays project-scoped when developer is a secondary role", () => {
  assert.equal(
    memberUsesProjectAssignments({
      role: "workspace_admin",
      roles: ["workspace_admin", "developer"],
    }),
    true,
  );
});

test("member scope stays workspace-wide when developer is absent", () => {
  assert.equal(
    memberUsesProjectAssignments({
      role: "workspace_admin",
      roles: ["workspace_admin"],
    }),
    false,
  );
});
