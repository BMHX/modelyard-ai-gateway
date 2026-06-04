import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { normalizeVirtualKeyScopes } from "@teamops/contracts";

import {
  getDefaultConsolePreferences,
  type ConsolePreferences,
} from "./console-preferences";

export type EditableConsoleRuntimeSettings = {
  gatewayBaseUrl: string;
  gatewayRequestBasePath: string;
  gatewayChatCompletionsPath: string;
  gatewayResponsesPath: string;
  gatewayModelsPath: string;
  gatewayHealthPath: string;
  gatewayRequestTimeoutMs: number;
};

export type EditableConsoleWorkspaceDefaults = {
  defaultProviderConnectionId: string | null;
  defaultModelCatalogSourceHint: string | null;
  defaultVirtualKeyTtlHours: number;
  defaultVirtualKeyScopesTemplate: string[];
  defaultProjectId: string | null;
};

type ConsoleRuntimeSettingsInput = Omit<
  EditableConsoleRuntimeSettings,
  "gatewayRequestTimeoutMs"
> & {
  gatewayRequestTimeoutMs: number | string;
};

type ConsoleWorkspaceDefaultsInput = {
  defaultProviderConnectionId?: string | null;
  defaultModelCatalogSourceHint?: string | null;
  defaultVirtualKeyTtlHours?: number | string | null;
  defaultVirtualKeyScopesTemplate?: string[] | string | null;
  defaultProjectId?: string | null;
};

export type ConsoleRuntimeSettings = EditableConsoleRuntimeSettings & {
  updatedAt: string | null;
};

export type ConsoleSettingsSource = "defaults" | "file";

type StoredConsoleSettingsFile = {
  version: 1;
  updatedAt: string;
  runtimeSettings: EditableConsoleRuntimeSettings;
  workspaceDefaultsById: Record<string, EditableConsoleWorkspaceDefaults>;
};

type LegacyConsoleRuntimeSettingsFile = Partial<ConsoleRuntimeSettingsInput> & {
  updatedAt?: string | null;
};

export type ConsoleSettingsPayload = {
  preferencesDefaults: ConsolePreferences;
  runtimeDefaults: EditableConsoleRuntimeSettings;
  workspaceDefaultsDefaults: EditableConsoleWorkspaceDefaults;
  filePath: string;
  references: {
    controlApiBaseUrl: string;
    gatewayProxyPathPrefix: string;
    webAdminHealthPath: string;
  };
  runtimeSettings: ConsoleRuntimeSettings;
  workspaceDefaultsById: Record<string, EditableConsoleWorkspaceDefaults>;
  updatedAt: string | null;
  source: ConsoleSettingsSource;
};

const defaultGatewayBaseUrl = "http://127.0.0.1:4002";
const defaultGatewayRequestBasePath = "/v1";
const defaultGatewayChatCompletionsPath = "/chat/completions";
const defaultGatewayResponsesPath = "/responses";
const defaultGatewayModelsPath = "/models";
const defaultGatewayHealthPath = "/healthz";
const defaultGatewayRequestTimeoutMs = 15_000;
const defaultWorkspaceVirtualKeyTtlHours = 24;

function isLikelyUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    value,
  );
}

export function normalizeAbsoluteUrl(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    throw new Error("Gateway endpoint is required.");
  }

  let parsed: URL;

  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("Gateway endpoint must be a valid absolute URL.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Gateway endpoint must use http or https.");
  }

  return parsed.toString().replace(/\/+$/, "");
}

export function normalizeRequestPath(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    throw new Error("Request path is required.");
  }

  const normalized = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  const compacted = normalized.replace(/\/{2,}/g, "/");

  if (compacted.length > 1) {
    return compacted.replace(/\/+$/, "");
  }

  return compacted;
}

export function normalizeTimeoutMs(value: number | string) {
  const numericValue =
    typeof value === "number" ? value : Number.parseInt(String(value).trim(), 10);

  if (!Number.isFinite(numericValue) || Number.isNaN(numericValue)) {
    throw new Error("Request timeout must be a valid number.");
  }

  const normalized = Math.trunc(numericValue);

  if (normalized < 500 || normalized > 120_000) {
    throw new Error("Request timeout must be between 500ms and 120000ms.");
  }

  return normalized;
}

