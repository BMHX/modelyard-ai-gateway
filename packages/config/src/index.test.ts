import assert from "node:assert/strict";
import test from "node:test";

import { parseControlApiEnv, parseWebAdminEnv } from "./index.js";

const baseProductionEnv = {
  NODE_ENV: "production",
  CONTROL_API_PORT: "4001",
  CONTROL_API_HOST: "0.0.0.0",
  WEB_ADMIN_PORT: "3001",
  DATABASE_URL: "postgres://teamops:teamops@127.0.0.1:5432/teamops",
  VALKEY_URL: "redis://127.0.0.1:6379",
  CONTROL_API_BASE_URL: "http://127.0.0.1:4001",
  NEXT_PUBLIC_CONTROL_API_BASE_URL: "http://127.0.0.1:4001",
  ENCRYPTION_KEY_BASE64: Buffer.alloc(32, 7).toString("base64"),
  FINGERPRINT_KEY_ENCRYPTION_KEY_BASE64: Buffer.alloc(32, 8).toString("base64"),
  PRIVATE_RESPONSE_ATTESTATION_SECRET: Buffer.alloc(32, 9).toString("base64"),
  PRIVATE_RESPONSE_ATTESTATION_KEY_ID: "prod-attestation-1",
  CONTROL_API_ADMIN_TOKEN: "prod-admin-token-123",
} satisfies NodeJS.ProcessEnv;

test("parseControlApiEnv accepts an https ngrok browser origin in production", () => {
  const parsed = parseControlApiEnv({
    ...baseProductionEnv,
    WEB_ADMIN_BASE_URL: "https://demo.ngrok-free.dev",
  });

  assert.equal(parsed.WEB_ADMIN_BASE_URL, "https://demo.ngrok-free.dev");
});

test("parseWebAdminEnv rejects insecure public origins in production", () => {
  assert.throws(
    () =>
      parseWebAdminEnv({
        ...baseProductionEnv,
        WEB_ADMIN_BASE_URL: "http://admin.example.com",
      }),
    /requires an https WEB_ADMIN_BASE_URL-style origin/u,
  );
});

test("parseWebAdminEnv accepts a stable https public origin in production", () => {
  const parsed = parseWebAdminEnv({
    ...baseProductionEnv,
    WEB_ADMIN_BASE_URL: "https://admin.example.com",
  });

  assert.equal(parsed.WEB_ADMIN_BASE_URL, "https://admin.example.com");
});
