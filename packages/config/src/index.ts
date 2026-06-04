import { z } from "zod";

export { getRepoRoot, getRootEnvFiles, loadRootEnv, resolveEnvProfile } from "./root-env.js";
import { loadRootEnv } from "./root-env.js";

const baseEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

const databaseUrlSchema = z
  .string()
  .refine(
    (value) =>
      /^(postgres|postgresql):\/\//.test(value) ||
      /^pglite:\/\//.test(value),
    "DATABASE_URL must use postgres://, postgresql://, or pglite://",
  );

const controlApiEnvSchema = baseEnvSchema.extend({
  CONTROL_API_PORT: z.coerce.number().default(4001),
  CONTROL_API_HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: databaseUrlSchema,
  VALKEY_URL: z.string().url().default("redis://127.0.0.1:6379"),
  WEB_ADMIN_BASE_URL: z.string().url().optional(),
  WEB_ADMIN_PUBLIC_BASE_URL: z.string().url().optional(),
  APP_BASE_URL: z.string().url().optional(),
  PUBLIC_APP_BASE_URL: z.string().url().optional(),
  ENCRYPTION_KEY_BASE64: z.string().min(20),
  FINGERPRINT_KEY_ENCRYPTION_KEY_BASE64: z.string().min(20).optional(),
  CONTROL_API_ADMIN_TOKEN: z.string().min(8).optional(),
  PRIVATE_RESPONSE_ATTESTATION_SECRET: z.string().min(16).optional(),
  PRIVATE_RESPONSE_ATTESTATION_KEY_ID: z.string().min(1).optional(),
  PRIVATE_RESPONSE_ATTESTATION_INSTANCE_ID: z.string().min(1).optional(),
  RESPONSE_WATERMARK_SECRET: z.string().min(16).optional(),
  RESPONSE_WATERMARK_KEY_ID: z.string().min(1).optional(),
  RESPONSE_WATERMARK_INSTANCE_ID: z.string().min(1).optional(),
});

const gatewayEnvSchema = baseEnvSchema.extend({
  GATEWAY_PORT: z.coerce.number().default(4002),
  GATEWAY_HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: databaseUrlSchema,
  VALKEY_URL: z.string().url().default("redis://127.0.0.1:6379"),
  GATEWAY_PUBLIC_BASE_URL: z.string().url().default("http://127.0.0.1:4002"),
  ENCRYPTION_KEY_BASE64: z.string().min(20),
  DEMO_MODE: z.enum(["0", "1"]).default("0"),
  GATEWAY_PROMPT_INSPECTION_ENABLED: z.enum(["0", "1"]).default("1"),
  GATEWAY_PROMPT_POLICY_CACHE_TTL_MS: z.coerce.number().int().min(0).default(0),
  GATEWAY_PROMPT_POLICY_SYNC_ENABLED: z.enum(["0", "1"]).default("1"),
});

const webAdminEnvSchema = baseEnvSchema.extend({
  WEB_ADMIN_PORT: z.coerce.number().default(3001),
  CONTROL_API_BASE_URL: z.string().url().default("http://127.0.0.1:4001"),
  NEXT_PUBLIC_CONTROL_API_BASE_URL: z.string().url().default("http://127.0.0.1:4001"),
  WEB_ADMIN_BASE_URL: z.string().url().optional(),
  WEB_ADMIN_PUBLIC_BASE_URL: z.string().url().optional(),
  APP_BASE_URL: z.string().url().optional(),
  PUBLIC_APP_BASE_URL: z.string().url().optional(),
  WEB_ADMIN_AUTH_MODE: z.enum(["session", "bootstrap_admin", "bootstrap_member_email"]).default("session"),
  CONTROL_API_ADMIN_TOKEN: z.string().min(8).optional(),
  CONTROL_API_MEMBER_EMAIL: z.string().email().optional(),
  PRIVATE_RESPONSE_ATTESTATION_SECRET: z.string().min(16).optional(),
  PRIVATE_RESPONSE_ATTESTATION_KEY_ID: z.string().min(1).optional(),
  PRIVATE_RESPONSE_ATTESTATION_INSTANCE_ID: z.string().min(1).optional(),
  RESPONSE_WATERMARK_SECRET: z.string().min(16).optional(),
  RESPONSE_WATERMARK_KEY_ID: z.string().min(1).optional(),
  RESPONSE_WATERMARK_INSTANCE_ID: z.string().min(1).optional(),
});

const exampleEncryptionKeyBase64 = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";
const exampleFingerprintKeyEncryptionKeyBase64 = "zzdJfhFExY307scJhu8QXdKai6v1L9Typ0eatZ6RcQI=";
const demoAdminToken = "demo-admin-token";
const examplePrivateAttestationSecret = "QqtJKuxZVRWljqu//EgRl60ufnS7EbGs+aJoZztE3Tc=";
const examplePrivateAttestationKeyId = "local-prod-2e0a0148";

function readAttestationSecret(env: Record<string, string | number | undefined>) {
  return (
    String(env.PRIVATE_RESPONSE_ATTESTATION_SECRET ?? "").trim() ||
    String(env.RESPONSE_WATERMARK_SECRET ?? "").trim() ||
    ""
  );
}

function readAttestationKeyId(env: Record<string, string | number | undefined>) {
  return (
    String(env.PRIVATE_RESPONSE_ATTESTATION_KEY_ID ?? "").trim() ||
    String(env.RESPONSE_WATERMARK_KEY_ID ?? "").trim() ||
    ""
  );
}

