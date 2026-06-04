import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";

type DbRow = Record<string, unknown>;

function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, " ").trim().toLowerCase();
}

const exportsDir = await mkdtemp(path.join(os.tmpdir(), "teamops-export-jobs-test-"));
process.env.EXPORT_JOBS_DIR = exportsDir;

const { startExportWorker } = await import("./index.ts");

function createFakeDatabase(seed: {
  exportJobs: DbRow[];
  usageEvents: DbRow[];
}) {
  const state = {
    exportJobs: [...seed.exportJobs],
    usageEvents: [...seed.usageEvents],
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

      if (normalized.includes("select distinct object_key from export_jobs where object_key is not null")) {
        const rows = state.exportJobs
          .map((row) => row.object_key)
          .filter((value): value is string => typeof value === "string" && value.length > 0)
          .map((objectKey) => ({ object_key: objectKey }));
        return {
          rowCount: rows.length,
          rows,
        };
      }

      if (
        normalized.includes("update export_jobs set status = 'pending'") &&
        normalized.includes("where status = 'running'")
      ) {
        return {
          rowCount: 0,
          rows: [],
        };
      }

      if (
        normalized.includes("select * from scheduled_reports") &&
        normalized.includes("where next_run_at <= $1") &&
        normalized.includes("for update skip locked")
      ) {
        return {
          rowCount: 0,
          rows: [],
        };
      }

      if (normalized.includes("with next_job as ( select id from export_jobs where status = 'pending'")) {
        const row =
          [...state.exportJobs]
            .filter((job) => String(job.status) === "pending")
            .sort((left, right) => String(left.created_at).localeCompare(String(right.created_at)))[0] ?? null;

        if (!row) {
          return {
            rowCount: 0,
            rows: [],
          };
        }

        row.status = "running";
        row.error_message = null;
        row.completed_at = null;
        row.started_at = new Date().toISOString();
        row.attempt_count = Number(row.attempt_count ?? 0) + 1;

        return {
          rowCount: 1,
          rows: [row],
        };
      }

      if (
        normalized.includes("select * from usage_events") &&
        normalized.includes("where 1 = 1") &&
        normalized.includes("order by")
      ) {
        return {
          rowCount: state.usageEvents.length,
          rows: state.usageEvents,
        };
      }

      if (normalized.includes("update export_jobs set status = 'completed'")) {
        const exportJobId = String(values[0]);
        const row = state.exportJobs.find((job) => String(job.id) === exportJobId) ?? null;
        if (!row) {
          return {
            rowCount: 0,
            rows: [],
          };
        }

        row.status = "completed";
        row.object_key = values[1];
        row.row_count = values[2];
        row.error_message = null;
        row.completed_at = new Date().toISOString();

        return {
          rowCount: 1,
          rows: [row],
        };
      }

      if (normalized.includes("update export_jobs set status = 'failed'")) {
        const exportJobId = String(values[0]);
        const row = state.exportJobs.find((job) => String(job.id) === exportJobId) ?? null;
        if (!row) {
          return {
            rowCount: 0,
            rows: [],
          };
        }

        row.status = "failed";
        row.error_message = values[1];
        row.completed_at = new Date().toISOString();

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

        state.auditLogs.unshift(row);
        return {
          rowCount: 1,
          rows: [row],
        };
      }

      throw new Error(`Unhandled fake DB query in export-jobs index.test.ts: ${normalized}`);
    },
  };

  return { state, db };
}

async function waitFor(check: () => boolean, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (check()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  assert.fail(`Condition was not met within ${timeoutMs}ms`);
}

test("startExportWorker records started and completed audit logs for usage exports", async () => {
  const workspaceId = "1f556d8b-31f2-4d1a-8290-b31949109f3d";
  const exportJobId = randomUUID();
  const createdAt = new Date(Date.now() - 60_000).toISOString();
  const { state, db } = createFakeDatabase({
    exportJobs: [
      {
        id: exportJobId,
        workspace_id: workspaceId,
        kind: "usage-events",
        format: "csv",
        status: "pending",
        file_name: "usage-report.csv",
        filters: {
          workspaceId,
        },
        object_key: null,
        row_count: null,
        error_message: null,
        created_at: createdAt,
        started_at: null,
        completed_at: null,
        attempt_count: 0,
      },
    ],
    usageEvents: [
      {
        id: randomUUID(),
        workspace_id: workspaceId,
        project_id: null,
        environment_id: null,
        virtual_key_id: null,
        provider_connection_id: null,
        request_id: "req_export_test",
        provider_request_id: "upstream_export_test",
        provider: "openai",
        model: "gpt-4.1-mini",
        prompt_tokens: 12,
        completion_tokens: 8,
        cost_usd: "0.123456",
        latency_ms: 231,
        status: "success",
        metadata: {
          route: "/v1/chat/completions",
        },
        created_at: createdAt,
      },
    ],
  });

  const stopWorker = startExportWorker(db, {
    idleDelayMs: 250,
    errorDelayMs: 250,
    logger: {
      info: () => undefined,
      error: () => undefined,
    },
  });

  try {
    await waitFor(() =>
      state.auditLogs.some((row) => row.action === "export.started") &&
      state.auditLogs.some((row) => row.action === "export.completed"),
    );
  } finally {
    stopWorker();
  }

  const startedLog = state.auditLogs.find((row) => row.action === "export.started") ?? null;
  const completedLog = state.auditLogs.find((row) => row.action === "export.completed") ?? null;
  const job = state.exportJobs[0];

  assert.ok(startedLog);
  assert.ok(completedLog);
  assert.equal(job?.status, "completed");
  assert.equal(job?.attempt_count, 1);
  assert.equal(job?.row_count, 1);
  assert.equal((startedLog?.payload as Record<string, unknown>)?.attemptCount, 1);
  assert.equal((completedLog?.payload as Record<string, unknown>)?.rowCount, 1);
  assert.equal((completedLog?.payload as Record<string, unknown>)?.attemptCount, 1);
  assert.equal(typeof (completedLog?.payload as Record<string, unknown>)?.durationMs, "number");
  assert.equal((completedLog?.payload as Record<string, unknown>)?.durationMs !== null, true);

  const exportFilePath = path.join(exportsDir, `${exportJobId}.csv`);
  const exportFileContents = await readFile(exportFilePath, "utf8");
  const exportFiles = await readdir(exportsDir);

  assert.match(exportFileContents, /created_at,workspace_id,project_id,environment_id/);
  assert.equal(exportFiles.some((fileName) => fileName.includes(".tmp-")), false);
});

after(async () => {
  await rm(exportsDir, {
    force: true,
    recursive: true,
  });
});
