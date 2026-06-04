import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { buildControlApi } from "./app.js";

type DbRow = Record<string, unknown>;

function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, " ").trim().toLowerCase();
}

function createTimestamp(offsetMs = 0) {
  return new Date(Date.now() + offsetMs).toISOString();
}

function createFakeControlApiContext(seed?: {
  members?: DbRow[];
  scheduledReports?: DbRow[];
  exportJobs?: DbRow[];
}) {
  const state = {
    members: [...(seed?.members ?? [])] as DbRow[],
    scheduledReports: [...(seed?.scheduledReports ?? [])] as DbRow[],
    exportJobs: [...(seed?.exportJobs ?? [])] as DbRow[],
    auditLogs: [] as DbRow[],
  };

  const db = {
    async query(sql: string, values: unknown[] = []) {
      const normalized = normalizeSql(sql);

      if (normalized === "begin" || normalized === "commit" || normalized === "rollback") {
        return {
          rowCount: 0,
          rows: [],
        };
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
        normalized.includes("select * from scheduled_reports") &&
        normalized.includes("where id = $1") &&
        normalized.includes("limit 1")
      ) {
        const scheduledReportId = String(values[0]);
        const row = state.scheduledReports.find((item) => String(item.id) === scheduledReportId) ?? null;

        return {
          rowCount: row ? 1 : 0,
          rows: row ? [row] : [],
        };
      }

      if (
        normalized.includes("select * from scheduled_reports") &&
        normalized.includes("where id = $1") &&
        normalized.includes("for update")
      ) {
        const scheduledReportId = String(values[0]);
        const row = state.scheduledReports.find((item) => String(item.id) === scheduledReportId) ?? null;

        return {
          rowCount: row ? 1 : 0,
          rows: row ? [row] : [],
        };
      }

      if (
        normalized.includes("update scheduled_reports") &&
        normalized.includes("set last_run_at = $2") &&
        normalized.includes("where id = $1") &&
        normalized.includes("returning *")
      ) {
        const scheduledReportId = String(values[0]);
        const row = state.scheduledReports.find((item) => String(item.id) === scheduledReportId) ?? null;
        if (!row) {
          return {
            rowCount: 0,
            rows: [],
          };
        }

        row.last_run_at = String(values[1]);
        if (normalized.includes("next_run_at = $3")) {
          row.next_run_at = String(values[2]);
        }
        row.updated_at = createTimestamp();

        return {
          rowCount: 1,
          rows: [row],
        };
      }

      if (normalized.includes("insert into export_jobs")) {
        const createdAt = createTimestamp();
        const row = {
          id: randomUUID(),
          workspace_id: values[0],
          kind: values[1],
          format: values[2],
          status: "pending",
          file_name: values[3],
          filters: JSON.parse(String(values[4])),
          object_key: null,
          row_count: null,
          error_message: null,
          created_at: createdAt,
          started_at: null,
          completed_at: null,
          attempt_count: 0,
        } satisfies DbRow;

        state.exportJobs.unshift(row);
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
          created_at: createTimestamp(),
        } satisfies DbRow;

        state.auditLogs.unshift(row);
        return {
          rowCount: 1,
          rows: [row],
        };
      }

      throw new Error(`Unhandled fake DB query in scheduled-reports.test.ts: ${normalized}`);
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

test("workspace admin can manually trigger a scheduled report without changing a future cadence", async () => {
  const workspaceId = "f3c8cd7c-e6cf-441c-b3a4-4d5858fa7127";
  const scheduledReportId = "f0db865e-4378-42d5-8d16-1cb0400ea0ce";
  const createdAt = createTimestamp(-10_000);
  const nextRunAt = createTimestamp(24 * 60 * 60 * 1000);
  const { state, context } = createFakeControlApiContext({
    members: [
      {
        id: "8fe81f5d-3f48-4ca5-a74f-7f6889ca1f72",
        workspace_id: workspaceId,
        email: "ops-admin@example.com",
        name: "Ops Admin",
        role: "workspace_admin",
        status: "active",
        last_active_at: createTimestamp(-60_000),
        last_login_at: createTimestamp(-60_000),
        created_at: createdAt,
        updated_at: createdAt,
      },
    ],
    scheduledReports: [
      {
        id: scheduledReportId,
        workspace_id: workspaceId,
        kind: "usage-events",
        format: "csv",
        name: "Daily finance usage",
        filters: {
          projectId: "6ea2a853-9636-4418-a93a-fda593c0bc88",
          status: "success",
        },
        cadence: "daily",
        next_run_at: nextRunAt,
        last_run_at: null,
        created_at: createdAt,
        updated_at: createdAt,
      },
    ],
  });

  const app = await buildControlApi(context);

  try {
    const response = await app.inject({
      method: "POST",
      url: `/v1/scheduled-reports/${scheduledReportId}/trigger`,
      headers: {
        "x-member-email": "ops-admin@example.com",
      },
    });

    assert.equal(response.statusCode, 202);
    const payload = response.json() as {
      scheduledReport: {
        id: string;
        nextRunAt: string;
        lastRunAt: string | null;
      };
      exportJob: {
        status: string;
        filters: Record<string, unknown>;
      };
    };

    assert.equal(payload.scheduledReport.id, scheduledReportId);
    assert.equal(payload.scheduledReport.nextRunAt, nextRunAt);
    assert.ok(payload.scheduledReport.lastRunAt);
    assert.equal(payload.exportJob.status, "pending");
    assert.equal(payload.exportJob.filters.scheduledReportId, scheduledReportId);
    assert.equal(payload.exportJob.filters.scheduledReportName, "Daily finance usage");
    assert.equal(payload.exportJob.filters.scheduledReportCadence, "daily");
    assert.equal(payload.exportJob.filters.scheduledReportTriggerSource, "manual");
    assert.equal(state.exportJobs.length, 1);
    assert.equal(state.exportJobs[0]?.workspace_id, workspaceId);
    assert.equal(state.auditLogs.length, 1);
    assert.equal(state.auditLogs[0]?.action, "scheduled_report.triggered");
    assert.equal((state.auditLogs[0]?.payload as Record<string, unknown>).triggerSource, "manual");
    assert.equal((state.auditLogs[0]?.payload as Record<string, unknown>).advancedSchedule, false);
  } finally {
    await app.close();
  }
});
