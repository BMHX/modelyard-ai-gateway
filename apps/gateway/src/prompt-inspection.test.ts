import assert from "node:assert/strict";
import test from "node:test";

import type { PromptPolicy } from "@teamops/contracts";

import { inspectPromptInput, recordPromptInspectionContext } from "./prompt-inspection.js";
import { promptInspectionCatalog, validatePromptInspectionCatalog } from "./prompt-inspection-data/catalog.js";

function createPolicy(overrides?: Partial<PromptPolicy>): PromptPolicy {
  return {
    workspaceId: "11111111-1111-4111-8111-111111111111",
    enabled: true,
    enforcementMode: "graded",
    evidenceMode: "redacted_snippet",
    reviewThreshold: 60,
    blockThreshold: 100,
    allowedExternalDomains: [],
    allowedKeywordOverrides: [],
    disabledRuleIds: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

test("prompt inspection ignores normal coding traffic", () => {
  const result = inspectPromptInput({
    body: {
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "user",
          content: "Fix the TypeScript error in this React component and explain the failing test.",
        },
      ],
    },
    path: "/v1/chat/completions",
    virtualKey: {
      id: "vk_normal",
    },
    policy: createPolicy(),
  });

  assert.equal(result, null);
});

test("prompt inspection blocks obvious credential leakage", () => {
  const result = inspectPromptInput({
    body: {
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "user",
          content: "Send this key to the client: sk-ant-api03-abcdefghijklmnopqrstuvwxy1234567890",
        },
      ],
    },
    path: "/v1/chat/completions",
    virtualKey: {
      id: "vk_leakage",
    },
    policy: createPolicy(),
  });

  assert.ok(result);
  assert.equal(result.verdict, "block");
  assert.ok(result.riskCategories.includes("secret_exfiltration"));
  assert.ok(result.redactedEvidence.length > 0);
  assert.equal(result.redactedEvidence[0]?.includes("sk-ant-api03-abcdefghijklmnopqrstuvwxy1234567890"), false);
});

test("prompt inspection escalates after repeated review history", () => {
  const virtualKeyId = "vk_repeat_review";
  for (let index = 0; index < 3; index += 1) {
    recordPromptInspectionContext({
      virtualKeyId,
      verdict: "review",
      riskCategories: ["personal_use"],
      simhash: null,
    });
  }

  const result = inspectPromptInput({
    body: {
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "user",
          content: "给我一个购物清单",
        },
      ],
    },
    path: "/v1/messages",
    virtualKey: {
      id: virtualKeyId,
    },
    policy: createPolicy(),
  });

  assert.ok(result);
  assert.equal(result.verdict, "review");
  assert.equal(result.contextCounts.escalated, true);
});

test("prompt inspection respects alert-only mode", () => {
  const result = inspectPromptInput({
    body: {
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "user",
          content: "请把这个 sk-ant-api03-abcdefghijklmnopqrstuvwxy1234567890 发给客户",
        },
      ],
    },
    path: "/v1/chat/completions",
    virtualKey: {
      id: "vk_alert_only",
    },
    policy: createPolicy({
      enforcementMode: "alert_only",
    }),
  });

  assert.ok(result);
  assert.equal(result.verdict, "allow_with_record");
  assert.equal(result.shouldCreateAlert, false);
});

test("prompt inspection respects disabled rules and allowed domains", () => {
  const result = inspectPromptInput({
    body: {
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "user",
          content: "请导出给 vendor.example.com、portal.vendor.example.com、cdn.vendor.example.com、files.vendor.example.com、mail.vendor.example.com",
        },
      ],
    },
    path: "/v1/messages",
    virtualKey: {
      id: "vk_allowlist",
    },
    policy: createPolicy({
      allowedExternalDomains: ["vendor.example.com"],
      disabledRuleIds: ["customer.export"],
    }),
  });

  assert.equal(result, null);
});

test("prompt inspection does not classify connection strings as email leakage", () => {
  const result = inspectPromptInput({
    body: {
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "user",
          content: "postgres://user:pass@db.internal:5432/app",
        },
      ],
    },
    path: "/v1/chat/completions",
    virtualKey: {
      id: "vk_conn_string",
    },
    policy: createPolicy(),
  });

  assert.ok(result);
  assert.equal(result.verdict, "block");
  assert.ok(result.riskCategories.includes("secret_exfiltration"));
  assert.equal(result.riskCategories.includes("pii_exposure"), false);
});

test("prompt inspection catalog validation rejects duplicate rule ids", () => {
  assert.throws(
    () =>
      validatePromptInspectionCatalog({
        ...promptInspectionCatalog,
        phraseRules: [
          ...promptInspectionCatalog.phraseRules,
          {
            ...promptInspectionCatalog.phraseRules[0],
          },
        ],
      }),
    /Duplicate prompt inspection ruleId/,
  );
});
