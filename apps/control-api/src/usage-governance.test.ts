import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import type { WorkspaceAccess } from "./permissions.js";
import { getExportApprovalActor } from "./routes/usage.js";

function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, " ").trim().toLowerCase();
}

test("export approval actor ignores explicit actor headers for workspace members", async () => {
  const actor = await getExportApprovalActor(
    {
      query() {
        throw new Error("member approval should not query the database");
      },
    } as never,
    {
      isAdmin: false,
      member: {
        id: randomUUID(),
        workspaceId: randomUUID(),
        email: "approver@example.com",
        name: "Approver",
        role: "workspace_admin",
        status: "active",
        temporaryAccessExpiresAt: null,
        lastLoginAt: null,
        lastActiveAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    } satisfies WorkspaceAccess,
    {
      headers: {
        "x-actor-type": "service",
        "x-actor-id": "spoofed-service",
      },
    },
    randomUUID(),
  );

  assert.deepEqual(actor, {
    actorType: "member",
    actorId: "approver@example.com",
    label: "approver@example.com",
  });
});

test("export approval actor prefers the resolved workspace member over explicit actor headers for admin requests", async () => {
  const workspaceId = randomUUID();
  const actor = await getExportApprovalActor(
    {
      async query(sql: string, values: unknown[] = []) {
        const normalized = normalizeSql(sql);
        if (
          normalized.includes("select * from members where workspace_id = $1") &&
          normalized.includes("and lower(email) = lower($2)")
        ) {
          assert.equal(String(values[0]), workspaceId);
          assert.equal(String(values[1]), "approver@example.com");
          return {
            rowCount: 1,
            rows: [
              {
                id: randomUUID(),
                workspace_id: workspaceId,
                email: "approver@example.com",
                name: "Approver",
                role: "workspace_admin",
                status: "active",
                temporary_access_expires_at: null,
                last_login_at: null,
                last_active_at: null,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              },
            ],
          };
        }

        throw new Error(`Unhandled query: ${normalized}`);
      },
    } as never,
    {
      isAdmin: true,
      member: null,
    } satisfies WorkspaceAccess,
    {
      headers: {
        "x-member-email": "approver@example.com",
        "x-actor-type": "service",
        "x-actor-id": "spoofed-service",
      },
    },
    workspaceId,
  );

  assert.deepEqual(actor, {
    actorType: "member",
    actorId: "approver@example.com",
    label: "approver@example.com",
  });
});

test("export approval actor falls back to bootstrap for admin requests without a resolved member identity", async () => {
  const actor = await getExportApprovalActor(
    {
      async query() {
        return {
          rowCount: 0,
          rows: [],
        };
      },
    } as never,
    {
      isAdmin: true,
      member: null,
    } satisfies WorkspaceAccess,
    {
      headers: {
        "x-actor-type": "service",
        "x-actor-id": "spoofed-service",
      },
    },
    randomUUID(),
  );

  assert.deepEqual(actor, {
    actorType: "system",
    actorId: "bootstrap",
    label: "control-api-admin",
  });
});