function normalizeNullableUuid(value: string | null | undefined) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed && isLikelyUuid(trimmed) ? trimmed : null;
}

function normalizeNullableHint(value: string | null | undefined) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 160) : null;
}

export function normalizeVirtualKeyTtlHours(value: number | string | null | undefined) {
  const numericValue =
    typeof value === "number" ? value : Number.parseInt(String(value ?? "").trim(), 10);

  if (!Number.isFinite(numericValue) || Number.isNaN(numericValue)) {
    throw new Error("Default virtual key TTL must be a valid number.");
  }

  const normalized = Math.trunc(numericValue);

  if (normalized < 1 || normalized > 720) {
    throw new Error("Default virtual key TTL must be between 1 and 720 hours.");
  }

  return normalized;
}

export function normalizeWorkspaceScopesTemplate(
  value: string[] | string | null | undefined,
) {
  if (Array.isArray(value)) {
    return normalizeVirtualKeyScopes(value);
  }

  if (typeof value === "string") {
    return normalizeVirtualKeyScopes(
      value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean),
    );
  }

  return [];
}

export function getControlApiBaseUrlReference() {
  return process.env.CONTROL_API_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_CONTROL_API_BASE_URL?.trim() ||
    "http://127.0.0.1:4001";
}

export function getDefaultConsoleRuntimeSettings(): EditableConsoleRuntimeSettings {
  const rawDefaults = {
    gatewayBaseUrl:
      process.env.GATEWAY_PUBLIC_BASE_URL?.trim() || defaultGatewayBaseUrl,
    gatewayRequestBasePath:
      process.env.GATEWAY_REQUEST_BASE_PATH?.trim() ||
      defaultGatewayRequestBasePath,
    gatewayChatCompletionsPath:
      process.env.GATEWAY_CHAT_COMPLETIONS_PATH?.trim() ||
      defaultGatewayChatCompletionsPath,
    gatewayResponsesPath:
      process.env.GATEWAY_RESPONSES_PATH?.trim() ||
      defaultGatewayResponsesPath,
    gatewayModelsPath:
      process.env.GATEWAY_MODELS_PATH?.trim() || defaultGatewayModelsPath,
    gatewayHealthPath:
      process.env.GATEWAY_HEALTH_PATH?.trim() || defaultGatewayHealthPath,
    gatewayRequestTimeoutMs:
      process.env.GATEWAY_REQUEST_TIMEOUT_MS?.trim() ||
      defaultGatewayRequestTimeoutMs,
  };

  return normalizeConsoleRuntimeSettings(rawDefaults, {
    gatewayBaseUrl: defaultGatewayBaseUrl,
    gatewayRequestBasePath: defaultGatewayRequestBasePath,
    gatewayChatCompletionsPath: defaultGatewayChatCompletionsPath,
    gatewayResponsesPath: defaultGatewayResponsesPath,
    gatewayModelsPath: defaultGatewayModelsPath,
    gatewayHealthPath: defaultGatewayHealthPath,
    gatewayRequestTimeoutMs: defaultGatewayRequestTimeoutMs,
  });
}

export function getDefaultConsoleWorkspaceDefaults(): EditableConsoleWorkspaceDefaults {
  return {
    defaultProviderConnectionId: null,
    defaultModelCatalogSourceHint: null,
    defaultVirtualKeyTtlHours: defaultWorkspaceVirtualKeyTtlHours,
    defaultVirtualKeyScopesTemplate: [],
    defaultProjectId: null,
  };
}

function withFallback<T>(
  value: string | undefined,
  fallback: T,
  normalize: (input: string) => T,
) {
  if (typeof value !== "string") {
    return fallback;
  }

  try {
    return normalize(value);
  } catch {
    return fallback;
  }
}

function withNumericFallback(
  value: number | string | undefined,
  fallback: number,
  normalize: (input: number | string) => number,
) {
  if (typeof value !== "string" && typeof value !== "number") {
    return fallback;
  }

  try {
    return normalize(value);
  } catch {
    return fallback;
  }
}

