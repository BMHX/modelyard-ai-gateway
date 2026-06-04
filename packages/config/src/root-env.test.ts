import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { loadRootEnv, resolveEnvProfile } from "./root-env.js";

async function withTempDir(fn: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "teamops-root-env-"));

  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("loadRootEnv loads the requested development profile with local override precedence", async () => {
  await withTempDir(async (dir) => {
    await writeFile(
      path.join(dir, ".env.development"),
      "SHARED=base\nDEV_ONLY=base-dev\n",
      "utf8",
    );
    await writeFile(
      path.join(dir, ".env.development.local"),
      "SHARED=local\nLOCAL_ONLY=local-dev\n",
      "utf8",
    );
    await writeFile(path.join(dir, ".env.production"), "SHARED=prod\n", "utf8");

    const env: NodeJS.ProcessEnv = {};
    const result = loadRootEnv({
      profile: "development",
      repoRoot: dir,
      targetEnv: env,
      required: true,
    });

    assert.equal(result.profile, "development");
    assert.deepEqual(
      result.loadedFiles.map((file) => path.basename(file)),
      [".env.development.local", ".env.development"],
    );
    assert.equal(env.SHARED, "local");
    assert.equal(env.DEV_ONLY, "base-dev");
    assert.equal(env.LOCAL_ONLY, "local-dev");
  });
});

test("loadRootEnv does not fall back to root .env when a profile file is missing", async () => {
  await withTempDir(async (dir) => {
    await writeFile(path.join(dir, ".env"), "SHARED=root\n", "utf8");

    const env: NodeJS.ProcessEnv = {};
    const result = loadRootEnv({
      profile: "production",
      repoRoot: dir,
      targetEnv: env,
      required: false,
    });

    assert.equal(result.profile, "production");
    assert.deepEqual(result.loadedFiles, []);
    assert.equal(env.SHARED, undefined);
  });
});

test("loadRootEnv throws a clear error when the requested profile file is missing", async () => {
  await withTempDir(async (dir) => {
    await assert.rejects(
      async () => {
        loadRootEnv({
          profile: "production",
          repoRoot: dir,
          targetEnv: {},
          required: true,
        });
      },
      /No production environment file found/,
    );
  });
});

test("resolveEnvProfile honors explicit profile, TEAMOPS_ENV, NODE_ENV, then development", () => {
  assert.equal(
    resolveEnvProfile({
      profile: "test",
      env: {
        TEAMOPS_ENV: "production",
        NODE_ENV: "development",
      } as NodeJS.ProcessEnv,
    }),
    "test",
  );

  assert.equal(
    resolveEnvProfile({
      env: {
        TEAMOPS_ENV: "production",
        NODE_ENV: "development",
      } as NodeJS.ProcessEnv,
    }),
    "production",
  );

  assert.equal(
    resolveEnvProfile({
      env: {
        NODE_ENV: "test",
      } as NodeJS.ProcessEnv,
    }),
    "test",
  );

  assert.equal(
    resolveEnvProfile({
      env: {} as NodeJS.ProcessEnv,
    }),
    "development",
  );
});
