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
  promptInspections?: DbRow[];
  memberProjectAssignments?: DbRow[];
}) {
  const state = {
    members: [...(seed?.members ?? [])] as DbRow[],
    promptInspections: [...(seed?.promptInspections ?? [])] as DbRow[],
    memberProjectAssignments: [...(seed?.memberProjectAssignments ?? [])] as DbRow[],
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
        normalized.includes("select project_id") &&
        normalized.includes("from member_project_assignments") &&
        normalized.includes("where member_id = $1")
      ) {
        const memberId = String(values[0]);
        const rows = state.memberProjectAssignments
          .filter((item) => String(item.member_id) === memberId)
          .map((item) => ({
            project_id: String(item.project_id),
          }));

        return {
          rowCount: rows.length,
          rows,
        };
      }

      if (normalized.includes("select * from prompt_inspections where id = $1 limit 1")) {
        const promptInspectionId = String(values[0]);
        const row = state.promptInspections.find((item) => String(item.id) === promptInspectionId) ?? null;
        return {
          rowCount: row ? 1 : 0,
          rows: row ? [row] : [],
        };
      }

      if (normalized.includes("select * from prompt_inspections where id = any($1::uuid[])")) {
        const inspectionIds = Array.isArray(values[0]) ? values[0].map(String) : [];
        const rows = state.promptInspections.filter((item) => inspectionIds.includes(String(item.id)));
        return {
          rowCount: rows.length,
          rows,
        };
      }

      if (
        normalized.includes("update prompt_inspections set review_status = $2") &&
        normalized.includes("where id = $1 returning *")
      ) {
        const promptInspectionId = String(values[0]);
        const row = state.promptInspections.find((item) => String(item.id) === promptInspectionId) ?? null;
        if (!row) {
          return {
            rowCount: 0,
            rows: [],
          };
        }

        row.review_status = values[1];
        row.reviewed_by = values[2];
        row.review_note = values[3];
        row.reviewed_at = new Date().toISOString();

        return {
          rowCount: 1,
          rows: [row],
        };
      }

      if (
        normalized.includes("update prompt_inspections set review_status = $2") &&
        normalized.includes("where id = any($1::uuid[])") &&
        normalized.includes("and workspace_id = $5")
      ) {
        const inspectionIds = Array.isArray(values[0]) ? values[0].map(String) : [];
        const workspaceId = String(values[4]);
        const rows = state.promptInspections.filter(
          (item) =>
            inspectionIds.includes(String(item.id)) &&
            String(item.workspace_id) === workspaceId,
        );

        for (const row of rows) {
          row.review_status = values[1];
          row.reviewed_by = values[2];
          row.review_note = values[3];
          row.reviewed_at = new Date().toISOString();
        }

        return {
          rowCount: rows.length,
          rows,
        };
      }

      if (
        normalized.includes("select count(*)::text as count from prompt_inspections") &&
        normalized.includes("workspace_id = $1")
      ) {
        const workspaceId = String(values[0]);
        const projectIds =
          Array.isArray(values[1]) && normalized.includes("project_id = any($2::uuid[])")
            ? new Set(values[1].map(String))
            : null;
        const rows = state.promptInspections.filter((item) => {
          if (String(item.workspace_id) !== workspaceId) {
            return false;
          }

          if (projectIds && !projectIds.has(String(item.project_id))) {
            return false;
          }

          return true;
        });

        return {
          rowCount: 1,
          rows: [{ count: String(rows.length) }],
        };
      }

      if (
        normalized.includes("select * from prompt_inspections") &&
        normalized.includes("workspace_id = $1") &&
        normalized.includes("order by created_at desc")
      ) {
        const workspaceId = String(values[0]);
        const projectIds =
          Array.isArray(values[1]) && normalized.includes("project_id = any($2::uuid[])")
            ? new Set(values[1].map(String))
            : null;
        const rows = state.promptInspections
          .filter((item) => {
            if (String(item.workspace_id) !== workspaceId) {
              return false;
            }

            if (projectIds && !projectIds.has(String(item.project_id))) {
              return false;
            }

            return true;
          })
          .sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)));

        return {
          rowCount: rows.length,
          rows,
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

      throw new Error(`Unhandled fake DB query in prompt-inspections.test.ts: ${normalized}`);
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

function createPromptInspectionRow(overrides: Partial<DbRow> = {}) {
  const createdAt = overrides.created_at ?? "2026-04-17T12:00:00.000Z";
  return {
    id: overrides.id ?? randomUUID(),
    workspace_id: overrides.workspace_id ?? "11111111-1111-4111-8111-111111111111",
    project_id: overrides.project_id ?? "22222222-2222-4222-8222-222222222222",
    environment_id: overrides.environment_id ?? null,
    virtual_key_id: overrides.virtual_key_id ?? "33333333-3333-4333-8333-333333333333",
    provider_connection_id: overrides.provider_connection_id ?? "44444444-4444-4444-8444-444444444444",
    usage_event_id: overrides.usage_event_id ?? "55555555-5555-4555-8555-555555555555",
    request_id: overrides.request_id ?? "req_prompt_1",
    provider: overrides.provider ?? "openai",
    model: overrides.model ?? "gpt-4.1-mini",
    verdict: overrides.verdict ?? "review",
    score: overrides.score ?? 72,
    top_activity_label: overrides.top_activity_label ?? "external_delivery",
    risk_categories: overrides.risk_categories ?? ["external_business"],
    hit_rule_ids: overrides.hit_rule_ids ?? ["external.quote"],
    redacted_evidence: overrides.redacted_evidence ?? ["客户报价草稿"],
    simhash: overrides.simhash ?? "1234abcd1234abcd",
    truncated: overrides.truncated ?? false,
    context_counts: overrides.context_counts ?? { reviewCount15m: 1 },
    review_status: overrides.review_status ?? "pending",
    reviewed_by: overrides.reviewed_by ?? null,
    review_note: overrides.review_note ?? null,
    reviewed_at: overrides.reviewed_at ?? null,
    created_at: createdAt,
  } satisfies DbRow;
}

function createMemberProjectAssignmentRow(overrides: Partial<DbRow> = {}) {
  return {
    member_id: overrides.member_id ?? randomUUID(),
    project_id: overrides.project_id ?? "22222222-2222-4222-8222-222222222222",
    created_at: overrides.created_at ?? new Date().toISOString(),
  } satisfies DbRow;
}

test("prompt inspection list allows developer reads within assigned project scope", async () => {
  const inspection = createPromptInspectionRow();
  const member = createMemberRow({
    workspace_id: inspection.workspace_id,
    email: "dev@example.com",
    role: "developer",
  });
  const assignment = createMemberProjectAssignmentRow({
    member_id: member.id,
    project_id: inspection.project_id,
  });
  const { context } = createFakeControlApiContext({
    members: [member],
    promptInspections: [inspection],
    memberProjectAssignments: [assignment],
  });
  const app = await buildControlApi(context);

  try {
    const response = await app.inject({
      method: "GET",
      url: `/v1/prompt-inspections?workspaceId=${inspection.workspace_id}`,
      headers: {
        "x-member-email": String(member.email),
      },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().items.length, 1);
    assert.equal(response.json().items[0]?.id, inspection.id);
  } finally {
    await app.close();
  }
});

test("prompt inspection review requires write permission", async () => {
  const inspection = createPromptInspectionRow();
  const member = createMemberRow({
    workspace_id: inspection.workspace_id,
    email: "dev@example.com",
    role: "developer",
  });
  const { context, state } = createFakeControlApiContext({
    members: [member],
    promptInspections: [inspection],
  });
  const app = await buildControlApi(context);

  try {
    const response = await app.inject({
      method: "PATCH",
      url: `/v1/prompt-inspections/${inspection.id}/review`,
      headers: {
        "x-member-email": String(member.email),
      },
      payload: {
        reviewStatus: "confirmed_violation",
        reviewNote: "looks bad",
      },
    });

    assert.equal(response.statusCode, 403);
    assert.equal(state.auditLogs.length, 1);
    assert.equal(state.auditLogs[0]?.action, "auth.access.denied");
    assert.equal(state.promptInspections[0]?.review_status, "pending");
  } finally {
    await app.close();
  }
});

test("prompt inspection export returns csv and records audit", async () => {
  const inspection = createPromptInspectionRow({
    review_note: "=1+1",
  });
  const member = createMemberRow({
    workspace_id: inspection.workspace_id,
    email: "admin@example.com",
    role: "workspace_admin",
  });
  const { context, state } = createFakeControlApiContext({
    members: [member],
    promptInspections: [inspection],
  });
  const app = await buildControlApi(context);

  try {
    const response = await app.inject({
      method: "GET",
      url: `/v1/prompt-inspections/export?workspaceId=${inspection.workspace_id}`,
      headers: {
        "x-member-email": String(member.email),
      },
    });

    assert.equal(response.statusCode, 200);
    assert.match(String(response.headers["content-type"] ?? ""), /text\/csv/);
    assert.match(String(response.body), /workspace_id,project_id/);
    assert.match(String(response.body), /req_prompt_1/);
    assert.match(String(response.body), /'=1\+1/);
    assert.equal(state.auditLogs[0]?.action, "prompt_inspection.exported");
  } finally {
    await app.close();
  }
});

test("prompt inspection batch review updates multiple rows and records batch audit", async () => {
  const firstInspection = createPromptInspectionRow();
  const secondInspection = createPromptInspectionRow({
    id: randomUUID(),
    request_id: "req_prompt_2",
  });
  const member = createMemberRow({
    workspace_id: firstInspection.workspace_id,
    email: "admin@example.com",
    role: "workspace_admin",
  });
  const { context, state } = createFakeControlApiContext({
    members: [member],
    promptInspections: [firstInspection, secondInspection],
  });
  const app = await buildControlApi(context);

  try {
    const response = await app.inject({
      method: "POST",
      url: "/v1/prompt-inspections/batch-review",
      headers: {
        "x-member-email": String(member.email),
      },
      payload: {
        workspaceId: firstInspection.workspace_id,
        inspectionIds: [firstInspection.id, secondInspection.id],
        reviewStatus: "confirmed_violation",
        reviewNote: "batch reviewed",
      },
    });

    assert.equal(response.statusCode, 200);
    const payload = response.json() as {
      batchId: string;
      reviewedCount: number;
      inspectionIds: string[];
      reviewStatus: string;
    };
    assert.ok(payload.batchId);
    assert.equal(payload.reviewedCount, 2);
    assert.equal(payload.reviewStatus, "confirmed_violation");
    assert.equal(state.promptInspections.every((item) => item.review_status === "confirmed_violation"), true);
    assert.equal(state.auditLogs.some((entry) => entry.action === "prompt_inspection.batch_reviewed"), true);
    assert.equal(state.auditLogs.filter((entry) => entry.action === "prompt_inspection.reviewed").length, 2);
  } finally {
    await app.close();
  }
});

test("prompt inspection batch review rejects cross-workspace ids", async () => {
  const firstInspection = createPromptInspectionRow();
  const secondInspection = createPromptInspectionRow({
    id: randomUUID(),
    workspace_id: "99999999-9999-4999-8999-999999999999",
  });
  const member = createMemberRow({
    workspace_id: firstInspection.workspace_id,
    email: "admin@example.com",
    role: "workspace_admin",
  });
  const { context, state } = createFakeControlApiContext({
    members: [member],
    promptInspections: [firstInspection, secondInspection],
  });
  const app = await buildControlApi(context);

  try {
    const response = await app.inject({
      method: "POST",
      url: "/v1/prompt-inspections/batch-review",
      headers: {
        "x-member-email": String(member.email),
      },
      payload: {
        workspaceId: firstInspection.workspace_id,
        inspectionIds: [firstInspection.id, secondInspection.id],
        reviewStatus: "confirmed_violation",
        reviewNote: "should fail",
      },
    });

    assert.equal(response.statusCode, 400);
    assert.equal(state.auditLogs.length, 0);
    assert.equal(state.promptInspections.every((item) => item.review_status === "pending"), true);
  } finally {
    await app.close();
  }
});
