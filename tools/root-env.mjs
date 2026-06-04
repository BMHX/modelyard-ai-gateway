import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as util from "node:util";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const envFileNamesByProfile = {
  development: [".env.development.local", ".env.development"],
  production: [".env.production.local", ".env.production"],
  test: [".env.test.local", ".env.test"],
};
const validProfiles = new Set(Object.keys(envFileNamesByProfile));
const parseEnv =
  typeof util.parseEnv === "function"
    ? util.parseEnv
    : (content) => {
        const parsed = {};

        for (const rawLine of content.split(/\r?\n/u)) {
          const line = rawLine.trim();
          if (!line || line.startsWith("#")) {
            continue;
          }

          const separatorIndex = line.indexOf("=");
          if (separatorIndex === -1) {
            continue;
          }

          const key = line.slice(0, separatorIndex).trim();
          let value = line.slice(separatorIndex + 1).trim();

          if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
          ) {
            value = value.slice(1, -1);
          }

          parsed[key] = value;
        }

        return parsed;
      };

const cachedLoads = new Map();

function assertValidProfile(profile, source) {
  if (validProfiles.has(profile)) {
    return profile;
  }

  throw new Error(
    `Unsupported ${source} value \`${profile}\`. Expected one of: ${Array.from(validProfiles).join(", ")}`,
  );
}

export function resolveEnvProfile(options = {}) {
  const { profile, env = process.env } = options;

  if (profile) {
    return assertValidProfile(String(profile).trim(), "profile");
  }

  const teamopsEnv = String(env.TEAMOPS_ENV ?? "").trim();
  if (teamopsEnv) {
    return assertValidProfile(teamopsEnv, "TEAMOPS_ENV");
  }

  const nodeEnv = String(env.NODE_ENV ?? "").trim();
  if (validProfiles.has(nodeEnv)) {
    return nodeEnv;
  }

  return "development";
}

function getExampleEnvFile(profile) {
  if (profile === "development") {
    return ".env.development.example";
  }

  if (profile === "production") {
    return ".env.production.example";
  }

  return null;
}

export function getRepoRoot() {
  return repoRoot;
}

export function getRootEnvFiles(options = {}) {
  const resolvedProfile = resolveEnvProfile(options);
  const resolvedRepoRoot = options.repoRoot ?? repoRoot;
  return envFileNamesByProfile[resolvedProfile].map((name) => path.join(resolvedRepoRoot, name));
}

export function loadRootEnv(options = {}) {
  const {
    profile,
    env = process.env,
    targetEnv = process.env,
    repoRoot: customRepoRoot,
    required = true,
  } = options;
  const resolvedProfile = resolveEnvProfile({ profile, env });
  const resolvedRepoRoot = customRepoRoot ?? repoRoot;
  const cacheKey = `${resolvedRepoRoot}:${resolvedProfile}`;
  const cachedLoad = targetEnv === process.env ? cachedLoads.get(cacheKey) ?? null : null;

  if (cachedLoad) {
    if (required && cachedLoad.loadedFiles.length === 0) {
      const primaryEnvFile = getRootEnvFiles({ profile: resolvedProfile, repoRoot: resolvedRepoRoot })[1];
      const exampleEnvFile = getExampleEnvFile(resolvedProfile);
      const exampleHint = exampleEnvFile
        ? ` Create ${path.join(resolvedRepoRoot, path.basename(primaryEnvFile))} from ${path.join(resolvedRepoRoot, exampleEnvFile)} first.`
        : ` Create ${primaryEnvFile} first.`;
      throw new Error(`No ${resolvedProfile} environment file found in ${resolvedRepoRoot}.${exampleHint}`);
    }

    return cachedLoad;
  }

  const loadedFiles = [];

  for (const envFile of getRootEnvFiles({ profile: resolvedProfile, repoRoot: resolvedRepoRoot })) {
    if (!existsSync(envFile)) {
      continue;
    }

    const parsed = parseEnv(readFileSync(envFile, "utf8"));
    for (const [key, value] of Object.entries(parsed)) {
      if (targetEnv[key] === undefined) {
        targetEnv[key] = value;
      }
    }

    loadedFiles.push(envFile);
  }

  const result = {
    profile: resolvedProfile,
    repoRoot: resolvedRepoRoot,
    loadedFiles,
  };

  if (required && loadedFiles.length === 0) {
    const primaryEnvFile = getRootEnvFiles({ profile: resolvedProfile, repoRoot: resolvedRepoRoot })[1];
    const exampleEnvFile = getExampleEnvFile(resolvedProfile);
    const exampleHint = exampleEnvFile
      ? ` Create ${path.join(resolvedRepoRoot, path.basename(primaryEnvFile))} from ${path.join(resolvedRepoRoot, exampleEnvFile)} first.`
      : ` Create ${primaryEnvFile} first.`;
    throw new Error(`No ${resolvedProfile} environment file found in ${resolvedRepoRoot}.${exampleHint}`);
  }

  if (targetEnv === process.env) {
    cachedLoads.set(cacheKey, result);
  }

  return result;
}
