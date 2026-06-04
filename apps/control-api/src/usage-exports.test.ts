import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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
  memberProjectAssignments?: DbRow[];
  environments?: DbRow[];
  exportJobs?: DbRow[];
}) {
  const state = {
    members: [...(seed?.members ?? [])] as DbRow[],
    memberProjectAssignments: [...(seed?.memberProjectAssignments ?? [])] as DbRow[],
    environments: [...(seed?.environments ?? [])] as DbRow[],
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
        normalized.includes("select project_id from member_project_assignments where member_id = $1")
      ) {
        const memberId = String(values[0]);
        const rows = state.memberProjectAssignments
          .filter((item) => String(item.member_id) === memberId)
          .sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)));

        return {
          rowCount: rows.length,
          rows,
        };
      }

      if (normalized.includes("select * from environments where id = $1 limit 1")) {
        const environmentId = String(values[0]);
        const row = state.environments.find((item) => String(item.id) === environmentId) ?? null;

        return {
          rowCount: row ? 1 : 0,
          rows: row ? [row] : [],
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
          completed_at: null,
        } satisfies DbRow;

        state.exportJobs.unshift(row);
        return {
          rowCount: 1,
          rows: [row],
        };
      }

      if (normalized.includes("select * from export_jobs where workspace_id = $1 order by created_at desc")) {
        const workspaceId = String(values[0]);
        const rows = state.exportJobs
          .filter((item) => String(item.workspace_id) === workspaceId)
          .sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)));

        return {
          rowCount: rows.length,
          rows,
        };
      }

      if (
        normalized.includes("select id, workspace_id, kind, file_name, object_key, status, filters") &&
        normalized.includes("from export_jobs") &&
        normalized.includes("where id = $1 limit 1")
      ) {
        const exportJobId = String(values[0]);
        const row = state.exportJobs.find((item) => String(item.id) === exportJobId) ?? null;

        return {
          rowCount: row ? 1 : 0,
          rows: row ? [row] : [],
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

      if (
        normalized.includes("select id from audit_logs") &&
        normalized.includes("where workspace_id = $1") &&
        normalized.includes("and action = $2") &&
        normalized.includes("limit 1")
      ) {
        const workspaceId = String(values[0]);
        const action = String(values[1]);
        const row =
          state.auditLogs.find(
            (item) => String(item.workspace_id) === workspaceId && String(item.action) === action,
          ) ?? null;

        return {
          rowCount: row ? 1 : 0,
          rows: row ? [{ id: row.id }] : [],
        };
      }

      if (
        normalized.includes("update members") &&
        normalized.includes("set last_active_at = $2::timestamptz") &&
        normalized.includes("last_login_at = case")
      ) {
        const memberId = String(values[0]);
        const row = state.members.find((item) => String(item.id) === memberId) ?? null;
        if (!row) {
          return {
            rowCount: 0,
            rows: [],
          };
        }

        row.last_active_at = values[1];
        if (Boolean(values[2]) || !row.last_login_at) {
          row.last_login_at = values[1];
        }

        return {
          rowCount: 1,
          rows: [row],
        };
      }

      throw new Error(`Unhandled fake DB query in usage-exports.test.ts: ${normalized}`);
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

test("developer can create, list, and scope-check environment exports", async () => {
  const workspaceId = "f3c8cd7c-e6cf-441c-b3a4-4d5858fa7127";
  const memberId = "33d7a315-5782-4f52-a431-ca66cc5cb5e9";
  const projectId = "6ea2a853-9636-4418-a93a-fda593c0bc88";
  const environmentId = "a9cb56cc-9652-4fd8-8da0-456db33b7c0f";
  const createdAt = createTimestamp(-5_000);
  const { state, context } = createFakeControlApiContext({
    members: [
      {
        id: memberId,
        workspace_id: workspaceId,
        email: "finance@example.com",
        name: "Finance",
        role: "developer",
        status: "active",
        created_at: createdAt,
        updated_at: createdAt,
      },
    ],
    memberProjectAssignments: [
      {
        member_id: memberId,
        project_id: projectId,
        created_at: createTimestamp(-4_000),
      },
    ],
    environments: [
      {
        id: environmentId,
        workspace_id: workspaceId,
        project_id: projectId,
        slug: "prod",
        name: "Production",
        runtime: "production",
        status: "active",
        created_at: createdAt,
        updated_at: createdAt,
      },
    ],
  });
  const app = await buildControlApi(context);

  try {
    const createResponse = await app.inject({
      method: "POST",
      url: "/v1/export-jobs",
      headers: {
        "x-member-email": "finance@example.com",
      },
      payload: {
        workspaceId,
        kind: "usage-events",
        format: "csv",
        filters: {
          environmentId,
        },
      },
    });

    assert.equal(createResponse.statusCode, 201);
    const created = createResponse.json();
    assert.equal(created.workspaceId, workspaceId);
    assert.equal(created.filters.environmentId, environmentId);
    assert.deepEqual(created.filters.projectIds, [projectId]);
    assert.equal(created.startedAt, null);
    assert.equal(created.attemptCount, 0);
    assert.equal(state.auditLogs[0]?.action, "workspace.onboarding.first_export_requested");
    assert.equal(state.auditLogs[1]?.action, "export.requested");

    const listResponse = await app.inject({
      method: "GET",
      url: `/v1/export-jobs?workspaceId=${workspaceId}`,
      headers: {
        "x-member-email": "finance@example.com",
      },
    });

    assert.equal(listResponse.statusCode, 200);
    const listed = listResponse.json() as { items: Array<Record<string, unknown>> };
    assert.equal(listed.items.length, 1);
    assert.equal(listed.items[0]?.id, created.id);

    const downloadResponse = await app.inject({
      method: "GET",
      url: `/v1/export-jobs/${created.id}/download`,
      headers: {
        "x-member-email": "finance@example.com",
      },
    });

    assert.equal(downloadResponse.statusCode, 404);
    assert.equal(downloadResponse.json().error.message, "Export file not found");

    const secondCreateResponse = await app.inject({
      method: "POST",
      url: "/v1/export-jobs",
      headers: {
        "x-member-email": "finance@example.com",
      },
      payload: {
        workspaceId,
        kind: "audit-logs",
        format: "xlsx",
        filters: {
          projectId,
        },
      },
    });

    assert.equal(secondCreateResponse.statusCode, 201);
    assert.equal(
      state.auditLogs.filter((entry) => entry.action === "workspace.onboarding.first_export_requested").length,
      1,
    );
  } finally {
    await app.close();
  }
});

test("legacy environment-scoped exports stay visible inside project scope and remain blocked outside it", async () => {
  const workspaceId = "c15e58a0-d683-4b79-b8f2-ebdd6635ec9f";
  const memberId = "bdd4535f-f1b8-4187-b61c-43c5cf56b0be";
  const assignedProjectId = "ed4fe8f4-3f2c-4a14-a8c7-709e3bbaf2d3";
  const otherProjectId = "7b6a8c2a-b604-4de3-b75d-68ba06d66f8e";
  const assignedEnvironmentId = "f67e2ac4-120d-4140-b86b-e41cf9d0a607";
  const otherEnvironmentId = "88fb7094-1f96-42fe-a90b-83acc5a46a3e";
  const createdAt = createTimestamp(-10_000);
  const allowedExportJobId = randomUUID();
  const blockedExportJobId = randomUUID();
  const { context } = createFakeControlApiContext({
    members: [
      {
        id: memberId,
        workspace_id: workspaceId,
        email: "finance@example.com",
        name: "Finance",
        role: "developer",
        status: "active",
        created_at: createdAt,
        updated_at: createdAt,
      },
    ],
    memberProjectAssignments: [
      {
        member_id: memberId,
        project_id: assignedProjectId,
        created_at: createTimestamp(-9_000),
      },
    ],
    environments: [
      {
        id: assignedEnvironmentId,
        workspace_id: workspaceId,
        project_id: assignedProjectId,
        slug: "staging",
        name: "Staging",
        runtime: "staging",
        status: "active",
        created_at: createdAt,
        updated_at: createdAt,
      },
      {
        id: otherEnvironmentId,
        workspace_id: workspaceId,
        project_id: otherProjectId,
        slug: "prod",
        name: "Production",
        runtime: "production",
        status: "active",
        created_at: createdAt,
        updated_at: createdAt,
      },
    ],
    exportJobs: [
      {
        id: allowedExportJobId,
        workspace_id: workspaceId,
        kind: "audit-logs",
        format: "csv",
        status: "pending",
        file_name: "audit-export.csv",
        filters: {
          workspaceId,
          environmentId: assignedEnvironmentId,
        },
        object_key: null,
        row_count: null,
        error_message: null,
        created_at: createTimestamp(-1_000),
        completed_at: null,
      },
      {
        id: blockedExportJobId,
        workspace_id: workspaceId,
        kind: "usage-events",
        format: "csv",
        status: "pending",
        file_name: "usage-export.csv",
        filters: {
          workspaceId,
          environmentId: otherEnvironmentId,
        },
        object_key: null,
        row_count: null,
        error_message: null,
        created_at: createTimestamp(-2_000),
        completed_at: null,
      },
    ],
  });
  const app = await buildControlApi(context);

  try {
    const listResponse = await app.inject({
      method: "GET",
      url: `/v1/export-jobs?workspaceId=${workspaceId}`,
      headers: {
        "x-member-email": "finance@example.com",
      },
    });

    assert.equal(listResponse.statusCode, 200);
    const listed = listResponse.json() as { items: Array<Record<string, unknown>> };
    assert.deepEqual(
      listed.items.map((item) => item.id),
      [allowedExportJobId],
    );

    const allowedDownloadResponse = await app.inject({
      method: "GET",
      url: `/v1/export-jobs/${allowedExportJobId}/download`,
      headers: {
        "x-member-email": "finance@example.com",
      },
    });

    assert.equal(allowedDownloadResponse.statusCode, 404);

    const blockedDownloadResponse = await app.inject({
      method: "GET",
      url: `/v1/export-jobs/${blockedExportJobId}/download`,
      headers: {
        "x-member-email": "finance@example.com",
      },
    });

    assert.equal(blockedDownloadResponse.statusCode, 403);
    assert.equal(
      blockedDownloadResponse.json().error.message,
      "This export is outside the current assigned project scope",
    );
  } finally {
    await app.close();
  }
});

test("member-scoped export requests reject explicit projectIds outside the assigned scope", async () => {
  const workspaceId = "bbd6f6fd-f0d8-4786-9fe8-2a766cb80442";
  const memberId = "59ca3256-9cf5-4477-a5e4-db5da5d8f957";
  const assignedProjectId = "4469ed7f-596c-4901-b2da-f7ce5026e728";
  const otherProjectId = "581936fd-c719-4424-ae20-cd0ebcf91f6d";
  const createdAt = createTimestamp(-5_000);
  const { state, context } = createFakeControlApiContext({
    members: [
      {
        id: memberId,
        workspace_id: workspaceId,
        email: "finance@example.com",
        name: "Finance",
        role: "developer",
        status: "active",
        created_at: createdAt,
        updated_at: createdAt,
      },
    ],
    memberProjectAssignments: [
      {
        member_id: memberId,
        project_id: assignedProjectId,
        created_at: createTimestamp(-4_000),
      },
    ],
  });
  const app = await buildControlApi(context);

  try {
    const response = await app.inject({
      method: "POST",
      url: "/v1/export-jobs",
      headers: {
        "x-member-email": "finance@example.com",
      },
      payload: {
        workspaceId,
        kind: "usage-events",
        format: "csv",
        filters: {
          projectIds: [assignedProjectId, otherProjectId],
        },
      },
    });

    assert.equal(response.statusCode, 403);
    assert.equal(
      response.json().error.message,
      "One or more requested projects are outside the current assigned project scope",
    );
    assert.equal(state.exportJobs.length, 0);
  } finally {
    await app.close();
  }
});

test("completed export downloads are audited when the file is served", async () => {
  const workspaceId = "ae4c77f6-fded-4cc8-84cd-b6342529e4b0";
  const memberId = "56e4be37-6db4-4019-81dd-e95737769b31";
  const projectId = "bf4b4430-5205-4546-a3d7-d75b66f3957e";
  const environmentId = "9f5dfb95-ad8a-40be-bf37-1a2d6ae8c59a";
  const exportJobId = randomUUID();
  const objectKey = `${exportJobId}.csv`;
  const exportsDir = path.join(os.tmpdir(), "teamops-control-api", "exports");
  const exportFilePath = path.join(exportsDir, objectKey);
  const createdAt = createTimestamp(-5_000);
  const { state, context } = createFakeControlApiContext({
    members: [
      {
        id: memberId,
        workspace_id: workspaceId,
        email: "finance@example.com",
        name: "Finance",
        role: "developer",
        status: "active",
        created_at: createdAt,
        updated_at: createdAt,
      },
    ],
    memberProjectAssignments: [
      {
        member_id: memberId,
        project_id: projectId,
        created_at: createTimestamp(-4_000),
      },
    ],
    environments: [
      {
        id: environmentId,
        workspace_id: workspaceId,
        project_id: projectId,
        slug: "prod",
        name: "Production",
        runtime: "production",
        status: "active",
        created_at: createdAt,
        updated_at: createdAt,
      },
    ],
    exportJobs: [
      {
        id: exportJobId,
        workspace_id: workspaceId,
        kind: "usage-events",
        format: "csv",
        status: "completed",
        file_name: "usage-export.csv",
        filters: {
          workspaceId,
          projectId,
          environmentId,
          projectIds: [projectId],
        },
        object_key: objectKey,
        row_count: 1,
        error_message: null,
        created_at: createdAt,
        completed_at: createTimestamp(-2_000),
      },
    ],
  });
  const app = await buildControlApi(context);

  await mkdir(exportsDir, { recursive: true });
  await writeFile(exportFilePath, "workspace_id\nsample-workspace\n");

  try {
    const response = await app.inject({
      method: "GET",
      url: `/v1/export-jobs/${exportJobId}/download`,
      headers: {
        "x-member-email": "finance@example.com",
      },
    });

    assert.equal(response.statusCode, 200);
    assert.match(response.headers["content-type"] ?? "", /text\/csv/);
    assert.match(response.headers["content-disposition"] ?? "", /usage-export\.csv/);
    assert.match(response.body, /workspace_id/);
    assert.equal(state.auditLogs[0]?.action, "export.downloaded");
    assert.equal(state.auditLogs[0]?.subject_id, exportJobId);
  } finally {
    await app.close();
    await rm(exportFilePath, { force: true });
  }
});