function assertPrivateAttestationEnv(
  env: Record<string, string | number | undefined>,
  serviceName: "control-api" | "web-admin",
) {
  if (env.NODE_ENV !== "production") {
    return;
  }

  const attestationSecret = readAttestationSecret(env);
  const attestationKeyId = readAttestationKeyId(env);

  if (!attestationSecret) {
    throw new Error(
      `${serviceName} requires PRIVATE_RESPONSE_ATTESTATION_SECRET (or legacy RESPONSE_WATERMARK_SECRET) in production`,
    );
  }

  if (!attestationKeyId) {
    throw new Error(
      `${serviceName} requires PRIVATE_RESPONSE_ATTESTATION_KEY_ID (or legacy RESPONSE_WATERMARK_KEY_ID) in production`,
    );
  }

  if (attestationSecret === examplePrivateAttestationSecret) {
    throw new Error(
      `${serviceName} cannot use the example PRIVATE_RESPONSE_ATTESTATION_SECRET in production`,
    );
  }

  if (attestationKeyId === examplePrivateAttestationKeyId) {
    throw new Error(
      `${serviceName} cannot use the example PRIVATE_RESPONSE_ATTESTATION_KEY_ID in production`,
    );
  }
}

function assertProductionSharedSecretSafety(
  env: Record<string, string | number | undefined>,
  serviceName: "control-api" | "gateway",
) {
  if (env.NODE_ENV !== "production") {
    return;
  }

  const encryptionKeyBase64 = String(env.ENCRYPTION_KEY_BASE64 ?? "").trim();
  if (encryptionKeyBase64 === exampleEncryptionKeyBase64) {
    throw new Error(`${serviceName} cannot use the example ENCRYPTION_KEY_BASE64 in production`);
  }
}

function assertProductionAdminTokenSafety(env: Record<string, string | number | undefined>, serviceName: string) {
  if (env.NODE_ENV !== "production") {
    return;
  }

  const adminToken = String(env.CONTROL_API_ADMIN_TOKEN ?? "").trim();
  if (adminToken === demoAdminToken) {
    throw new Error(`${serviceName} cannot use demo-admin-token in production`);
  }
}

function collectConfiguredWebAdminOrigins(env: Record<string, string | number | undefined>) {
  return [
    String(env.WEB_ADMIN_BASE_URL ?? "").trim(),
    String(env.WEB_ADMIN_PUBLIC_BASE_URL ?? "").trim(),
    String(env.APP_BASE_URL ?? "").trim(),
    String(env.PUBLIC_APP_BASE_URL ?? "").trim(),
  ].filter(Boolean);
}

function assertProductionWebAdminOriginSafety(
  env: Record<string, string | number | undefined>,
  serviceName: "control-api" | "web-admin",
) {
  if (env.NODE_ENV !== "production") {
    return;
  }

  for (const origin of collectConfiguredWebAdminOrigins(env)) {
    const url = new URL(origin);

    if (url.protocol !== "https:") {
      throw new Error(`${serviceName} requires an https WEB_ADMIN_BASE_URL-style origin in production`);
    }
  }
}

export function parseControlApiEnv(env: NodeJS.ProcessEnv = process.env) {
  if (env === process.env) {
    loadRootEnv({ env, required: false });
  }

  const parsed = controlApiEnvSchema.parse(env);
  assertProductionSharedSecretSafety(parsed, "control-api");
  assertProductionAdminTokenSafety(parsed, "control-api");
  assertPrivateAttestationEnv(parsed, "control-api");
  assertProductionWebAdminOriginSafety(parsed, "control-api");

  if (parsed.NODE_ENV === "production" && !parsed.FINGERPRINT_KEY_ENCRYPTION_KEY_BASE64?.trim()) {
    throw new Error(
      "control-api requires FINGERPRINT_KEY_ENCRYPTION_KEY_BASE64 in production",
    );
  }

  const fingerprintKeyEncryptionKeyBase64 = parsed.FINGERPRINT_KEY_ENCRYPTION_KEY_BASE64?.trim();
  if (
    parsed.NODE_ENV === "production" &&
    fingerprintKeyEncryptionKeyBase64 === exampleFingerprintKeyEncryptionKeyBase64
  ) {
    throw new Error(
      "control-api cannot use the example FINGERPRINT_KEY_ENCRYPTION_KEY_BASE64 in production",
    );
  }

  return parsed;
}

export function parseGatewayEnv(env: NodeJS.ProcessEnv = process.env) {
  if (env === process.env) {
    loadRootEnv({ env, required: false });
  }

  const parsed = gatewayEnvSchema.parse(env);
  assertProductionSharedSecretSafety(parsed, "gateway");

  if (parsed.NODE_ENV === "production" && parsed.DEMO_MODE === "1") {
    throw new Error("gateway cannot run with DEMO_MODE=1 in production");
  }

  return parsed;
}

export function parseWebAdminEnv(env: NodeJS.ProcessEnv = process.env) {
  if (env === process.env) {
    loadRootEnv({ env, required: false });
  }

  const parsed = webAdminEnvSchema.parse(env);
  assertProductionAdminTokenSafety(parsed, "web-admin");
  assertPrivateAttestationEnv(parsed, "web-admin");
  assertProductionWebAdminOriginSafety(parsed, "web-admin");
  return parsed;
}
