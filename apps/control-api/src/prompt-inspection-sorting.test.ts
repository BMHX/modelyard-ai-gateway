import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  appendPromptInspection,
  createDatabase,
  createOrganization,
  createWorkspace,
  listPromptInspections,
  listPromptInspectionsForExport,
  runMigrations,
  type Database,
} from "@teamops/database";

async function createSortingDatabase() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "prompt-inspection-sorting-"));
  const databaseUrl = `pglite://${tempDir}/db`;
  const db = createDatabase(databaseUrl);
  await runMigrations(db);
  return {
    db,
    tempDir,
  };
}

async function seedPromptInspectionSortingRows(db: Database) {
  const organization = await createOrganization(db, {
    name: "Sorting Org",
  });
  const workspace = await createWorkspace(db, {
    organizationId: organization.id,
    name: "Sorting Workspace",
  });

  const rows = [
    {
      requestId: "req-a",
      verdict: "review" as const,
      reviewStatus: "pending" as const,
      score: 40,
      provider: "openai" as const,
      model: "model-c",
      createdAt: "2026-04-17T08:00:00.000Z",
    },
    {
      requestId: "req-b",
      verdict: "block" as const,
      reviewStatus: "confirmed_violation" as const,
      score: 90,
      provider: "anthropic" as const,
      model: "model-b",
      createdAt: "2026-04-17T09:00:00.000Z",
    },
    {
      requestId: "req-c",
      verdict: "allow_with_record" as const,
      reviewStatus: "confirmed_benign" as const,
      score: 10,
      provider: "vertex" as const,
      model: "model-a",
      createdAt: "2026-04-17T11:00:00.000Z",
    },
    {
      requestId: "req-d",
      verdict: "review" as const,
      reviewStatus: "needs_followup" as const,
      score: 70,
      provider: "bedrock" as const,
      model: "model-d",
      createdAt: "2026-04-17T10:00:00.000Z",
    },
  ];

  for (const row of rows) {
    const inspection = await appendPromptInspection(db, {
      workspaceId: workspace.id,
      requestId: row.requestId,
      provider: row.provider,
      model: row.model,
      verdict: row.verdict,
      score: row.score,
      topActivityLabel: "unknown",
      riskCategories: ["personal_use"],
      hitRuleIds: [`rule-${row.requestId}`],
      redactedEvidence: [`evidence-${row.requestId}`],
      reviewStatus: row.reviewStatus,
    });

    await db.query("update prompt_inspections set created_at = $2::timestamptz where id = $1", [
      inspection.id,
      row.createdAt,
    ]);
  }

  return workspace.id;
}

test("prompt inspection list and export honor supported sort orders", async () => {
  const { db, tempDir } = await createSortingDatabase();

  try {
    const workspaceId = await seedPromptInspectionSortingRows(db);
    const expectedOrders = {
      newest: ["req-c", "req-d", "req-b", "req-a"],
      oldest: ["req-a", "req-b", "req-d", "req-c"],
      score_desc: ["req-b", "req-d", "req-a", "req-c"],
      score_asc: ["req-c", "req-a", "req-d", "req-b"],
      verdict_priority: ["req-b", "req-d", "req-a", "req-c"],
      review_status_priority: ["req-a", "req-d", "req-b", "req-c"],
      provider_asc: ["req-b", "req-d", "req-a", "req-c"],
      model_asc: ["req-c", "req-b", "req-a", "req-d"],
    } as const;

    for (const [sortBy, expectedRequestIds] of Object.entries(expectedOrders)) {
      const listResult = await listPromptInspections(db, {
        workspaceId,
        sortBy: sortBy as keyof typeof expectedOrders,
        limit: 25,
        offset: 0,
      });
      assert.deepEqual(
        listResult.items.map((item) => item.requestId),
        expectedRequestIds,
        `listPromptInspections should honor ${sortBy}`,
      );

      const exportResult = await listPromptInspectionsForExport(db, {
        workspaceId,
        sortBy: sortBy as keyof typeof expectedOrders,
      });
      assert.deepEqual(
        exportResult.map((item) => item.requestId),
        expectedRequestIds,
        `listPromptInspectionsForExport should honor ${sortBy}`,
      );
    }
  } finally {
    await db.end();
    await rm(tempDir, {
      force: true,
      recursive: true,
    });
  }
});
