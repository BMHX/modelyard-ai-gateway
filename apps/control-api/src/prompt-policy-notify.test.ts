import assert from "node:assert/strict";
import test from "node:test";

import { upsertPromptPolicy, type Database } from "@teamops/database";

function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, " ").trim().toLowerCase();
}

test("upsertPromptPolicy emits a pg notification payload for postgres-backed databases", async () => {
  const state = {
    notified: [] as Array<{ channel: string; payload: string }>,
  };

  const db = {
    kind: "pg",
    async query(sql: string, values: unknown[] = []) {
      const normalized = normalizeSql(sql);

      if (normalized.includes("select * from prompt_policies where workspace_id = $1 limit 1")) {
        return {
          rowCount: 0,
          rows: [],
        };
      }

      if (normalized.includes("insert into prompt_policies")) {
        return {
          rowCount: 1,
          rows: [
            {
              workspace_id: values[0],
              enabled: values[1],
              enforcement_mode: values[2],
              evidence_mode: values[3],
              review_threshold: values[4],
              block_threshold: values[5],
              allowed_external_domains: values[6],
              allowed_keyword_overrides: values[7],
              disabled_rule_ids: values[8],
              created_at: "2026-04-17T00:00:00.000Z",
              updated_at: "2026-04-17T00:00:00.000Z",
            },
          ],
        };
      }

      if (normalized === "select pg_notify($1, $2)") {
        state.notified.push({
          channel: String(values[0]),
          payload: String(values[1]),
        });
        return {
          rowCount: 1,
          rows: [],
        };
      }

      throw new Error(`Unhandled SQL in prompt-policy-notify.test.ts: ${normalized}`);
    },
    async end() {
      return;
    },
  } satisfies Database;

  const policy = await upsertPromptPolicy(db, "11111111-1111-4111-8111-111111111111", {
    enabled: true,
  });

  assert.equal(policy.enabled, true);
  assert.equal(state.notified.length, 1);
  assert.equal(state.notified[0]?.channel, "prompt_policy_changed");
  assert.deepEqual(JSON.parse(state.notified[0]?.payload ?? "{}"), {
    workspaceId: "11111111-1111-4111-8111-111111111111",
    updatedAt: "2026-04-17T00:00:00.000Z",
  });
});