export function normalizeConsoleRuntimeSettings(
  input: Partial<ConsoleRuntimeSettingsInput> | null | undefined,
  defaults = getDefaultConsoleRuntimeSettings(),
): EditableConsoleRuntimeSettings {
  return {
    gatewayBaseUrl: withFallback(
      input?.gatewayBaseUrl,
      defaults.gatewayBaseUrl,
      normalizeAbsoluteUrl,
    ),
    gatewayRequestBasePath: withFallback(
      input?.gatewayRequestBasePath,
      defaults.gatewayRequestBasePath,
      normalizeRequestPath,
    ),
    gatewayChatCompletionsPath: withFallback(
      input?.gatewayChatCompletionsPath,
      defaults.gatewayChatCompletionsPath,
      normalizeRequestPath,
    ),
    gatewayResponsesPath: withFallback(
      input?.gatewayResponsesPath,
      defaults.gatewayResponsesPath,
      normalizeRequestPath,
    ),
    gatewayModelsPath: withFallback(
      input?.gatewayModelsPath,
      defaults.gatewayModelsPath,
      normalizeRequestPath,
    ),
    gatewayHealthPath: withFallback(
      input?.gatewayHealthPath,
      defaults.gatewayHealthPath,
      normalizeRequestPath,
    ),
    gatewayRequestTimeoutMs: withNumericFallback(
      input?.gatewayRequestTimeoutMs,
      defaults.gatewayRequestTimeoutMs,
      normalizeTimeoutMs,
    ),
  };
}

export function normalizeConsoleWorkspaceDefaults(
  input: ConsoleWorkspaceDefaultsInput | null | undefined,
  defaults = getDefaultConsoleWorkspaceDefaults(),
): EditableConsoleWorkspaceDefaults {
  return {
    defaultProviderConnectionId:
      normalizeNullableUuid(input?.defaultProviderConnectionId) ??
      defaults.defaultProviderConnectionId,
    defaultModelCatalogSourceHint:
      normalizeNullableHint(input?.defaultModelCatalogSourceHint) ??
      defaults.defaultModelCatalogSourceHint,
    defaultVirtualKeyTtlHours:
      input?.defaultVirtualKeyTtlHours === null || input?.defaultVirtualKeyTtlHours === undefined
        ? defaults.defaultVirtualKeyTtlHours
        : (() => {
            try {
              return normalizeVirtualKeyTtlHours(input.defaultVirtualKeyTtlHours);
            } catch {
              return defaults.defaultVirtualKeyTtlHours;
            }
          })(),
    defaultVirtualKeyScopesTemplate:
      input?.defaultVirtualKeyScopesTemplate === null ||
      input?.defaultVirtualKeyScopesTemplate === undefined
        ? defaults.defaultVirtualKeyScopesTemplate
        : normalizeWorkspaceScopesTemplate(input.defaultVirtualKeyScopesTemplate),
    defaultProjectId:
      normalizeNullableUuid(input?.defaultProjectId) ?? defaults.defaultProjectId,
  };
}

export function validateConsoleRuntimeSettings(
  input: EditableConsoleRuntimeSettings,
): EditableConsoleRuntimeSettings {
  return {
    gatewayBaseUrl: normalizeAbsoluteUrl(input.gatewayBaseUrl),
    gatewayRequestBasePath: normalizeRequestPath(input.gatewayRequestBasePath),
    gatewayChatCompletionsPath: normalizeRequestPath(
      input.gatewayChatCompletionsPath,
    ),
    gatewayResponsesPath: normalizeRequestPath(input.gatewayResponsesPath),
    gatewayModelsPath: normalizeRequestPath(input.gatewayModelsPath),
    gatewayHealthPath: normalizeRequestPath(input.gatewayHealthPath),
    gatewayRequestTimeoutMs: normalizeTimeoutMs(input.gatewayRequestTimeoutMs),
  };
}

export function validateConsoleWorkspaceDefaults(
  input: EditableConsoleWorkspaceDefaults,
): EditableConsoleWorkspaceDefaults {
  return {
    defaultProviderConnectionId: normalizeNullableUuid(
      input.defaultProviderConnectionId,
    ),
    defaultModelCatalogSourceHint: normalizeNullableHint(
      input.defaultModelCatalogSourceHint,
    ),
    defaultVirtualKeyTtlHours: normalizeVirtualKeyTtlHours(
      input.defaultVirtualKeyTtlHours,
    ),
    defaultVirtualKeyScopesTemplate: normalizeWorkspaceScopesTemplate(
      input.defaultVirtualKeyScopesTemplate,
    ),
    defaultProjectId: normalizeNullableUuid(input.defaultProjectId),
  };
}

