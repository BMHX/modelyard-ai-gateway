export type ConsoleThemePreference = "light" | "dark" | "system";
export type ConsoleAccentPreset = "blue" | "green" | "amber";
export type ConsoleFontSizePreference = "small" | "medium" | "large";
export type ConsoleDensityPreference = "compact" | "standard" | "comfortable";
export type ConsoleSidebarWidthPreference = "narrow" | "standard" | "wide";
export type ConsoleLandingPagePreference =
  | "home"
  | "workspaces"
  | "providers"
  | "usage-events";

export type ConsolePreferences = {
  themeMode: ConsoleThemePreference;
  accentPreset: ConsoleAccentPreset;
  fontSize: ConsoleFontSizePreference;
  density: ConsoleDensityPreference;
  sidebarWidth: ConsoleSidebarWidthPreference;
  defaultLandingPage: ConsoleLandingPagePreference;
  rememberLastWorkspace: boolean;
  rememberLastFilters: boolean;
  showSupportPanelsByDefault: boolean;
};

export const consolePreferencesStorageKey = "teamops:console-preferences";
export const consolePreferencesChangedEventName = "teamops:console-preferences-changed";
export const rememberedFiltersStorageKey = "teamops:remembered-filters";

const eligibleRememberedFilterPaths = new Set([
  "/providers",
  "/virtual-keys",
  "/usage-events",
  "/audit-logs",
  "/alerts",
  "/members",
  "/projects",
]);

const landingPageHrefByPreference: Record<ConsoleLandingPagePreference, string> = {
  home: "/",
  workspaces: "/workspaces",
  providers: "/providers",
  "usage-events": "/usage-events",
};

export function getDefaultConsolePreferences(): ConsolePreferences {
  return {
    themeMode: "system",
    accentPreset: "blue",
    fontSize: "medium",
    density: "standard",
    sidebarWidth: "standard",
    defaultLandingPage: "home",
    rememberLastWorkspace: true,
    rememberLastFilters: true,
    showSupportPanelsByDefault: true,
  };
}

export function normalizeConsolePreferences(
  input: Partial<ConsolePreferences> | null | undefined,
): ConsolePreferences {
  const defaults = getDefaultConsolePreferences();

  return {
    themeMode:
      input?.themeMode === "light" ||
      input?.themeMode === "dark" ||
      input?.themeMode === "system"
        ? input.themeMode
        : defaults.themeMode,
    accentPreset:
      input?.accentPreset === "blue" ||
      input?.accentPreset === "green" ||
      input?.accentPreset === "amber"
        ? input.accentPreset
        : defaults.accentPreset,
    fontSize:
      input?.fontSize === "small" ||
      input?.fontSize === "medium" ||
      input?.fontSize === "large"
        ? input.fontSize
        : defaults.fontSize,
    density:
      input?.density === "compact" ||
      input?.density === "standard" ||
      input?.density === "comfortable"
        ? input.density
        : defaults.density,
    sidebarWidth:
      input?.sidebarWidth === "narrow" ||
      input?.sidebarWidth === "standard" ||
      input?.sidebarWidth === "wide"
        ? input.sidebarWidth
        : defaults.sidebarWidth,
    defaultLandingPage:
      input?.defaultLandingPage === "home" ||
      input?.defaultLandingPage === "workspaces" ||
      input?.defaultLandingPage === "providers" ||
      input?.defaultLandingPage === "usage-events"
        ? input.defaultLandingPage
        : defaults.defaultLandingPage,
    rememberLastWorkspace:
      typeof input?.rememberLastWorkspace === "boolean"
        ? input.rememberLastWorkspace
        : defaults.rememberLastWorkspace,
    rememberLastFilters:
      typeof input?.rememberLastFilters === "boolean"
        ? input.rememberLastFilters
        : defaults.rememberLastFilters,
    showSupportPanelsByDefault:
      typeof input?.showSupportPanelsByDefault === "boolean"
        ? input.showSupportPanelsByDefault
        : defaults.showSupportPanelsByDefault,
  };
}

function readRawConsolePreferences(storage: Storage | null | undefined) {
  if (!storage) {
    return null;
  }

  try {
    const raw = storage.getItem(consolePreferencesStorageKey);
    if (!raw) {
      return null;
    }

    return JSON.parse(raw) as Partial<ConsolePreferences>;
  } catch {
    return null;
  }
}

