import assert from "node:assert/strict";
import test from "node:test";

import { resolvePromptPolicySyncDecision, shouldEnablePromptPolicySync } from "./routes.js";

test("prompt policy sync is enabled only for pg gateways when the env toggle is on", () => {
  assert.equal(
    shouldEnablePromptPolicySync({
      db: { kind: "pg" },
      env: { GATEWAY_PROMPT_POLICY_SYNC_ENABLED: "1" },
    } as Parameters<typeof shouldEnablePromptPolicySync>[0]),
    true,
  );
  assert.equal(
    shouldEnablePromptPolicySync({
      db: { kind: "pglite" },
      env: { GATEWAY_PROMPT_POLICY_SYNC_ENABLED: "1" },
    } as Parameters<typeof shouldEnablePromptPolicySync>[0]),
    false,
  );
  assert.equal(
    shouldEnablePromptPolicySync({
      db: { kind: "pg" },
      env: { GATEWAY_PROMPT_POLICY_SYNC_ENABLED: "0" },
    } as Parameters<typeof shouldEnablePromptPolicySync>[0]),
    false,
  );
});

test("prompt policy sync payloads evict a single workspace or clear on malformed input", () => {
  assert.deepEqual(
    resolvePromptPolicySyncDecision(JSON.stringify({ workspaceId: "workspace_1", updatedAt: "2026-04-17T00:00:00.000Z" })),
    {
      kind: "evict",
      workspaceId: "workspace_1",
    },
  );
  assert.deepEqual(resolvePromptPolicySyncDecision("not-json"), { kind: "clear" });
  assert.deepEqual(resolvePromptPolicySyncDecision(JSON.stringify({ workspaceId: 123 })), { kind: "clear" });
});