export function buildGatewayDirectUrl(
  settings: Pick<EditableConsoleRuntimeSettings, "gatewayBaseUrl">,
  requestPath: string,
) {
  const baseUrl = normalizeAbsoluteUrl(settings.gatewayBaseUrl);
  const normalizedRequestPath = normalizeRequestPath(requestPath);

  return normalizedRequestPath === "/" ? baseUrl : `${baseUrl}${normalizedRequestPath}`;
}

export function buildGatewayEndpoint(
  settings: Pick<
    EditableConsoleRuntimeSettings,
    "gatewayBaseUrl" | "gatewayRequestBasePath"
  >,
) {
  const baseUrl = normalizeAbsoluteUrl(settings.gatewayBaseUrl);
  const basePath = normalizeRequestPath(settings.gatewayRequestBasePath);

  return basePath === "/" ? baseUrl : `${baseUrl}${basePath}`;
}

export function buildGatewayRequestUrl(
  settings: Pick<
    EditableConsoleRuntimeSettings,
    "gatewayBaseUrl" | "gatewayRequestBasePath"
  >,
  requestPath: string,
) {
  const endpoint = buildGatewayEndpoint(settings);
  const normalizedRequestPath = normalizeRequestPath(requestPath);

  return normalizedRequestPath === "/" ? endpoint : `${endpoint}${normalizedRequestPath}`;
}

export function buildGatewayProxyUpstreamUrl(
  settings: Pick<
    EditableConsoleRuntimeSettings,
    "gatewayBaseUrl" | "gatewayRequestBasePath"
  >,
  pathSegments: string[],
  search: string,
) {
  const endpoint = buildGatewayEndpoint(settings);
  const suffix = pathSegments.length > 0 ? `/${pathSegments.join("/")}` : "";

  return `${endpoint}${suffix}${search}`;
}

function buildConsoleSettingsReferences() {
  return {
    controlApiBaseUrl: getControlApiBaseUrlReference(),
    gatewayProxyPathPrefix: "/v1",
    webAdminHealthPath: "/api/healthz",
  };
}

export function getConsoleSettingsFilePath() {
  const configuredPath = process.env.WEB_ADMIN_SETTINGS_FILE?.trim();

  if (configuredPath) {
    return configuredPath;
  }

  return path.resolve(process.cwd(), ".local", "console-runtime-settings.json");
}

function isStoredConsoleSettingsFile(
  value: unknown,
): value is StoredConsoleSettingsFile {
  return Boolean(
    value &&
      typeof value === "object" &&
      "version" in value &&
      "runtimeSettings" in value,
  );
}

async function readConsoleSettingsFile(filePath: string) {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;

    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    if (error instanceof SyntaxError) {
      return null;
    }

    throw error;
  }
}

function normalizeWorkspaceDefaultsMap(
  input: Record<string, unknown> | null | undefined,
): Record<string, EditableConsoleWorkspaceDefaults> {
  if (!input) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(input)
      .filter((entry) => isLikelyUuid(entry[0]))
      .map(([workspaceId, value]) => [
        workspaceId,
        normalizeConsoleWorkspaceDefaults(
          (value as ConsoleWorkspaceDefaultsInput | null | undefined) ?? undefined,
        ),
      ]),
  );
}

function buildStoredConsoleSettingsFile(args: {
  runtimeSettings: EditableConsoleRuntimeSettings;
  workspaceDefaultsById: Record<string, EditableConsoleWorkspaceDefaults>;
}) {
  return {
    version: 1 as const,
    updatedAt: new Date().toISOString(),
    runtimeSettings: validateConsoleRuntimeSettings(args.runtimeSettings),
    workspaceDefaultsById: Object.fromEntries(
      Object.entries(args.workspaceDefaultsById).map(([workspaceId, defaults]) => [
        workspaceId,
        validateConsoleWorkspaceDefaults(defaults),
      ]),
    ),
  };
}

