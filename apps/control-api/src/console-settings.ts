import { readFile } from "node:fs/promises";
import path from "node:path";

const defaultWorkspaceVirtualKeyTtlHours = 24;

type StoredWorkspaceDefaults = {
  defaultVirtualKeyTtlHours?: number | string | null;
};

type StoredConsoleSettingsFile = {
  workspaceDefaultsById?: Record<string, StoredWorkspaceDefaults | null | undefined>;
};

function isLikelyUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    value,
  );
}

function normalizeVirtualKeyTtlHours(value: number | string | null | undefined) {
  const numericValue =
    typeof value === "number" ? value : Number.parseInt(String(value ?? "").trim(), 10);

  if (!Number.isFinite(numericValue) || Number.isNaN(numericValue)) {
    return defaultWorkspaceVirtualKeyTtlHours;
  }

  const normalized = Math.trunc(numericValue);

  if (normalized < 1 || normalized > 720) {
    return defaultWorkspaceVirtualKeyTtlHours;
  }

  return normalized;
}

export function getConsoleSettingsFilePath() {
  const configuredPath = process.env.WEB_ADMIN_SETTINGS_FILE?.trim();

  if (configuredPath) {
    return configuredPath;
  }

  return path.resolve(process.cwd(), ".local", "console-runtime-settings.json");
}

async function readConsoleSettingsFile(filePath: string) {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as StoredConsoleSettingsFile) : null;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || error instanceof SyntaxError) {
      return null;
    }

    throw error;
  }
}

export async function loadWorkspaceDefaultVirtualKeyTtlHours(workspaceId: string) {
  if (!isLikelyUuid(workspaceId)) {
    return defaultWorkspaceVirtualKeyTtlHours;
  }

  const settings = await readConsoleSettingsFile(getConsoleSettingsFilePath());
  const workspaceDefaults = settings?.workspaceDefaultsById?.[workspaceId];

  return normalizeVirtualKeyTtlHours(workspaceDefaults?.defaultVirtualKeyTtlHours);
}
