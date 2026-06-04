import { spawnSync } from "node:child_process";

import { parseControlApiEnv, parseGatewayEnv, parseWebAdminEnv } from "../packages/config/src/index.ts";
import {
  ProviderConnectionCredentialKeyMismatchError,
  createDatabase,
  deriveCredentialKeyFingerprint,
  resolveProviderCredentialsByConnectionId,
} from "../packages/database/src/index.ts";
import { getRepoRoot, loadRootEnv } from "./root-env.mjs";

const placeholderProviderApiKeys = new Set(["demo-openai-key", "demo-anthropic-key"]);
const dockerProcessMatchers = [/docker/i, /com\.docker/i, /docker-proxy/i, /vpnkit/i, /colima/i, /orb/i];

type Phase = "build" | "deploy";

function readArg(name: string) {
  const value = process.argv.find((entry) => entry.startsWith(`${name}=`));
  return value ? value.slice(name.length + 1) : null;
}

function fail(message: string) {
  throw new Error(message);
}

function isLocalOnlyUrl(rawUrl: string) {
  const hostname = new URL(rawUrl).hostname.trim().toLowerCase();
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "0.0.0.0";
}

function run(command: string, args: string[]) {
  return spawnSync(command, args, {
    cwd: getRepoRoot(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function checkGitClean(failures: string[]) {
  const result = run("git", ["status", "--porcelain"]);
  if (result.status !== 0) {
    failures.push(`Unable to read git status: ${result.stderr.trim() || result.stdout.trim() || "unknown error"}`);
    return;
  }

  if (result.stdout.trim()) {
    failures.push(
      "Git worktree is not clean. Build the production image from a reviewed commit/tag, or override deliberately with TEAMOPS_ALLOW_DIRTY_RELEASE=1.",
    );
  }
}

function checkPorts(failures: string[], ports: number[]) {
  const lsofVersion = run("lsof", ["-v"]);
  if (lsofVersion.status !== 0) {
    return;
  }

  for (const port of ports) {
    const result = run("lsof", [`-iTCP:${port}`, "-sTCP:LISTEN", "-n", "-P"]);
    if (result.status !== 0 || !result.stdout.trim()) {
      continue;
    }

    const lines = result.stdout
      .trim()
      .split(/\r?\n/u)
      .slice(1)
      .map((line) => line.trim())
      .filter(Boolean);

    if (!lines.length) {
      continue;
    }

    const blockingLines = lines.filter((line) => {
      const command = line.split(/\s+/u)[0] ?? "";
      return !dockerProcessMatchers.some((matcher) => matcher.test(command));
    });

    if (blockingLines.length) {
      failures.push(`Port ${port} is already occupied by a non-docker process:\n${blockingLines.join("\n")}`);
    }
  }
}

async function checkDatabaseState(failures: string[], warnings: string[], databaseUrl: string, encryptionKeyBase64: string) {
  const db = createDatabase(databaseUrl);

  try {
    const organizationRows = await db.query<{
      slug: string;
    }>("select slug from organizations order by created_at asc");
    const flaggedOrganizationSlugs = organizationRows.rows
      .map((row) => String(row.slug))
      .filter((slug) => /(^qa-|demo|pilot-demo|internal-demo|unauth-browser)/i.test(slug));

    if (flaggedOrganizationSlugs.length) {
      warnings.push(`Database still contains demo/QA organization slugs: ${flaggedOrganizationSlugs.join(", ")}`);
    }

    const activeVirtualKeyCountResult = await db.query<{ count: string }>(
      "select count(*)::text as count from virtual_keys where status = 'active'",
    );
    const activeVirtualKeyCount = Number(activeVirtualKeyCountResult.rows[0]?.count ?? "0");
    if (activeVirtualKeyCount > 0) {
      warnings.push(
        `Database still has ${activeVirtualKeyCount} active virtual keys. Revoke old keys before production cutover and re-issue only the approved production keys afterwards.`,
      );
    }

    const providerRows = await db.query<{ id: string; label: string }>(
      "select id, label from provider_connections where status = 'active' order by created_at asc",
    );
    const placeholderProviders: string[] = [];

    for (const row of providerRows.rows) {
      let resolved;
      try {
        resolved = await resolveProviderCredentialsByConnectionId(db, String(row.id), encryptionKeyBase64);
      } catch (error) {
        if (error instanceof ProviderConnectionCredentialKeyMismatchError) {
          failures.push(
            `Provider connection ${String(row.label)} (${String(row.id)}) was encrypted with a different runtime key fingerprint. Re-enter the credential with ENCRYPTION_KEY_BASE64 fingerprint ${deriveCredentialKeyFingerprint(encryptionKeyBase64)}.`,
          );
          continue;
        }

        throw error;
      }

      if (!resolved) {
        continue;
      }

      if (placeholderProviderApiKeys.has(resolved.apiKey.trim())) {
        placeholderProviders.push(`${resolved.connection.label} (${resolved.connection.id})`);
      }
    }

    if (placeholderProviders.length) {
      failures.push(
        `Active provider connections still use placeholder upstream credentials:\n${placeholderProviders.join("\n")}`,
      );
    }
  } finally {
    await db.end();
  }
}

async function main() {
  loadRootEnv({ profile: "production", required: true });

  const phase = (readArg("--phase") ?? "deploy") as Phase;
  if (phase !== "build" && phase !== "deploy") {
    fail("Unsupported --phase. Use --phase=build or --phase=deploy.");
  }

  const failures: string[] = [];
  const warnings: string[] = [];

  if (process.env.TEAMOPS_ALLOW_DIRTY_RELEASE !== "1") {
    checkGitClean(failures);
  }

  if (phase === "build") {
    if (failures.length) {
      console.error("Production build preflight failed:");
      for (const entry of failures) {
        console.error(`- ${entry}`);
      }
      process.exit(1);
    }

    console.log("Production build preflight passed.");
    return;
  }

  const controlApiEnv = parseControlApiEnv();
  const gatewayEnv = parseGatewayEnv();
  const webAdminEnv = parseWebAdminEnv();

  if (controlApiEnv.NODE_ENV !== "production") {
    failures.push("NODE_ENV must be production for preview/prod deployment.");
  }

  if (gatewayEnv.DEMO_MODE !== "0") {
    failures.push("DEMO_MODE must be 0 for preview/prod deployment.");
  }

  if (!controlApiEnv.CONTROL_API_ADMIN_TOKEN?.trim()) {
    failures.push("CONTROL_API_ADMIN_TOKEN must be explicitly set for preview/prod deployment.");
  }

  const postgresPassword = String(process.env.POSTGRES_PASSWORD ?? "").trim();
  if (!postgresPassword) {
    failures.push("POSTGRES_PASSWORD must be explicitly set for preview/prod deployment.");
  } else if (postgresPassword === "teamops") {
    failures.push("POSTGRES_PASSWORD cannot use the preview default value `teamops`.");
  }

  const publicUrls: Array<[string, string]> = [
    ["WEB_ADMIN_BASE_URL", String(process.env.WEB_ADMIN_BASE_URL ?? "")],
    ["GATEWAY_PUBLIC_BASE_URL", gatewayEnv.GATEWAY_PUBLIC_BASE_URL],
    ["NEXT_PUBLIC_CONTROL_API_BASE_URL", webAdminEnv.NEXT_PUBLIC_CONTROL_API_BASE_URL],
  ];

  for (const [name, rawUrl] of publicUrls) {
    if (!rawUrl.trim()) {
      failures.push(`${name} must be explicitly set for preview/prod deployment.`);
      continue;
    }

    if (isLocalOnlyUrl(rawUrl)) {
      failures.push(`${name} cannot point at localhost or 127.0.0.1 for production deployment.`);
    }
  }

  checkPorts(failures, [
    Number(process.env.CONTROL_API_PUBLIC_PORT ?? "4001"),
    Number(process.env.GATEWAY_PUBLIC_PORT ?? "4002"),
    Number(process.env.WEB_ADMIN_PUBLIC_PORT ?? "3001"),
  ]);

  await checkDatabaseState(
    failures,
    warnings,
    controlApiEnv.DATABASE_URL,
    controlApiEnv.ENCRYPTION_KEY_BASE64,
  );

  if (failures.length) {
    console.error("Production deploy preflight failed:");
    for (const entry of failures) {
      console.error(`- ${entry}`);
    }
    if (warnings.length) {
      console.error("Warnings:");
      for (const entry of warnings) {
        console.error(`- ${entry}`);
      }
    }
    process.exit(1);
  }

  console.log("Production deploy preflight passed.");
  console.log(`- runtime encryption key fingerprint: ${deriveCredentialKeyFingerprint(controlApiEnv.ENCRYPTION_KEY_BASE64)}`);
  for (const entry of warnings) {
    console.log(`- warning: ${entry}`);
  }
}

await main();