function normalizeStoredSettings(
  rawFile: unknown,
): Pick<ConsoleSettingsPayload, "runtimeSettings" | "workspaceDefaultsById" | "updatedAt" | "source"> {
  const runtimeDefaults = getDefaultConsoleRuntimeSettings();

  if (isStoredConsoleSettingsFile(rawFile)) {
    return {
      runtimeSettings: {
        ...normalizeConsoleRuntimeSettings(rawFile.runtimeSettings, runtimeDefaults),
        updatedAt: typeof rawFile.updatedAt === "string" ? rawFile.updatedAt : null,
      },
      workspaceDefaultsById: normalizeWorkspaceDefaultsMap(
        rawFile.workspaceDefaultsById,
      ),
      updatedAt: typeof rawFile.updatedAt === "string" ? rawFile.updatedAt : null,
      source: "file",
    };
  }

  if (rawFile && typeof rawFile === "object") {
    const legacyRuntime = rawFile as LegacyConsoleRuntimeSettingsFile;

    return {
      runtimeSettings: {
        ...normalizeConsoleRuntimeSettings(legacyRuntime, runtimeDefaults),
        updatedAt:
          typeof legacyRuntime.updatedAt === "string"
            ? legacyRuntime.updatedAt
            : null,
      },
      workspaceDefaultsById: {},
      updatedAt:
        typeof legacyRuntime.updatedAt === "string" ? legacyRuntime.updatedAt : null,
      source: "file",
    };
  }

  return {
    runtimeSettings: {
      ...runtimeDefaults,
      updatedAt: null,
    },
    workspaceDefaultsById: {},
    updatedAt: null,
    source: "defaults",
  };
}

export async function loadConsoleSettings(): Promise<ConsoleSettingsPayload> {
  const runtimeDefaults = getDefaultConsoleRuntimeSettings();
  const workspaceDefaultsDefaults = getDefaultConsoleWorkspaceDefaults();
  const filePath = getConsoleSettingsFilePath();
  const rawFile = await readConsoleSettingsFile(filePath);
  const normalized = normalizeStoredSettings(rawFile);

  return {
    preferencesDefaults: getDefaultConsolePreferences(),
    runtimeDefaults,
    workspaceDefaultsDefaults,
    filePath,
    references: buildConsoleSettingsReferences(),
    runtimeSettings: normalized.runtimeSettings,
    workspaceDefaultsById: normalized.workspaceDefaultsById,
    updatedAt: normalized.updatedAt,
    source: normalized.source,
  };
}

export async function loadConsoleRuntimeSettings() {
  const settings = await loadConsoleSettings();

  return {
    defaults: settings.runtimeDefaults,
    filePath: settings.filePath,
    references: settings.references,
    settings: settings.runtimeSettings,
    source: settings.source,
    updatedAt: settings.updatedAt,
  };
}

async function persistConsoleSettingsFile(payload: StoredConsoleSettingsFile) {
  const filePath = getConsoleSettingsFilePath();
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export async function saveConsoleRuntimeSettings(
  input: EditableConsoleRuntimeSettings,
): Promise<ConsoleSettingsPayload> {
  const currentSettings = await loadConsoleSettings();
  const nextFile = buildStoredConsoleSettingsFile({
    runtimeSettings: input,
    workspaceDefaultsById: currentSettings.workspaceDefaultsById,
  });

  await persistConsoleSettingsFile(nextFile);

  return loadConsoleSettings();
}

export async function saveConsoleWorkspaceDefaults(
  workspaceId: string,
  input: EditableConsoleWorkspaceDefaults,
): Promise<ConsoleSettingsPayload> {
  if (!isLikelyUuid(workspaceId)) {
    throw new Error("workspaceId must be a valid UUID.");
  }

  const currentSettings = await loadConsoleSettings();
  const nextWorkspaceDefaultsById = {
    ...currentSettings.workspaceDefaultsById,
    [workspaceId]: validateConsoleWorkspaceDefaults(input),
  };
  const nextFile = buildStoredConsoleSettingsFile({
    runtimeSettings: currentSettings.runtimeSettings,
    workspaceDefaultsById: nextWorkspaceDefaultsById,
  });

  await persistConsoleSettingsFile(nextFile);

  return loadConsoleSettings();
}
