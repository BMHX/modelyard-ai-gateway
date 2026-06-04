import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { buildControlApi } from "./app.js";

type DbRow = Record<string, unknown>;

function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, " ").trim().toLowerCase();
}

function createFakeControlApiContext(seed?: {
  members?: DbRow[];
  savedViews?: DbRow[];
}) {
  const state = {
    members: [...(seed?.members ?? [])] as DbRow[],
    savedViews: [...(seed?.savedViews ?? [])] as DbRow[],
    auditLogs: [] as DbRow[],
  };

  const db = {
    async query(sql: string, values: unknown[] = []) {
      const normalized = normalizeSql(sql);

      if (normalized === "begin" || normalized === "commit" || normalized === "rollback") {
        return { rowCount: 0, rows: [] };
      }

      if (
        normalized.includes("select * from members where workspace_id = $1") &&
        normalized.includes("and lower(email) = lower($2)")
      ) {
        const workspaceId = String(values[0]);
        const email = String(values[1]).toLowerCase();
        const row =
          state.members.find(
            (item) =>
              String(item.workspace_id) === workspaceId && String(item.email).toLowerCase() === email,
          ) ?? null;
        return {
          rowCount: row ? 1 : 0,
          rows: row ? [row] : [],
        };
      }

      if (
        normalized.includes("select * from saved_views") &&
        normalized.includes("where workspace_id = $1") &&
        normalized.includes("and surface = $2")
      ) {
        const workspaceId = String(values[0]);
        const surface = String(values[1]);
        const rows = state.savedViews
          .filter((item) => String(item.workspace_id) === workspaceId && String(item.surface) === surface)
          .sort((left, right) => String(right.updated_at).localeCompare(String(left.updated_at)));
        return {
          rowCount: rows.length,
          rows,
        };
      }

      if (normalized.includes("insert into saved_views")) {
        const now = new Date().toISOString();
        const row = {
          id: randomUUID(),
          workspace_id: values[0],
          surface: values[1],
          name: values[2],
          filters: JSON.parse(String(values[3])),
          created_at: now,
          updated_at: now,
          last_opened_at: null,
        } satisfies DbRow;
        state.savedViews.unshift(row);
        return {
          rowCount: 1,
          rows: [row],
        };
      }

      if (normalized.includes("select * from saved_views where id = $1 limit 1")) {
        const savedViewId = String(values[0]);
        const row = state.savedViews.find((item) => String(item.id) === savedViewId) ?? null;
        return {
          rowCount: row ? 1 : 0,
          rows: row ? [row] : [],
        };
      }

      if (normalized.includes("update saved_views set last_opened_at = now() where id = $1 returning *")) {
        const savedViewId = String(values[0]);
        const row = state.savedViews.find((item) => String(item.id) === savedViewId) ?? null;
        if (!row) {
          return { rowCount: 0, rows: [] };
        }
        row.last_opened_at = new Date().toISOString();
        return {
          rowCount: 1,
          rows: [row],
        };
      }

      if (normalized.includes("insert into audit_logs")) {
        const row = {
          id: randomUUID(),
          workspace_id: values[0],
          project_id: values[1],
          environment_id: values[2],
          actor_type: values[3],
          actor_id: values[4],
          action: values[5],
          subject_type: values[6],
          subject_id: values[7],
          payload: JSON.parse(String(values[8])),
          created_at: new Date().toISOString(),
        } satisfies DbRow;
        state.auditLogs.push(row);
        return {
          rowCount: 1,
          rows: [row],
        };
      }

      throw new Error(`Unhandled fake DB query in saved-views.test.ts: ${normalized}`);
    },
  };

  return {
    state,
    context: {
      env: {
        CONTROL_API_ADMIN_TOKEN: "test-admin-token",
      },
      db,
    } as Parameters<typeof buildControlApi>[0],
  };
}

function createMemberRow(overrides: Partial<DbRow> = {}) {
  const now = new Date().toISOString();
  return {
    id: overrides.id ?? randomUUID(),
    workspace_id: overrides.workspace_id ?? "11111111-1111-4111-8111-111111111111",
    email: overrides.email ?? "owner@example.com",
    name: overrides.name ?? "Owner",
    role: overrides.role ?? "workspace_admin",
    status: overrides.status ?? "active",
    last_login_at: overrides.last_login_at ?? now,
    last_active_at: overrides.last_active_at ?? now,
    temporary_access_expires_at: overrides.temporary_access_expires_at ?? null,
    created_at: overrides.created_at ?? now,
    updated_at: overrides.updated_at ?? now,
  } satisfies DbRow;
}

test("prompt inspection saved views can be created, listed, and opened", async () => {
  const member = createMemberRow();
  const { context, state } = createFakeControlApiContext({
    members: [member],
  });
  const app = await buildControlApi(context);

  try {
    const createResponse = await app.inject({
      method: "POST",
      url: "/v1/saved-views",
      headers: {
        "x-member-email": String(member.email),
      },
      payload: {
        workspaceId: member.workspace_id,
        surface: "prompt-inspections",
        name: "Leakage queue",
        filters: {
          verdict: "block",
          riskCategory: "secret_exfiltration",
        },
      },
    });

    assert.equal(createResponse.statusCode, 201);
    const created = createResponse.json() as { id: string };

    const listResponse = await app.inject({
      method: "GET",
      url: `/v1/saved-views?workspaceId=${member.workspace_id}&surface=prompt-inspections`,
      headers: {
        "x-member-email": String(member.email),
      },
    });

    assert.equal(listResponse.statusCode, 200);
    assert.equal((listResponse.json() as { items: Array<{ id: string }> }).items[0]?.id, created.id);

    const openResponse = await app.inject({
      method: "POST",
      url: `/v1/saved-views/${created.id}/open`,
      headers: {
        "x-member-email": String(member.email),
      },
    });

    assert.equal(openResponse.statusCode, 200);
    assert.ok(state.savedViews[0]?.last_opened_at);
    assert.equal(state.auditLogs.some((entry) => entry.action === "saved_view.opened"), true);
  } finally {
    await app.close();
  }
});
