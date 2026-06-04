import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const envFilesByProfile = {
  development: [".env.development.local", ".env.development"],
  production: [".env.production.local", ".env.production"],
  test: [".env.test.local", ".env.test"],
} as const;
const validProfiles = Object.keys(envFilesByProfile) as EnvProfile[];

export type EnvProfile = keyof typeof envFilesByProfile;

export type LoadRootEnvOptions = {
  env?: NodeJS.ProcessEnv;
  profile?: EnvProfile | string;
  repoRoot?: string;
  required?: boolean;
  targetEnv?: NodeJS.ProcessEnv;
};

let cachedLoads = new Map<string, { profile: EnvProfile; repoRoot: string; loadedFiles: string[] }>();

function assertValidProfile(profile: string, source: string): EnvProfile {
  if ((validProfiles as string[]).includes(profile)) {
    return profile as EnvProfile;
  }

  throw new Error(`Unsupported ${source} value \`${profile}\`. Expected one of: ${validProfiles.join(", ")}`);
}

export function resolveEnvProfile(options: Pick<LoadRootEnvOptions, "env" | "profile"> = {}) {
  const { profile, env = process.env } = options;

  if (profile) {
    return assertValidProfile(String(profile).trim(), "profile");
  }

  const teamopsEnv = String(env.TEAMOPS_ENV ?? "").trim();
  if (teamopsEnv) {
    return assertValidProfile(teamopsEnv, "TEAMOPS_ENV");
  }

  const nodeEnv = String(env.NODE_ENV ?? "").trim();
  if ((validProfiles as string[]).includes(nodeEnv)) {
    return nodeEnv as EnvProfile;
  }

  return "development";
}

function getExampleEnvFile(profile: EnvProfile) {
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

export function getRootEnvFiles(options: Pick<LoadRootEnvOptions, "env" | "profile" | "repoRoot"> = {}) {
  const resolvedProfile = resolveEnvProfile(options);
  const resolvedRepoRoot = options.repoRoot ?? repoRoot;
  return envFilesByProfile[resolvedProfile].map((name) => path.join(resolvedRepoRoot, name));
}

export function loadRootEnv(options: LoadRootEnvOptions = {}) {
  const {
    env = process.env,
    profile,
    repoRoot: customRepoRoot,
    required = true,
    targetEnv = process.env,
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

  const loadedFiles: string[] = [];

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
