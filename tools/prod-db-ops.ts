import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  ProviderConnectionCredentialKeyMismatchError,
  createDatabase,
  deriveCredentialKeyFingerprint,
  resolveProviderCredentialsByConnectionId,
  revokeProviderConnection,
  revokeVirtualKey,
} from "../packages/database/src/index.ts";
import { getRepoRoot, loadRootEnv } from "./root-env.mjs";

const placeholderProviderApiKeys = new Set(["demo-openai-key", "demo-anthropic-key"]);

function readArg(name: string) {
  const value = process.argv.find((entry) => entry.startsWith(`${name}=`));
  return value ? value.slice(name.length + 1) : null;
}

function hasFlag(flag: string) {
  return process.argv.includes(flag);
}

function assertEnv(name: string) {
  const value = String(process.env[name] ?? "").trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function resolveOutputPath(rawPath: string) {
  return path.isAbsolute(rawPath) ? rawPath : path.join(getRepoRoot(), rawPath);
}

async function writeJson(outPath: string, payload: unknown) {
  const absolutePath = resolveOutputPath(outPath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return absolutePath;
}

async function loadProviderInventory(db: ReturnType<typeof createDatabase>, encryptionKeyBase64: string) {
  const providerRows = await db.query(
    "select id, workspace_id, provider, label, status, created_at, updated_at from provider_connections order by created_at asc",
  );

  const providers = [];
  for (const row of providerRows.rows) {
    let resolved = null;
    let credentialState: "readable" | "key_mismatch" | "unreadable" = "readable";
    if (row.status === "active") {
      try {
        resolved = await resolveProviderCredentialsByConnectionId(db, String(row.id), encryptionKeyBase64);
      } catch (error) {
        if (error instanceof ProviderConnectionCredentialKeyMismatchError) {
          credentialState = "key_mismatch";
        } else {
          credentialState = "unreadable";
        }
      }
    }
    const apiKey = resolved?.apiKey ?? null;

    providers.push({
      id: String(row.id),
      workspaceId: String(row.workspace_id),
      provider: String(row.provider),
      label: String(row.label),
      status: String(row.status),
      createdAt: new Date(String(row.created_at)).toISOString(),
      updatedAt: new Date(String(row.updated_at)).toISOString(),
      credentialState,
      placeholderCredential: apiKey ? placeholderProviderApiKeys.has(apiKey.trim()) : false,
    });
  }

  return providers;
}

async function inventoryCommand() {
  loadRootEnv({ profile: "production", required: true });

  const databaseUrl = assertEnv("DATABASE_URL");
  const encryptionKeyBase64 = assertEnv("ENCRYPTION_KEY_BASE64");
  const db = createDatabase(databaseUrl);

  try {
    const [organizations, workspaces, members, budgets, virtualKeys, providers] = await Promise.all([
      db.query("select id, slug, name, created_at from organizations order by created_at asc"),
      db.query("select id, organization_id, slug, name, created_at from workspaces order by created_at asc"),
      db.query(
        "select id, workspace_id, email, role, status, created_at from members order by workspace_id asc, email asc",
      ),
      db.query(
        "select id, workspace_id, project_id, monthly_usd_limit, soft_limit_percent, status, created_at from budget_policies order by created_at asc",
      ),
      db.query(
        "select id, workspace_id, label, key_prefix, status, issuance_mode, created_at from virtual_keys order by created_at asc",
      ),
      loadProviderInventory(db, encryptionKeyBase64),
    ]);

    const payload = {
      generatedAt: new Date().toISOString(),
      runtimeEncryptionKeyFingerprint: deriveCredentialKeyFingerprint(encryptionKeyBase64),
      summary: {
        organizationCount: organizations.rowCount ?? organizations.rows.length,
        workspaceCount: workspaces.rowCount ?? workspaces.rows.length,
        memberCount: members.rowCount ?? members.rows.length,
        budgetCount: budgets.rowCount ?? budgets.rows.length,
        virtualKeyCount: virtualKeys.rowCount ?? virtualKeys.rows.length,
        activeVirtualKeyCount: virtualKeys.rows.filter((row) => String(row.status) === "active").length,
        providerCount: providers.length,
        activePlaceholderProviderCount: providers.filter(
          (provider) => provider.status === "active" && provider.placeholderCredential,
        ).length,
      },
      organizations: organizations.rows,
      workspaces: workspaces.rows,
      members: members.rows,
      budgets: budgets.rows,
      virtualKeys: virtualKeys.rows,
      providers,
    };

    const outPath = readArg("--out");
    if (outPath) {
      const writtenPath = await writeJson(outPath, payload);
      console.log(`Inventory written to ${writtenPath}`);
    } else {
      console.log(JSON.stringify(payload, null, 2));
    }
  } finally {
    await db.end();
  }
}

async function revokeVirtualKeysCommand() {
  loadRootEnv({ profile: "production", required: true });
  if (!hasFlag("--yes")) {
    throw new Error("Refusing to revoke virtual keys without --yes");
  }

  const databaseUrl = assertEnv("DATABASE_URL");
  const db = createDatabase(databaseUrl);

  try {
    const result = await db.query(
      "select id, workspace_id, label, key_prefix, issuance_mode from virtual_keys where status = 'active' order by created_at asc",
    );

    const revoked = [];
    for (const row of result.rows) {
      const updated = await revokeVirtualKey(db, String(row.id));
      if (!updated) {
        continue;
      }

      revoked.push({
        id: updated.id,
        workspaceId: updated.workspaceId,
        label: updated.label,
        keyPrefix: updated.keyPrefix,
        issuanceMode: updated.issuanceMode,
      });
    }

    const payload = {
      revokedAt: new Date().toISOString(),
      count: revoked.length,
      revoked,
    };

    const outPath = readArg("--out");
    if (outPath) {
      const writtenPath = await writeJson(outPath, payload);
      console.log(`Revoked virtual key report written to ${writtenPath}`);
    }

    console.log(`Revoked ${revoked.length} active virtual keys.`);
  } finally {
    await db.end();
  }
}

async function revokePlaceholderProvidersCommand() {
  loadRootEnv({ profile: "production", required: true });
  if (!hasFlag("--yes")) {
    throw new Error("Refusing to revoke placeholder providers without --yes");
  }

  const databaseUrl = assertEnv("DATABASE_URL");
  const encryptionKeyBase64 = assertEnv("ENCRYPTION_KEY_BASE64");
  const db = createDatabase(databaseUrl);

  try {
    const providers = await loadProviderInventory(db, encryptionKeyBase64);
    const revoked = [];

    for (const provider of providers) {
      if (provider.status !== "active" || !provider.placeholderCredential) {
        continue;
      }

      const updated = await revokeProviderConnection(db, provider.id);
      if (!updated) {
        continue;
      }

      revoked.push({
        id: updated.id,
        workspaceId: updated.workspaceId,
        label: updated.label,
        provider: updated.provider,
      });
    }

    const payload = {
      revokedAt: new Date().toISOString(),
      count: revoked.length,
      revoked,
    };

    const outPath = readArg("--out");
    if (outPath) {
      const writtenPath = await writeJson(outPath, payload);
      console.log(`Revoked placeholder provider report written to ${writtenPath}`);
    }

    console.log(`Revoked ${revoked.length} placeholder provider connections.`);
  } finally {
    await db.end();
  }
}

const command = process.argv[2];

switch (command) {
  case "inventory":
    await inventoryCommand();
    break;
  case "revoke-virtual-keys":
    await revokeVirtualKeysCommand();
    break;
  case "revoke-placeholder-providers":
    await revokePlaceholderProvidersCommand();
    break;
  default:
    throw new Error(
      "Usage: node --import tsx ./tools/prod-db-ops.ts <inventory|revoke-virtual-keys|revoke-placeholder-providers> [--out=path] [--yes]",
    );
}