export function readConsolePreferences(storage: Storage | null | undefined) {
  return normalizeConsolePreferences(readRawConsolePreferences(storage));
}

export function persistConsolePreferences(
  storage: Storage | null | undefined,
  preferences: ConsolePreferences,
) {
  if (!storage) {
    return;
  }

  const normalized = normalizeConsolePreferences(preferences);
  storage.setItem(consolePreferencesStorageKey, JSON.stringify(normalized));

  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(consolePreferencesChangedEventName, {
        detail: normalized,
      }),
    );
  }
}

export function getConsoleAccentStyleVariables(
  accentPreset: ConsoleAccentPreset,
): Record<string, string> {
  if (accentPreset === "green") {
    return {
      "--primary": "hsl(156 52% 42%)",
      "--primary-strong": "hsl(156 58% 34%)",
      "--primary-border": "hsla(156 52% 42% / 0.24)",
      "--primary-border-strong": "hsla(156 52% 42% / 0.34)",
      "--primary-soft": "hsla(156 52% 42% / 0.06)",
      "--primary-soft-strong": "hsla(156 52% 42% / 0.1)",
      "--primary-soft-surface": "hsla(156 52% 42% / 0.14)",
      "--surface-selected": "hsla(156 52% 42% / 0.085)",
      "--surface-selected-strong": "hsla(156 52% 42% / 0.13)",
      "--info": "hsl(156 52% 42%)",
      "--info-strong": "hsl(156 58% 34%)",
    };
  }

  if (accentPreset === "amber") {
    return {
      "--primary": "hsl(31 84% 48%)",
      "--primary-strong": "hsl(28 84% 39%)",
      "--primary-border": "hsla(31 84% 48% / 0.24)",
      "--primary-border-strong": "hsla(31 84% 48% / 0.34)",
      "--primary-soft": "hsla(31 84% 48% / 0.06)",
      "--primary-soft-strong": "hsla(31 84% 48% / 0.1)",
      "--primary-soft-surface": "hsla(31 84% 48% / 0.14)",
      "--surface-selected": "hsla(31 84% 48% / 0.085)",
      "--surface-selected-strong": "hsla(31 84% 48% / 0.13)",
      "--info": "hsl(31 84% 48%)",
      "--info-strong": "hsl(28 84% 39%)",
    };
  }

  return {};
}

export function getConsoleFontSizePx(fontSize: ConsoleFontSizePreference) {
  if (fontSize === "small") {
    return 15;
  }

  if (fontSize === "large") {
    return 17;
  }

  return 16;
}

export function getConsoleSidebarWidth(sidebarWidth: ConsoleSidebarWidthPreference) {
  if (sidebarWidth === "narrow") {
    return "216px";
  }

  if (sidebarWidth === "wide") {
    return "280px";
  }

  return "248px";
}

export function isRememberedFilterEligiblePath(pathname: string) {
  return eligibleRememberedFilterPaths.has(pathname);
}

export function getConsoleLandingHref(
  landingPage: ConsoleLandingPagePreference,
  workspaceId: string | null,
) {
  const baseHref = landingPageHrefByPreference[landingPage];

  if (!workspaceId || baseHref === "/") {
    return baseHref;
  }

  const params = new URLSearchParams();
  params.set("workspaceId", workspaceId);
  return `${baseHref}?${params.toString()}`;
}

export function stripRememberedFilterParams(searchParams: URLSearchParams) {
  const params = new URLSearchParams(searchParams.toString());
  const hasTransientMemberState = params.has("focusMemberId") || params.has("task");

  params.delete("workspaceId");
  params.delete("returnTo");
  params.delete("notice");
  params.delete("message");
  params.delete("focusMemberId");
  params.delete("task");

  if (hasTransientMemberState) {
    params.delete("projectId");
  }

  return params;
}

export type RememberedFilterRecord = Record<string, string>;

export function readRememberedFilterRecord(storage: Storage | null | undefined) {
  if (!storage) {
    return {};
  }

  try {
    const raw = storage.getItem(rememberedFiltersStorageKey);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  } catch {
    return {};
  }
}

export function writeRememberedFilterRecord(
  storage: Storage | null | undefined,
  record: RememberedFilterRecord,
) {
  if (!storage) {
    return;
  }

  storage.setItem(rememberedFiltersStorageKey, JSON.stringify(record));
}
