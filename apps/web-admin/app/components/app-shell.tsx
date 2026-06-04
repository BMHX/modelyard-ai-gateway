"use client";

import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  Command,
  LaptopMinimal,
  Languages,
  Link2,
  LogIn,
  LogOut,
  MoonStar,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  SunMedium,
  User,
  Workflow,
} from "lucide-react";
import { Link } from "@/i18n/navigation";
import { motion } from "framer-motion";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { usePathname, useRouter } from "@/i18n/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import {
  useCallback,
  createContext,
  useDeferredValue,
  useEffect,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type SetStateAction,
} from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/shared/empty-state";
import { cn } from "@/lib/utils";

import { buildContextualHref, describeNavigationTarget } from "../lib/navigation";
import { canAccessConsoleRoute } from "../lib/route-access";
import { workspacePreferenceCookieName, workspacePreferenceMaxAgeSeconds } from "../lib/workspace-preference";
import { EMPTY_CAPABILITIES, type Capabilities } from "../lib/capabilities";
import { homeNavItem, getNavSections } from "../nav";
import {
  ConsoleAuthRedirectError,
  ConsoleHttpError,
  postConsoleVoid,
  prefetchConsoleRouteData,
} from "../lib/console-api-client";
import { localeOptions, useLocalePreference, useT } from "../lib/i18n-client";
import { stripLocalePrefix } from "../lib/i18n";
import { resolveWorkspaceIdentitySelection } from "../lib/auth-identities";
import {
  consolePreferencesStorageKey,
  consolePreferencesChangedEventName,
  getConsoleAccentStyleVariables,
  getConsoleFontSizePx,
  getConsoleLandingHref,
  getConsoleSidebarWidth,
  getDefaultConsolePreferences,
  isRememberedFilterEligiblePath,
  persistConsolePreferences,
  readConsolePreferences,
  readRememberedFilterRecord,
  stripRememberedFilterParams,
  writeRememberedFilterRecord,
  type ConsolePreferences,
  type ConsoleThemePreference,
} from "../lib/console-preferences";
import { useCapabilities, useShellSession } from "./capability-provider";
import { IdentitySwitcher } from "./identity-switcher";
import { OrganizationDropdown } from "../organizations/organization-dropdown";
import { ResourceInlineNotice } from "./resource-inline-notice";

const recentVisitStorageKey = "teamops:recent-visits";
const recentWorkspaceStorageKey = "teamops:recent-workspaces";
const favoriteSurfaceStorageKey = "teamops:favorite-surfaces";
const focusModeStorageKey = "teamops:focus-mode";
const recentNavigationStorageTtlMs = 12 * 60 * 60 * 1000;
const maxStoredRecentVisits = 4;
const maxStoredRecentWorkspaces = 4;
const shellKey = (value: string) => `shell.${value}`;

const shellThemeOptions = [
  {
    value: "light",
    label: shellKey("themes.light"),
    icon: SunMedium,
  },
  {
    value: "dark",
    label: shellKey("themes.dark"),
    icon: MoonStar,
  },
  {
    value: "system",
    label: shellKey("themes.system"),
    icon: LaptopMinimal,
  },
] as const;

type StoredRecentVisit = {
  href: string;
  visitedAt: number;
  workspaceId?: string | null;
  descriptorKey?: string;
  descriptorProps?: Record<string, string>;
};

type StoredRecentWorkspace = {
  id: string;
  visitedAt: number;
  workspaceName?: string | null;
};

type StoredFavoriteSurface = {
  href: string;
  savedAt: number;
  workspaceId?: string | null;
  workspaceName?: string | null;
  descriptorKey?: string;
  descriptorProps?: Record<string, string>;
};

type SurfaceDescriptorInput = {
  href: string;
  workspaceId?: string | null;
  workspaceName?: string | null;
  visitedAt?: number;
  savedAt?: number;
  source: "favorite" | "recent";
  descriptorKey?: string;
  descriptorProps?: Record<string, string>;
};

type SurfaceDescriptorOutput = {
  label: string;
  description: string;
  meta: string;
  section: string;
  keywords: string;
};

function normalizeNavHref(value: string) {
  try {
    const url = new URL(value, "http://localhost");
    const params = url.searchParams;
    const query = params.toString();
    return query ? `${url.pathname}?${query}` : url.pathname;
  } catch {
    return value;
  }
}

function findNavDescriptor(href: string, workspaceId: string | null, sections: NavSectionLike[] = []) {
  const target = normalizeNavHref(href);

  const homeCandidate = normalizeNavHref(buildNavHref(homeNavItem.href, workspaceId));
  if (homeCandidate === target) {
    return {
      section: {
        label: shellKey("taskLane.home.label"),
        description: shellKey("taskLane.home.description"),
      },
      item: homeNavItem,
    };
  }

  for (const section of sections) {
    for (const item of section.items) {
      const candidate = normalizeNavHref(buildNavHref(item.href, workspaceId));
      if (candidate === target) {
        return { section, item };
      }
    }
  }

  return null;
}

type NavSectionLike = {
  label: string;
  description: string;
  items: Array<{
    href: string;
    label: string;
    description: string;
    keywords?: string[];
  }>;
};

function buildSurfaceDescriptorKey(href: string, workspaceId: string | null, sections: NavSectionLike[] = []) {
  const descriptor = findNavDescriptor(href, workspaceId, sections);
  if (!descriptor) {
    return undefined;
  }

  return `nav:${descriptor.item.href}`;
}

function extractWorkspaceIdFromHref(href: string) {
  try {
    const url = new URL(href, "http://localhost");
    return url.searchParams.get("workspaceId");
  } catch {
    return null;
  }
}

function extractPathnameFromHref(href: string) {
  try {
    return new URL(href, "http://localhost").pathname;
  } catch {
    return href.split("?")[0] || href;
  }
}

function isSameNavDestination(currentHref: string, nextHref: string) {
  return (
    extractPathnameFromHref(currentHref) === extractPathnameFromHref(nextHref) &&
    extractWorkspaceIdFromHref(currentHref) === extractWorkspaceIdFromHref(nextHref)
  );
}

function resolveSurfaceDescriptor(
  input: SurfaceDescriptorInput,
  { tr, locale }: { tr: ReturnType<typeof useT>; locale: string },
): SurfaceDescriptorOutput {
  const navDescriptor =
    typeof window === "undefined"
      ? null
      : findNavDescriptor(input.href, input.workspaceId ?? null, getNavSections({
          canAccessAdminSurfaces: false,
          canManageInfrastructure: false,
          canManageGovernance: false,
          canManageProjects: false,
          canManageMembers: false,
          canAccessDeveloperTools: false,
          canSelfServeVirtualKeys: false,
          canViewUsage: false,
          canReviewPrompts: false,
          isAdvancedUser: false,
          isManager: false,
        }));
  const sectionLabel = navDescriptor?.section
    ? tr(navDescriptor.section.label)
    : tr("savedViewsLabel");
  const label = navDescriptor?.item ? tr(navDescriptor.item.label) : input.href;
  const navDescription = navDescriptor?.item ? tr(navDescriptor.item.description) : null;
  const keywords = navDescriptor
    ? `${navDescriptor.section.label} ${navDescriptor.item.label} ${navDescriptor.item.description} ${(navDescriptor.item.keywords ?? []).join(
        " ",
      )}`
    : "";
  const visitTime = formatVisitTime(input.visitedAt ?? Date.now(), locale);
  const favoriteMeta = input.workspaceName
    ? `${input.workspaceName} · ${tr("savedViewLabel")}`
    : tr("savedViewLabel");
  const recentMeta = tr("recentVisitMeta", { time: visitTime });
  const description =
    navDescription ??
    (input.source === "recent"
      ? tr("recentVisitDescription", { time: visitTime })
      : tr("savedViewLabel"));

  return {
    label,
    description,
    meta: input.source === "favorite" ? favoriteMeta : recentMeta,
    section: sectionLabel,
    keywords,
  };
}

const AppShellCommandPalette = dynamic(
  () =>
    import("./app-shell-command-palette").then(
      (module) => module.AppShellCommandPalette,
    ),
  {
    ssr: false,
  },
);

const AppShellSupportPanels = dynamic(
  () =>
    import("./app-shell-support-panels").then(
      (module) => module.AppShellSupportPanels,
    ),
  {
    ssr: false,
  },
);

type CommandPaletteItem = {
  id: string;
  label: string;
  description: string;
  href: string;
  section: string;
  sectionLabel?: string;
  keywords: string;
  shortcutLabel?: string;
  action?: () => void;
};

type WorkspaceJumpItem = {
  id: string;
  label: string;
  href: string;
  visitedAt: number;
};

export type WorkspaceSelectorOption = {
  id: string;
  label: string;
};

type WorkspaceMenuItem = {
  id: string;
  label: string;
  meta?: string;
};

type ShellShortcut = {
  href: string;
  label: string;
  description?: string;
};

type ShellAction = {
  href: string;
  label: string;
};

type SurfaceMemoryItem = {
  id: string;
  label: string;
  href: string;
  description: string;
  meta: string;
  source: "favorite" | "recent";
};

type OperatorContextCard = {
  eyebrow: string;
  title: string;
  description: string;
  href: string;
  tone: "critical" | "warning" | "neutral";
  badge?: string;
  meta?: string;
  actionLabel?: string;
};

type TimedStorageEnvelope<T> = {
  value: T;
  expiresAt: number;
};

type ShellUserSummary = {
  id: string;
  email: string;
  name: string | null;
} | null;

export type AppShellProps = {
  title: string;
  subtitle: string;
  children: ReactNode;
  workspaceLabel?: string | null;
  workspaceId?: string | null;
  workspaceOptions?: WorkspaceSelectorOption[];
  workspaceSelectionSource?: "explicit" | "remembered" | "default" | "none";
  showOperatorContextCards?: boolean;
  headerMode?: "default" | "compact";
  sidebarVariant?: "default" | "minimal";
  showSupportPanels?: boolean;
};

type AppShellConfig = Omit<AppShellProps, "children">;
type AppShellConfigOverride = Partial<AppShellConfig>;

const alignedShellChrome = {
  showOperatorContextCards: false,
  headerMode: "compact",
  sidebarVariant: "minimal",
  showSupportPanels: false,
} satisfies Pick<
  AppShellConfig,
  "showOperatorContextCards" | "headerMode" | "sidebarVariant" | "showSupportPanels"
>;

const defaultShellConfig: AppShellConfig = {
  title: "ModelYard",
  subtitle: "",
  workspaceLabel: null,
  workspaceId: null,
  workspaceOptions: undefined,
  workspaceSelectionSource: "none",
  ...alignedShellChrome,
};

function createRouteShellConfig(title: string): AppShellConfig {
  return {
    ...defaultShellConfig,
    title,
  };
}

const appShellConfigContext = createContext<Dispatch<
  SetStateAction<AppShellConfigOverride | null>
> | null>(null);

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

function isTimedStorageEnvelope<T>(value: unknown): value is TimedStorageEnvelope<T> {
  return (
    typeof value === "object" &&
    value !== null &&
    "value" in value &&
    "expiresAt" in value &&
    typeof (value as TimedStorageEnvelope<T>).expiresAt === "number"
  );
}

function readJsonStorageValue<T>(storage: Storage, key: string) {
  const stored = storage.getItem(key);
  return stored ? (JSON.parse(stored) as T) : null;
}

function getUserBadgeLabel(user: ShellUserSummary) {
  if (!user) {
    return "?";
  }

  const source = user.name?.trim() || user.email;
  const segments = source
    .split(/[\s@._-]+/)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .slice(0, 2);

  if (!segments.length) {
    return "?";
  }

  return segments.map((segment) => segment[0]?.toUpperCase() ?? "").join("");
}

function AppShellUserMenu({
  currentHref,
  authStatus,
  isLoading,
  isError,
  user,
}: {
  currentHref: string;
  authStatus: "authenticated" | "unauthenticated";
  isLoading: boolean;
  isError: boolean;
  user: ShellUserSummary;
}) {
  const tr = useT();
  const displayName = user?.name?.trim() || user?.email || tr("User");
  const returnTo = encodeURIComponent(currentHref);
  const buttonLabel = isLoading
    ? tr("session.syncing")
    : authStatus === "authenticated"
      ? `${tr("Account")}: ${displayName}`
      : tr("Login");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={buttonLabel}
          className="h-[30px] w-auto gap-2 rounded-full border border-[color:var(--border-default)] bg-[color:color-mix(in_srgb,var(--surface-1)_94%,var(--surface-canvas)_6%)] px-2 text-[12px] font-medium text-foreground shadow-none hover:bg-[color:color-mix(in_srgb,var(--surface-1)_86%,var(--surface-hover)_14%)]"
          title={buttonLabel}
          type="button"
          variant="ghost"
        >
          <span className="flex size-5 items-center justify-center rounded-full bg-[color:var(--surface-3)] text-[10px] font-semibold text-foreground/80">
            {isLoading ? <MoreHorizontal className="size-3 animate-pulse" /> : user ? getUserBadgeLabel(user) : <User className="size-3" />}
          </span>
          <span className="hidden max-w-[11rem] truncate sm:block">
            {isLoading ? tr("session.syncing") : authStatus === "authenticated" ? displayName : tr("Login")}
          </span>
          <ChevronDown className="size-3.5 text-muted-foreground/70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {isLoading ? (
          <>
            <DropdownMenuLabel>{tr("Account")}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <div className="px-2 py-3 text-[12px] text-muted-foreground">{tr("session.syncing")}</div>
          </>
        ) : isError ? (
          <>
            <DropdownMenuLabel>{tr("Account")}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <div className="px-2 py-3 text-[12px] text-muted-foreground">{tr("session.unavailable")}</div>
          </>
        ) : authStatus === "authenticated" && user ? (
          <>
            <DropdownMenuLabel className="grid gap-0.5">
              <span className="truncate text-[13px] font-semibold text-foreground">{displayName}</span>
              <span className="truncate text-[11px] font-normal text-muted-foreground">{user.email}</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href={`/auth/select-identity?returnTo=${returnTo}`}>
                <User className="mr-2 size-4" />
                {tr("Switch identity")}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <form action="/auth/logout" method="post">
              <DropdownMenuItem asChild>
                <button className="flex w-full items-center" type="submit">
                  <LogOut className="mr-2 size-4" />
                  {tr("Logout")}
                </button>
              </DropdownMenuItem>
            </form>
          </>
        ) : (
          <>
            <DropdownMenuLabel>{tr("Account")}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href={`/login?returnTo=${returnTo}`}>
                <LogIn className="mr-2 size-4" />
                {tr("Login")}
              </Link>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function readTimedSessionStorageValue<T>(key: string) {
  const stored = readJsonStorageValue<TimedStorageEnvelope<T> | T>(window.sessionStorage, key);

  if (!stored) {
    return null;
  }

  if (isTimedStorageEnvelope<T>(stored)) {
    if (stored.expiresAt <= Date.now()) {
      window.sessionStorage.removeItem(key);
      return null;
    }

    return stored.value;
  }

  return stored as T;
}

function writeTimedSessionStorageValue<T>(key: string, value: T, ttlMs: number) {
  window.sessionStorage.setItem(
    key,
    JSON.stringify({
      value,
      expiresAt: Date.now() + ttlMs,
    } satisfies TimedStorageEnvelope<T>),
  );
}

function normalizeStoredRecentVisit(entry: unknown): StoredRecentVisit | null {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const record = entry as Record<string, unknown>;
  const href = typeof record.href === "string" ? record.href : null;
  if (!href) {
    return null;
  }

  const visitedAt = typeof record.visitedAt === "number" ? record.visitedAt : Date.now();
  const workspaceId =
    typeof record.workspaceId === "string"
      ? record.workspaceId
      : extractWorkspaceIdFromHref(href);
  const descriptorKey =
    typeof record.descriptorKey === "string"
      ? record.descriptorKey
      : buildSurfaceDescriptorKey(href, workspaceId ?? null);
  const descriptorProps =
    typeof record.descriptorProps === "object" && record.descriptorProps !== null
      ? (record.descriptorProps as Record<string, string>)
      : undefined;

  return {
    href,
    visitedAt,
    workspaceId: workspaceId ?? null,
    descriptorKey,
    descriptorProps,
  };
}

function normalizeStoredRecentWorkspace(entry: unknown): StoredRecentWorkspace | null {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const record = entry as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id : null;
  if (!id) {
    return null;
  }

  const visitedAt = typeof record.visitedAt === "number" ? record.visitedAt : Date.now();
  const workspaceName =
    typeof record.workspaceName === "string"
      ? record.workspaceName
      : typeof record.label === "string"
        ? record.label
        : null;

  return {
    id,
    visitedAt,
    workspaceName,
  };
}

function getStoredRecentWorkspaceName(workspaceName?: string | null) {
  const normalized = workspaceName?.trim();
  return normalized ? normalized : null;
}

function normalizeStoredFavoriteSurface(entry: unknown): StoredFavoriteSurface | null {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const record = entry as Record<string, unknown>;
  const href = typeof record.href === "string" ? record.href : null;
  if (!href) {
    return null;
  }

  const savedAt = typeof record.savedAt === "number" ? record.savedAt : Date.now();
  const workspaceId =
    typeof record.workspaceId === "string"
      ? record.workspaceId
      : extractWorkspaceIdFromHref(href);
  const workspaceName =
    typeof record.workspaceName === "string"
      ? record.workspaceName
      : typeof record.workspaceLabel === "string"
        ? record.workspaceLabel
        : null;
  const descriptorKey =
    typeof record.descriptorKey === "string"
      ? record.descriptorKey
      : buildSurfaceDescriptorKey(href, workspaceId ?? null);
  const descriptorProps =
    typeof record.descriptorProps === "object" && record.descriptorProps !== null
      ? (record.descriptorProps as Record<string, string>)
      : undefined;

  return {
    href,
    savedAt,
    workspaceId: workspaceId ?? null,
    workspaceName,
    descriptorKey,
    descriptorProps,
  };
}

function buildNavHref(href: string, workspaceId: string | null) {
  const params = new URLSearchParams();

  if (workspaceId) {
    params.set("workspaceId", workspaceId);
  }

  return params.toString() ? `${href}?${params.toString()}` : href;
}

function buildWorkspaceScopedHref(
  pathname: string,
  searchParams: Pick<URLSearchParams, "toString">,
  workspaceId: string | null,
) {
  const params = new URLSearchParams(searchParams.toString());

  params.delete("returnTo");

  if (workspaceId) {
    params.set("workspaceId", workspaceId);
  } else {
    params.delete("workspaceId");
  }

  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

function persistWorkspacePreference(
  workspaceId: string | null,
  shouldRemember = true,
) {
  if (!workspaceId || typeof document === "undefined" || !shouldRemember) {
    return;
  }

  document.cookie = `${workspacePreferenceCookieName}=${encodeURIComponent(
    workspaceId,
  )}; path=/; max-age=${workspacePreferenceMaxAgeSeconds}; samesite=lax`;
}

function clearWorkspacePreference() {
  if (typeof document === "undefined") {
    return;
  }

  document.cookie = `${workspacePreferenceCookieName}=; path=/; max-age=0; samesite=lax`;
}

function isActiveNavItem(pathname: string, href: string) {
  if (href === "/") {
    return pathname === href;
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

function buildScopedShortcutHref(
  pathname: string,
  workspaceId: string | null,
  returnTo: string | null,
  extraParams?: Record<string, string>,
) {
  const params = new URLSearchParams();

  if (workspaceId) {
    params.set("workspaceId", workspaceId);
  }

  for (const [key, value] of Object.entries(extraParams ?? {})) {
    if (!value) {
      continue;
    }

    params.set(key, value);
  }

  const href = params.toString() ? `${pathname}?${params.toString()}` : pathname;
  return buildContextualHref(href, returnTo);
}

function describeTaskLane(pathname: string) {
  if (pathname === "/") {
    return {
      label: shellKey("taskLane.home.label"),
      description: shellKey("taskLane.home.description"),
    };
  }

  if (pathname === "/organizations" || pathname === "/workspaces" || pathname === "/providers" || pathname === "/setup") {
    return {
      label: shellKey("taskLane.configuration.label"),
      description: shellKey("taskLane.configuration.description"),
    };
  }

  if (pathname === "/projects" || pathname === "/members" || pathname === "/virtual-keys") {
    return {
      label: shellKey("taskLane.permissions.label"),
      description: shellKey("taskLane.permissions.description"),
    };
  }

  if (pathname === "/usage-events" || pathname === "/budgets" || pathname === "/alerts") {
    return {
      label: shellKey("taskLane.operations.label"),
      description: shellKey("taskLane.operations.description"),
    };
  }

  if (pathname === "/audit-logs" || pathname === "/exports") {
    return {
      label: shellKey("taskLane.reporting.label"),
      description: shellKey("taskLane.reporting.description"),
    };
  }

  return {
    label: shellKey("taskLane.workspace.label"),
    description: shellKey("taskLane.workspace.description"),
  };
}

function formatVisitTime(value: number, locale?: string) {
  return new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function normalizeSearchText(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function splitSearchTokens(value: string) {
  const normalized = normalizeSearchText(value);
  return normalized ? normalized.split(" ") : [];
}

function matchesSearchTokens(haystack: string, tokens: string[]) {
  if (!tokens.length) {
    return true;
  }

  const normalizedHaystack = normalizeSearchText(haystack);
  return tokens.every((token) => normalizedHaystack.includes(token));
}

function getCommandPaletteItemScore(item: CommandPaletteItem, normalizedQuery: string, queryTokens: string[]) {
  const searchable = `${item.section} ${item.label} ${item.description} ${item.keywords}`;
  if (!matchesSearchTokens(searchable, queryTokens)) {
    return -1;
  }

  const normalizedLabel = normalizeSearchText(item.label);
  const normalizedDescription = normalizeSearchText(item.description);
  const normalizedSection = normalizeSearchText(item.section);
  const normalizedKeywords = normalizeSearchText(item.keywords);
  let score = 0;

  if (normalizedLabel === normalizedQuery) {
    score += 200;
  } else if (normalizedLabel.startsWith(normalizedQuery)) {
    score += 140;
  } else if (normalizedLabel.includes(normalizedQuery)) {
    score += 90;
  }

  if (normalizedKeywords.includes(normalizedQuery)) {
    score += 56;
  }

  if (normalizedDescription.includes(normalizedQuery)) {
    score += 32;
  }

  if (normalizedSection.includes(normalizedQuery)) {
    score += 18;
  }

  if (item.section === "Now") {
    score += 14;
  } else if (item.section === "Shortcuts") {
    score += 10;
  } else if (item.section === "Tools") {
    score += 8;
  }

  if (item.action) {
    score += 6;
  }

  return score;
}

function getCommandPaletteSectionRank(section: string) {
  const ranks: Record<string, number> = {
    [shellKey("commandPalette.sections.now")]: 0,
    [shellKey("commandPalette.sections.tools")]: 1,
    [shellKey("commandPalette.sections.workspaces")]: 2,
    [shellKey("commandPalette.sections.saved")]: 3,
    [shellKey("commandPalette.sections.shortcuts")]: 4,
    [shellKey("commandPalette.sections.pinned")]: 5,
    [shellKey("commandPalette.sections.recent")]: 6,
    [shellKey("taskLane.home.label")]: 10,
    [shellKey("navigation.sections.configuration.label")]: 11,
    [shellKey("navigation.sections.permissions.label")]: 12,
    [shellKey("navigation.sections.operations.label")]: 13,
    [shellKey("navigation.sections.reporting.label")]: 14,
    [shellKey("taskLane.configuration.label")]: 15,
    [shellKey("taskLane.permissions.label")]: 16,
    [shellKey("taskLane.reporting.label")]: 17,
  };

  return ranks[section] ?? 100;
}

function getDefaultAppShellConfig(pathname: string): AppShellConfig {
  if (pathname === "/") {
    return createRouteShellConfig(shellKey("titles.controlCenter"));
  }

  if (pathname === "/workspaces") {
    return createRouteShellConfig(shellKey("titles.workspaces"));
  }

  if (pathname === "/providers") {
    return createRouteShellConfig(shellKey("titles.providers"));
  }

  if (pathname === "/virtual-keys") {
    return createRouteShellConfig(shellKey("titles.virtualKeys"));
  }

  if (pathname === "/members" || /^\/members\/[^/]+$/u.test(pathname)) {
    return createRouteShellConfig(shellKey("titles.members"));
  }

  if (pathname === "/exports") {
    return createRouteShellConfig(shellKey("titles.exports"));
  }

  if (pathname === "/budgets") {
    return createRouteShellConfig(shellKey("titles.budgets"));
  }

  if (pathname === "/projects") {
    return createRouteShellConfig(shellKey("titles.projects"));
  }

  if (pathname === "/organizations") {
    return createRouteShellConfig(shellKey("titles.organizations"));
  }

  if (pathname === "/audit-logs") {
    return createRouteShellConfig(shellKey("titles.auditLogs"));
  }

  if (pathname === "/usage-events") {
    return createRouteShellConfig(shellKey("titles.usageEvents"));
  }

  if (/^\/usage-events\/[^/]+$/u.test(pathname)) {
    return createRouteShellConfig(shellKey("titles.usageEventDetail"));
  }

  if (pathname === "/alerts") {
    return createRouteShellConfig(shellKey("titles.alerts"));
  }

  if (/^\/alerts\/[^/]+$/u.test(pathname)) {
    return createRouteShellConfig(shellKey("titles.alertDetail"));
  }

  if (pathname === "/prompt-inspections") {
    return createRouteShellConfig(shellKey("navigation.items.inspections.label"));
  }

  if (pathname === "/release-lineage") {
    return createRouteShellConfig(shellKey("navigation.items.lineage.label"));
  }

  if (pathname === "/access") {
    return createRouteShellConfig(shellKey("navigation.items.access.label"));
  }

  if (pathname === "/models") {
    return createRouteShellConfig(shellKey("navigation.items.models.label"));
  }

  return defaultShellConfig;
}

function shouldBypassAppShell(pathname: string) {
  const normalizedPathname = stripLocalePrefix(pathname);
  return normalizedPathname === "/login" || normalizedPathname.startsWith("/auth/");
}

function AppShellPageConfig({ config }: { config: AppShellConfigOverride }) {
  const setPageConfig = useContext(appShellConfigContext);

  useLayoutEffect(() => {
    if (!setPageConfig) {
      return;
    }

    setPageConfig(config);

    return () => {
      setPageConfig(null);
    };
  }, [config, setPageConfig]);

  return null;
}

export function PersistentAppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const searchParams = useSearchParams() ?? new URLSearchParams();
  const [pageConfig, setPageConfig] = useState<AppShellConfigOverride | null>(null);
  const searchParamsKey = searchParams.toString();
  const shouldBypassShell = shouldBypassAppShell(pathname);
  const routeConfig = useMemo(() => getDefaultAppShellConfig(pathname), [pathname]);
  const routeWorkspaceId = searchParams.get("workspaceId");

  useEffect(() => {
    setPageConfig(null);
  }, [pathname, searchParamsKey]);

  const mergedConfig = useMemo<AppShellConfig>(
    () => ({
      ...routeConfig,
      ...pageConfig,
      workspaceId: pageConfig?.workspaceId ?? routeWorkspaceId ?? routeConfig.workspaceId ?? null,
      workspaceLabel: pageConfig?.workspaceLabel ?? routeConfig.workspaceLabel ?? null,
      workspaceOptions: pageConfig?.workspaceOptions ?? routeConfig.workspaceOptions,
      workspaceSelectionSource:
        pageConfig?.workspaceSelectionSource ?? routeConfig.workspaceSelectionSource ?? "none",
    }),
    [pageConfig, routeConfig, routeWorkspaceId],
  );

  if (shouldBypassShell) {
    return <>{children}</>;
  }

  return (
    <appShellConfigContext.Provider value={setPageConfig}>
      <AppShellFrame {...mergedConfig}>{children}</AppShellFrame>
    </appShellConfigContext.Provider>
  );
}

export function AppShell(props: AppShellProps) {
  const setPageConfig = useContext(appShellConfigContext);
  const pageConfig = useMemo<AppShellConfigOverride>(
    () => ({
      title: props.title,
      subtitle: props.subtitle,
      ...(props.workspaceLabel !== undefined ? { workspaceLabel: props.workspaceLabel } : {}),
      ...(props.workspaceId !== undefined ? { workspaceId: props.workspaceId } : {}),
      ...(props.workspaceOptions !== undefined ? { workspaceOptions: props.workspaceOptions } : {}),
      ...(props.workspaceSelectionSource !== undefined
        ? { workspaceSelectionSource: props.workspaceSelectionSource }
        : {}),
      ...(props.showOperatorContextCards !== undefined
        ? { showOperatorContextCards: props.showOperatorContextCards }
        : {}),
      ...(props.headerMode !== undefined ? { headerMode: props.headerMode } : {}),
      ...(props.sidebarVariant !== undefined ? { sidebarVariant: props.sidebarVariant } : {}),
      ...(props.showSupportPanels !== undefined ? { showSupportPanels: props.showSupportPanels } : {}),
    }),
    [
      props.headerMode,
      props.showOperatorContextCards,
      props.showSupportPanels,
      props.sidebarVariant,
      props.subtitle,
      props.title,
      props.workspaceId,
      props.workspaceLabel,
      props.workspaceOptions,
      props.workspaceSelectionSource,
    ],
  );

  if (!setPageConfig) {
    return <AppShellFrame {...props} />;
  }

  return (
    <>
      <AppShellPageConfig config={pageConfig} />
      {props.children}
    </>
  );
}

function AppShellRouteTransitionSkeleton({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <section aria-busy="true" aria-live="polite" className="space-y-5">
      <div className="space-y-2">
        <div className="space-y-1">
          <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
            {description}
          </p>
          <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-foreground">
            {title}
          </h2>
        </div>
      </div>

      <div className="calm-toolbar-strip">
        <div className="calm-toolbar-strip__header">
          <div className="calm-toolbar-strip__title">
            <div className="calm-skeleton-block h-3 w-24 rounded-full" />
            <div className="calm-skeleton-block h-5 w-52 rounded-full" />
          </div>
          <div className="calm-skeleton-block h-8 w-24 rounded-full" />
        </div>
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px_auto]">
          <div className="calm-skeleton-block h-10 rounded-xl" />
          <div className="calm-skeleton-block h-10 rounded-xl" />
          <div className="calm-skeleton-block h-10 rounded-xl" />
        </div>
      </div>

      <div className="calm-stat-row">
        {Array.from({ length: 3 }).map((_, index) => (
          <div className="calm-stat min-w-[9rem]" key={index}>
            <span className="calm-skeleton-block h-3 w-16 rounded-full" />
            <span className="calm-skeleton-block h-3 w-10 rounded-full" />
          </div>
        ))}
      </div>

      <div className="calm-skeleton-list">
        {Array.from({ length: 5 }).map((_, index) => (
          <div className="calm-skeleton-list__row" key={index}>
            <div className="min-w-0 flex-1 space-y-2">
              <div className="calm-skeleton-block h-4 w-40 max-w-full rounded-full" />
              <div className="calm-skeleton-block h-3.5 w-64 max-w-full rounded-full" />
            </div>
            <div className="calm-skeleton-block hidden h-8 w-24 rounded-full sm:block" />
          </div>
        ))}
      </div>
    </section>
  );
}

function AppShellFrame({
  title,
  subtitle,
  children,
  workspaceLabel,
  workspaceId: providedWorkspaceId,
  workspaceOptions,
  showOperatorContextCards = defaultShellConfig.showOperatorContextCards,
  headerMode = defaultShellConfig.headerMode,
  sidebarVariant = defaultShellConfig.sidebarVariant,
  showSupportPanels = defaultShellConfig.showSupportPanels,
}: AppShellProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const shellSession = useShellSession();
  const workspaceIdentityState = shellSession.workspaceIdentityState;
  const capabilities = useCapabilities();
  const { locale, setLocale, isPending } = useLocalePreference();
  const tr = useT();
  const shellTr = useT("shell");
  const pathname = usePathname() ?? "/";
  const searchParams = useSearchParams() ?? new URLSearchParams();
  const { resolvedTheme, setTheme, theme } = useTheme();
  const [consolePreferences, setConsolePreferences] = useState<ConsolePreferences>(
    getDefaultConsolePreferences(),
  );
  const workspaceId = searchParams.get("workspaceId") ?? providedWorkspaceId ?? null;
  const authStatus = shellSession.session?.auth.status ?? "unauthenticated";
  const isShellSessionLoading = shellSession.isLoading;
  const activeMembershipId = shellSession.session?.auth.activeMembershipId ?? null;
  const activeRole = shellSession.session?.auth.activeRole ?? null;
  const shellIdentities = shellSession.session?.identities ?? [];
  const shellWorkspaceOptions = shellSession.session?.workspace.options;
  const currentRouteHref = useMemo(() => {
    const query = searchParams.toString();
    return query ? `${pathname}?${query}` : pathname;
  }, [pathname, searchParams]);
  const returnTo = searchParams.get("returnTo");
  const [navQuery, setNavQuery] = useState("");
  const [paletteQuery, setPaletteQuery] = useState("");
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const isScrolledRef = useRef(false);

  useEffect(() => {
    const expandThreshold = 10;
    const collapseThreshold = 44;

    const handleScroll = () => {
      const nextScrollY = window.scrollY;

      if (!isScrolledRef.current && nextScrollY >= collapseThreshold) {
        const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
        // Prevent layout thrashing (spring loop) when document height is close to viewport height.
        // If the page is too short, collapsing the header will reduce max scroll and force the browser
        // to immediately scroll up, causing an infinite expand/collapse loop.
        if (maxScroll < collapseThreshold + 80) {
          return;
        }

        isScrolledRef.current = true;
        setIsScrolled(true);
        return;
      }

      if (isScrolledRef.current && nextScrollY <= expandThreshold) {
        isScrolledRef.current = false;
        setIsScrolled(false);
      }
    };

    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [hasMounted, setHasMounted] = useState(false);
  const [expandedNavSection, setExpandedNavSection] = useState<string | null>(null);
  const [shareHref, setShareHref] = useState("");
  const [copyLaneStatus, setCopyLaneStatus] = useState<"idle" | "copied" | "error">("idle");
  const [liveMessage, setLiveMessage] = useState("");
  const [allowPaletteAutoFocus, setAllowPaletteAutoFocus] = useState(false);
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const [recentVisits, setRecentVisits] = useState<StoredRecentVisit[]>([]);
  const [recentWorkspaces, setRecentWorkspaces] = useState<StoredRecentWorkspace[]>([]);
  const [favoriteSurfaces, setFavoriteSurfaces] = useState<StoredFavoriteSurface[]>([]);
  const warmedRouteHrefsRef = useRef<Set<string>>(new Set());
  const inlineTitleMeasureRef = useRef<HTMLSpanElement | null>(null);
  const [inlineTitleSlotWidth, setInlineTitleSlotWidth] = useState(0);
  const deferredNavQuery = useDeferredValue(navQuery.trim().toLowerCase());
  const deferredPaletteQuery = useDeferredValue(paletteQuery.trim().toLowerCase());
  const shouldPreparePalette = isCommandPaletteOpen;
  const deferredNavTokens = useMemo(() => splitSearchTokens(deferredNavQuery), [deferredNavQuery]);
  const deferredPaletteTokens = useMemo(() => splitSearchTokens(deferredPaletteQuery), [deferredPaletteQuery]);
  const normalizedPaletteQuery = useMemo(() => normalizeSearchText(deferredPaletteQuery), [deferredPaletteQuery]);
  const navSections = useMemo(() => getNavSections(capabilities), [capabilities]);
  const returnContext = describeNavigationTarget(returnTo);
  const bootstrapWorkspaceOptions = useMemo<WorkspaceSelectorOption[] | undefined>(
    () =>
      shellWorkspaceOptions?.map((workspace) => ({
        id: workspace.id,
        label: `${workspace.organizationName} / ${workspace.name}`,
      })),
    [shellWorkspaceOptions],
  );
  const effectiveWorkspaceOptions = workspaceOptions ?? bootstrapWorkspaceOptions;
  const fallbackWorkspaceLabel = useMemo(() => {
    if (!workspaceId) {
      return null;
    }

    const matchedOption = shellWorkspaceOptions?.find(
      (workspace) => workspace.id === workspaceId,
    );

    return matchedOption
      ? `${matchedOption.organizationName} / ${matchedOption.name}`
      : null;
  }, [shellWorkspaceOptions, workspaceId]);
  const workspaceScopeLabel =
    workspaceLabel?.trim() ||
    fallbackWorkspaceLabel ||
    (workspaceId ? tr(`Workspace ${workspaceId.slice(0, 8)}`) : null);
  const taskLane = useMemo(() => describeTaskLane(pathname), [pathname]);
  const useCompactHeader = headerMode === "compact";
  const isMinimalSidebar = sidebarVariant === "minimal";
  const currentHref = useMemo(() => {
    const query = searchParams.toString();
    return query ? `${pathname}?${query}` : pathname;
  }, [pathname, searchParams]);
  const isRouteTransitionPending = Boolean(pendingHref && pendingHref !== currentHref);
  const pendingNavigationPathname = useMemo(
    () => (pendingHref ? extractPathnameFromHref(pendingHref) : null),
    [pendingHref],
  );
  const pendingNavigationWorkspaceId = useMemo(
    () => (pendingHref ? extractWorkspaceIdFromHref(pendingHref) : null),
    [pendingHref],
  );
  const pendingNavigationDescriptor = useMemo(
    () =>
      pendingHref
        ? findNavDescriptor(pendingHref, pendingNavigationWorkspaceId, navSections)
        : null,
    [navSections, pendingHref, pendingNavigationWorkspaceId],
  );
  const pendingShellConfig = useMemo(
    () =>
      pendingNavigationPathname
        ? getDefaultAppShellConfig(pendingNavigationPathname)
        : null,
    [pendingNavigationPathname],
  );
  const displayTitle = tr(
    isRouteTransitionPending
      ? pendingNavigationDescriptor?.item?.label ?? pendingShellConfig?.title ?? title
      : title,
  );
  const currentPageLabel = displayTitle;
  const currentSurfaceDescription = tr(
    isRouteTransitionPending ? pendingShellConfig?.subtitle ?? subtitle : subtitle,
  );
  const currentThemeValue = hasMounted ? theme ?? "system" : "system";
  const activeTheme = shellThemeOptions.find((option) => option.value === currentThemeValue) ?? shellThemeOptions[2];
  const resolvedThemeLabel =
    (hasMounted ? resolvedTheme : null) === "dark" ? shellKey("themes.dark") : shellKey("themes.light");
  const localizedResolvedThemeLabel = tr(resolvedThemeLabel);
  const ActiveThemeIcon = activeTheme.icon;
  const activeLocaleOption = localeOptions.find((option) => option.value === locale);
  const localizedReturnContext = useMemo(
    () =>
      returnContext
        ? {
            ...returnContext,
            label: tr(returnContext.label),
            ctaLabel: tr(returnContext.ctaLabel),
            description: tr(returnContext.description),
          }
        : null,
    [returnContext, tr],
  );
  const headerCardClassName = cn(
    "border-b border-[color:var(--border-default)] xl:sticky xl:top-0 xl:z-20 transition-all duration-300 ease-in-out",
    isScrolled
      ? "bg-[color:color-mix(in_srgb,var(--surface-canvas)_75%,transparent)] backdrop-blur-xl py-1.5 shadow-sm"
      : "bg-[color:color-mix(in_srgb,var(--surface-canvas)_92%,var(--surface-1)_8%)] backdrop-blur-md py-2",
  );
  const headerContentClassName = cn(
    "flex flex-col transition-all duration-300 ease-in-out",
    isScrolled ? "gap-0" : "gap-1.5",
    useCompactHeader && !isScrolled && "gap-1 py-1",
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const applyFromStorage = () => {
      setConsolePreferences(readConsolePreferences(window.localStorage));
    };

    applyFromStorage();

    const handleStorage = (event: StorageEvent) => {
      if (event.key && event.key !== consolePreferencesStorageKey) {
        return;
      }

      applyFromStorage();
    };

    const handlePreferencesChanged = (event: Event) => {
      const detail =
        event instanceof CustomEvent ? (event.detail as ConsolePreferences | undefined) : undefined;

      setConsolePreferences(
        detail ? detail : readConsolePreferences(window.localStorage),
      );
    };

    window.addEventListener("storage", handleStorage);
    window.addEventListener(
      consolePreferencesChangedEventName,
      handlePreferencesChanged,
    );

    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(
        consolePreferencesChangedEventName,
        handlePreferencesChanged,
      );
    };
  }, []);

  useEffect(() => {
    if (!hasMounted || theme === consolePreferences.themeMode) {
      return;
    }

    setTheme(consolePreferences.themeMode);
  }, [consolePreferences.themeMode, hasMounted, setTheme, theme]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const root = document.documentElement;
    const previousFontSize = root.style.fontSize;
    root.style.fontSize = `${getConsoleFontSizePx(consolePreferences.fontSize)}px`;

    return () => {
      root.style.fontSize = previousFontSize;
    };
  }, [consolePreferences.fontSize]);

  useEffect(() => {
    if (consolePreferences.rememberLastWorkspace) {
      return;
    }

    clearWorkspacePreference();
  }, [consolePreferences.rememberLastWorkspace]);

  useEffect(() => {
    setHasMounted(true);
  }, []);

  useEffect(() => {
    if (!hasMounted || typeof window === "undefined") {
      return;
    }

    const normalizedPathname = stripLocalePrefix(pathname);
    if (normalizedPathname !== "/") {
      return;
    }

    if (searchParams.get("returnTo")) {
      return;
    }

    const nextHref = getConsoleLandingHref(
      consolePreferences.defaultLandingPage,
      consolePreferences.rememberLastWorkspace ? workspaceId : null,
    );

    if (nextHref === "/" || nextHref === currentHref) {
      return;
    }

    const hasOnlyWorkspaceScope = (() => {
      const keys = Array.from(searchParams.keys());
      return keys.length === 0 || (keys.length === 1 && keys[0] === "workspaceId");
    })();

    if (!hasOnlyWorkspaceScope) {
      return;
    }

    router.replace(nextHref, { scroll: false });
  }, [
    consolePreferences.defaultLandingPage,
    consolePreferences.rememberLastWorkspace,
    currentHref,
    hasMounted,
    pathname,
    router,
    searchParams,
    workspaceId,
  ]);

  useEffect(() => {
    if (!hasMounted || typeof window === "undefined") {
      return;
    }

    const normalizedPathname = stripLocalePrefix(pathname);
    if (!isRememberedFilterEligiblePath(normalizedPathname)) {
      return;
    }

    if (!consolePreferences.rememberLastFilters) {
      const currentRecord = readRememberedFilterRecord(window.localStorage);
      if (currentRecord[normalizedPathname]) {
        delete currentRecord[normalizedPathname];
        writeRememberedFilterRecord(window.localStorage, currentRecord);
      }
      return;
    }

    const filterQuery = stripRememberedFilterParams(
      new URLSearchParams(searchParams.toString()),
    ).toString();

    if (filterQuery) {
      const currentRecord = readRememberedFilterRecord(window.localStorage);
      currentRecord[normalizedPathname] = filterQuery;
      writeRememberedFilterRecord(window.localStorage, currentRecord);
      return;
    }

    const rememberedFilterRecord = readRememberedFilterRecord(window.localStorage);
    const rememberedQuery = rememberedFilterRecord[normalizedPathname];

    if (!rememberedQuery) {
      return;
    }

    const sanitizedRememberedQuery = stripRememberedFilterParams(
      new URLSearchParams(rememberedQuery),
    ).toString();

    if (sanitizedRememberedQuery !== rememberedQuery) {
      if (sanitizedRememberedQuery) {
        rememberedFilterRecord[normalizedPathname] = sanitizedRememberedQuery;
      } else {
        delete rememberedFilterRecord[normalizedPathname];
      }
      writeRememberedFilterRecord(window.localStorage, rememberedFilterRecord);
    }

    if (!sanitizedRememberedQuery) {
      return;
    }

    const restoredSearchParams = new URLSearchParams(searchParams.toString());
    for (const [key, value] of new URLSearchParams(sanitizedRememberedQuery).entries()) {
      restoredSearchParams.set(key, value);
    }

    const restoredQuery = restoredSearchParams.toString();
    const nextHref = restoredQuery ? `${pathname}?${restoredQuery}` : pathname;

    if (nextHref !== currentHref) {
      router.replace(nextHref, { scroll: false });
    }
  }, [
    consolePreferences.rememberLastFilters,
    currentHref,
    hasMounted,
    pathname,
    router,
    searchParams,
  ]);

  useLayoutEffect(() => {
    const measure = () => {
      const nextWidth = inlineTitleMeasureRef.current?.getBoundingClientRect().width ?? 0;
      setInlineTitleSlotWidth(nextWidth ? Math.min(nextWidth + 8, 220) : 0);
    };

    measure();

    if (typeof window === "undefined") {
      return;
    }

    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [displayTitle, useCompactHeader]);
  const headerRowClassName = cn(
    "flex flex-row items-center justify-between gap-3 transition-all duration-300 ease-in-out",
    isScrolled ? "h-9" : "h-auto",
  );
  const workspaceTriggerClassName = cn(
    "h-auto max-w-full justify-start gap-2 border border-transparent bg-transparent font-normal text-muted-foreground/92 shadow-none hover:border-[color:var(--border-default)] hover:bg-[color:color-mix(in_srgb,var(--surface-1)_92%,var(--surface-2)_8%)] hover:text-foreground focus-visible:border-[color:var(--primary-border)] focus-visible:bg-[color:color-mix(in_srgb,var(--surface-1)_86%,var(--primary-soft)_14%)] min-h-7 rounded-md px-1.5 py-1 text-[11.5px]",
  );
  const workspaceIndicatorClassName = cn(
    "size-1 rounded-full",
    workspaceId ? "bg-foreground/20" : "ring-1 ring-inset ring-border/70 bg-transparent",
  );
  const headerIconButtonClassName = cn(
    "border border-transparent text-muted-foreground transition duration-150 hover:border-[color:var(--border-default)] hover:bg-[color:color-mix(in_srgb,var(--surface-1)_92%,var(--surface-2)_8%)] hover:text-foreground",
    "size-[30px] rounded-md",
    useCompactHeader && "rounded-md",
  );
  const shellRootStyle = useMemo<CSSProperties & Record<string, string>>(
    () => ({
      ...getConsoleAccentStyleVariables(consolePreferences.accentPreset),
      "--shell-sidebar-width": getConsoleSidebarWidth(
        consolePreferences.sidebarWidth,
      ),
    }),
    [consolePreferences.accentPreset, consolePreferences.sidebarWidth],
  );
  const shellStageClassName = cn(
    "mx-auto flex min-h-screen w-full max-w-[1800px] flex-col overflow-x-clip xl:flex-row",
    consolePreferences.density === "compact" && "gap-0",
    consolePreferences.density === "comfortable" && "gap-1",
  );
  const mainStageClassName = cn(
    "shell-content-stage min-w-0 flex-1 overflow-x-clip",
    consolePreferences.density === "compact"
      ? "px-4 py-3 sm:px-5 xl:px-8 xl:py-5"
      : consolePreferences.density === "comfortable"
        ? "px-5 py-4 sm:px-7 xl:px-12 xl:py-8"
        : "px-4 py-3 sm:px-6 xl:px-10 xl:py-7",
  );
  const contentStackClassName = cn(
    "mx-auto flex w-full max-w-[1320px] flex-col",
    consolePreferences.density === "compact"
      ? "gap-3"
      : consolePreferences.density === "comfortable"
        ? "gap-5"
        : "gap-4",
  );
  const effectiveShowSupportPanels =
    showSupportPanels && consolePreferences.showSupportPanelsByDefault;

  const updateThemePreference = useCallback(
    (value: string) => {
      const nextTheme = value as ConsoleThemePreference;
      setTheme(nextTheme);

      if (typeof window === "undefined") {
        return;
      }

      const nextPreferences = {
        ...consolePreferences,
        themeMode: nextTheme,
      };
      setConsolePreferences(nextPreferences);
      persistConsolePreferences(window.localStorage, nextPreferences);
    },
    [consolePreferences, setTheme],
  );
  const workspaceContextOptions = useMemo<WorkspaceSelectorOption[]>(
    () =>
      effectiveWorkspaceOptions?.length
        ? effectiveWorkspaceOptions
        : recentWorkspaces.map((workspace) => ({
            id: workspace.id,
            label: workspace.workspaceName ?? tr("Workspace"),
          })),
    [effectiveWorkspaceOptions, recentWorkspaces, tr],
  );

  const workspaceDirectoryMenuItems = useMemo<WorkspaceMenuItem[]>(() => {
    if (!effectiveWorkspaceOptions?.length) {
      return [];
    }

    return effectiveWorkspaceOptions.map((workspace) => ({
      id: workspace.id,
      label: workspace.label,
      meta: workspace.label,
    }));
  }, [effectiveWorkspaceOptions]);

  const workspaceDirectoryIds = useMemo(() => {
    return new Set(workspaceDirectoryMenuItems.map((item) => item.id));
  }, [workspaceDirectoryMenuItems]);

  const workspaceRecentMenuItems = useMemo<WorkspaceMenuItem[]>(() => {
    if (!recentWorkspaces.length) {
      return [];
    }

    return recentWorkspaces
      .filter((workspace) => !workspaceDirectoryIds.has(workspace.id))
      .flatMap((workspace) => {
        const workspaceName = getStoredRecentWorkspaceName(workspace.workspaceName);
        if (!workspaceName) {
          return [];
        }

        return [
          {
            id: workspace.id,
            label: workspaceName,
            meta: tr("Recent"),
          },
        ];
      });
  }, [recentWorkspaces, tr, workspaceDirectoryIds]);

  const hasWorkspaceDirectory = workspaceDirectoryMenuItems.length > 0;

  const directoryItemsToRender = hasWorkspaceDirectory
    ? workspaceDirectoryMenuItems
    : workspaceContextOptions.map((option) => ({
        id: option.id,
        label: option.label,
        meta: option.id === workspaceId ? tr("Current workspace") : undefined,
      }));

  const getWorkspaceInitial = (label?: string | null) => {
    if (!label) {
      return "W";
    }

    const trimmed = label.trim();
    if (!trimmed) {
      return "W";
    }

    const segments = trimmed.split("/");
    const candidate = segments[segments.length - 1].trim();
    if (candidate) {
      return candidate[0].toUpperCase();
    }

    return trimmed[0].toUpperCase();
  };

  const getWorkspaceIdentitySelection = useCallback(
    (targetWorkspaceId: string | null) => {
      if (authStatus !== "authenticated") {
        return null;
      }

      return resolveWorkspaceIdentitySelection({
        identities: shellIdentities,
        targetWorkspaceId,
        activeMembershipId,
        activeRole,
      });
    },
    [activeMembershipId, activeRole, authStatus, shellIdentities],
  );

  const shouldSkipWorkspacePrefetch = useCallback(
    (href: string) => {
      const targetWorkspaceId = extractWorkspaceIdFromHref(href);
      return Boolean(getWorkspaceIdentitySelection(targetWorkspaceId)?.needsSwitch);
    },
    [getWorkspaceIdentitySelection],
  );

  const handleWorkspaceNavigation = useCallback(
    async (args: {
      event: ReactMouseEvent<HTMLAnchorElement>;
      href: string;
      targetWorkspaceId: string;
      workspaceLabel: string;
    }) => {
      if (args.targetWorkspaceId === workspaceId) {
        return;
      }

      const selection = getWorkspaceIdentitySelection(args.targetWorkspaceId);
      if (!selection?.needsSwitch) {
        announceAction(shellTr("switchingWorkspace", { workspace: args.workspaceLabel }));
        setPendingHref(args.href);
        return;
      }

      args.event.preventDefault();
      announceAction(shellTr("switchingWorkspace", { workspace: args.workspaceLabel }));
      setPendingHref(args.href);

      try {
        await postConsoleVoid("/api/auth/session/active-identity", {
          membershipId: selection.selectedMembershipId,
          role: selection.selectedRole,
        });
        persistWorkspacePreference(
          args.targetWorkspaceId,
          consolePreferences.rememberLastWorkspace,
        );
        await queryClient.invalidateQueries({
          predicate: (query) =>
            Array.isArray(query.queryKey) && query.queryKey[0] === "console",
        });
        router.push(args.href);
      } catch (error) {
        setPendingHref(null);

        if (error instanceof ConsoleAuthRedirectError) {
          return;
        }

        if (
          error instanceof ConsoleHttpError &&
          (error.status === 400 || error.status === 403)
        ) {
          router.push({
            pathname: "/auth/select-identity",
            query: {
              returnTo: args.href,
            },
          });
          return;
        }

        announceAction(shellTr("workspaceSwitchFailed"));
      }
    },
    [
      consolePreferences.rememberLastWorkspace,
      getWorkspaceIdentitySelection,
      queryClient,
      router,
      shellTr,
      workspaceId,
    ],
  );

  const renderWorkspaceMenuItem = (option: WorkspaceMenuItem) => {
    const optionHref = buildWorkspaceScopedHref(pathname, searchParams, option.id);
    const isCurrent = workspaceId ? option.id === workspaceId : false;
    const indicatorLabel = isCurrent ? tr("Current workspace") : option.meta;
    const identitySelection = getWorkspaceIdentitySelection(option.id);
    const requiresIdentitySwitch = Boolean(identitySelection?.needsSwitch);

    return (
      <DropdownMenuItem asChild key={option.id}>
        <Link
          aria-current={isCurrent ? "page" : undefined}
          className={cn(
            "flex w-full items-center gap-3 rounded-md border px-3 py-2 text-[13px] transition-colors focus-visible:rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
            isCurrent
              ? "border-[color:var(--primary-border)] bg-[color:color-mix(in_srgb,var(--surface-1)_78%,var(--surface-selected)_22%)] text-foreground"
              : "border-transparent text-muted-foreground hover:border-[color:var(--border-default)] hover:bg-[color:color-mix(in_srgb,var(--surface-1)_90%,var(--surface-2)_10%)] hover:text-foreground",
          )}
          href={optionHref}
          prefetch={requiresIdentitySwitch ? false : undefined}
          onClick={(event) =>
            void handleWorkspaceNavigation({
              event,
              href: optionHref,
              targetWorkspaceId: option.id,
              workspaceLabel: option.label,
            })
          }
          onPointerDown={() => void warmRoute(optionHref)}
          onFocus={() => void warmRoute(optionHref)}
          onMouseEnter={() => void warmRoute(optionHref)}
        >
          <span
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-full border text-[11px] font-semibold uppercase tracking-[0.08em]",
              isCurrent
                ? "border-[color:var(--primary-border)] bg-[color:color-mix(in_srgb,var(--surface-selected)_54%,var(--surface-1)_46%)] text-[color:var(--primary-strong)]"
                : "border-border/55 bg-[color:color-mix(in_srgb,var(--foreground)_4%,var(--surface-1)_96%)] text-foreground/90",
            )}
          >
            {getWorkspaceInitial(option.label)}
          </span>
          <div className="min-w-0 flex-1">
            <p className={cn("truncate font-medium", isCurrent ? "text-foreground" : "text-foreground/90")} title={option.label}>
              {option.label}
            </p>
            {indicatorLabel ? (
              <p className={cn("truncate text-[11px]", isCurrent ? "text-[color:var(--primary-strong)]/90" : "text-muted-foreground")}>
                {indicatorLabel}
              </p>
            ) : null}
          </div>
          {isCurrent ? <Check className="size-4 text-[var(--primary-strong)]" /> : null}
        </Link>
      </DropdownMenuItem>
    );
  };
  const isCurrentSurfaceFavorited = useMemo(
    () => favoriteSurfaces.some((item) => item.href === currentHref),
    [currentHref, favoriteSurfaces],
  );
  const filteredNavSections = useMemo(
    () =>
      navSections
        .map((section) => {
          const sectionLabel = tr(section.label);
          const sectionDescription = tr(section.description);
          const translatedItems = section.items
            .map((item) => ({
              ...item,
              label: tr(item.label),
              description: tr(item.description),
            }))
            .filter((item, index) => {
              if (!deferredNavQuery) {
                return true;
              }

              const rawItem = section.items[index];
              const haystack = [
                section.label,
                sectionLabel,
                section.description,
                sectionDescription,
                rawItem.label,
                item.label,
                rawItem.description,
                item.description,
                rawItem.href,
                ...(rawItem.keywords ?? []),
              ]
                .join(" ")
                .toLowerCase();

              return matchesSearchTokens(haystack, deferredNavTokens);
            });

          return {
            ...section,
            label: sectionLabel,
            description: sectionDescription,
            items: translatedItems,
          };
        })
        .filter((section) => section.items.length > 0),
    [deferredNavQuery, deferredNavTokens, navSections, tr],
  );
  const filteredHomeNavItem = useMemo(() => {
    const effectiveHomeItem = homeNavItem;
    const translatedHomeItem = {
      ...effectiveHomeItem,
      label: tr(homeNavItem.label),
      description: tr(homeNavItem.description),
    };

    if (!deferredNavQuery) {
      return translatedHomeItem;
    }

    const haystack = [
      effectiveHomeItem.label,
      translatedHomeItem.label,
      effectiveHomeItem.description,
      translatedHomeItem.description,
      effectiveHomeItem.href,
      ...(effectiveHomeItem.keywords ?? []),
    ]
      .join(" ")
      .toLowerCase();

    return matchesSearchTokens(haystack, deferredNavTokens) ? translatedHomeItem : null;
  }, [deferredNavQuery, deferredNavTokens, tr]);
  const shouldRenderNavigationSkeleton = isShellSessionLoading;
  const activeNavSectionLabel = useMemo(() => {
    if (deferredNavQuery) {
      return null;
    }

    return filteredNavSections.find((section) => section.items.some((item) => isActiveNavItem(pathname, item.href)))?.label ?? null;
  }, [deferredNavQuery, filteredNavSections, pathname]);

  useEffect(() => {
    if (deferredNavQuery) {
      return;
    }

    setExpandedNavSection(activeNavSectionLabel);
  }, [activeNavSectionLabel, deferredNavQuery]);

  const getIsSectionExpanded = (sectionLabel: string, hasActiveItem: boolean) => {
    if (isMinimalSidebar) {
      return true;
    }

    if (deferredNavQuery) {
      return true;
    }

    if (expandedNavSection) {
      return expandedNavSection === sectionLabel;
    }

    return hasActiveItem;
  };

  const toggleNavSection = (sectionLabel: string) => {
    if (isMinimalSidebar) {
      return;
    }

    setExpandedNavSection((currentSection) => {
      const nextSection = currentSection === sectionLabel ? null : sectionLabel;

      if (nextSection) {
        const section = filteredNavSections.find((candidate) => candidate.label === nextSection);
        if (section) {
          for (const item of section.items) {
            void warmRoute(buildNavHref(item.href, workspaceId));
          }
        }
      }

      return nextSection;
    });
  };
  const taskZoneItems = useMemo<ShellShortcut[]>(() => {
    if (!workspaceId) {
      return [
        {
          href: buildContextualHref("/workspaces", currentHref),
          label: "Workspaces",
          description: "Select a workspace before you go deeper.",
        },
        {
          href: buildContextualHref("/", currentHref),
          label: "Home",
                  description: "Homepage view for priority, alerts, and setup.",
        },
        {
          href: buildContextualHref("/organizations", currentHref),
          label: "Orgs",
          description: "Confirm ownership and billing before more setup.",
        },
      ];
    }

    if (pathname === "/providers") {
      return [
        {
          href: buildScopedShortcutHref("/providers", workspaceId, currentHref),
          label: "Providers",
          description: "Keep provider setup and tests in view.",
        },
        {
          href: buildScopedShortcutHref("/usage-events", workspaceId, currentHref),
          label: "Usage",
          description: "Check live traffic before changing provider defaults.",
        },
        {
          href: buildScopedShortcutHref("/virtual-keys", workspaceId, currentHref),
          label: "Keys",
          description: "Review keys that still depend on these providers.",
        },
        {
          href: buildScopedShortcutHref("/audit-logs", workspaceId, currentHref, {
            subjectType: "provider-connection",
          }),
          label: "Audit",
          description: "See who changed credentials, defaults, or revocations.",
        },
      ];
    }

    if (pathname === "/virtual-keys") {
      return [
        {
          href: buildScopedShortcutHref("/virtual-keys", workspaceId, currentHref, {
            riskFilter: "expiring_soon",
          }),
          label: "Expiring keys",
          description: "Review keys that need rotation soon.",
        },
        {
          href: buildScopedShortcutHref("/virtual-keys", workspaceId, currentHref, {
            riskFilter: "dormant_wide_access",
            bindingFilter: "workspace",
          }),
          label: "Wide keys",
          description: "Review stale keys with wide access.",
        },
        {
          href: buildScopedShortcutHref("/providers", workspaceId, currentHref),
          label: "Providers",
          description: "Check provider health before rotating keys.",
        },
        {
          href: buildScopedShortcutHref("/audit-logs", workspaceId, currentHref, {
            subjectType: "virtual-key",
          }),
          label: "Audit",
          description: "Key creation, rotation, and revocation history.",
        },
      ];
    }

    if (pathname === "/alerts") {
      return [
        {
          href: buildScopedShortcutHref("/alerts", workspaceId, currentHref, {
            status: "open",
            queueLane: "needs-ack",
          }),
          label: "Needs ack",
          description: "See alerts waiting for first response.",
        },
        {
          href: buildScopedShortcutHref("/alerts", workspaceId, currentHref, {
            status: "open",
            queueLane: "escalation-risk",
          }),
          label: "At risk",
          description: "Review alerts that need a decision soon.",
        },
        {
          href: buildScopedShortcutHref("/usage-events", workspaceId, currentHref, {
            outcome: "attention",
          }),
          label: "Usage",
          description: "Check blocked or expensive traffic in this workspace.",
        },
        {
          href: buildScopedShortcutHref("/exports", workspaceId, currentHref, {
            kind: "audit-logs",
          }),
          label: "Exports",
          description: "Export current alert state.",
        },
      ];
    }

    if (pathname === "/members") {
      return [
        {
          href: buildScopedShortcutHref("/members", workspaceId, currentHref, {
            section: "invites",
            status: "invited",
            focus: "stale_invites",
          }),
          label: "Stale invites",
          description: "Review invites that still need action.",
        },
        {
          href: buildScopedShortcutHref("/members", workspaceId, currentHref, {
            section: "offboarding",
            focus: "dormant_broad_access",
          }),
          label: "Offboarding",
          description: "Review risky memberships before cleanup grows.",
        },
        {
          href: buildScopedShortcutHref("/audit-logs", workspaceId, currentHref, {
            subjectType: "member",
          }),
          label: "Audit",
          description: "See recent role, scope, and disable changes.",
        },
        {
          href: buildScopedShortcutHref("/projects", workspaceId, currentHref),
          label: "Projects",
          description: "Review projects before changes.",
        },
      ];
    }

      return [
        {
          href: buildScopedShortcutHref("/", workspaceId, currentHref),
          label: "Home",
          description: "Open Home for this workspace.",
        },
        {
          href: buildScopedShortcutHref("/alerts", workspaceId, currentHref, {
            status: "open",
          }),
          label: "Alerts",
          description: "Open alerts in this workspace.",
        },
        {
          href: buildScopedShortcutHref("/providers", workspaceId, currentHref),
          label: "Providers",
          description: "Provider status and failed tests.",
        },
        {
          href: buildScopedShortcutHref("/virtual-keys", workspaceId, currentHref),
          label: "Keys",
          description: "Review expiring or stale keys.",
        },
    ];
  }, [currentHref, pathname, workspaceId]);
  const pinnedTasks = useMemo<ShellShortcut[]>(() => {
    if (!workspaceId) {
      return [
        {
          href: buildContextualHref("/workspaces", currentHref),
          label: "Workspaces",
          description: "Select a workspace first.",
        },
        {
          href: buildContextualHref("/organizations", currentHref),
          label: "Orgs",
          description: "Review the owning organization.",
        },
        {
          href: buildContextualHref("/", currentHref),
          label: "Home",
          description: "Open Home for priority and setup.",
        },
      ] as ShellShortcut[];
    }

    if (pathname === "/providers") {
      return [
        {
          href: buildScopedShortcutHref("/usage-events", workspaceId, currentHref),
          label: "Usage",
          description: "Review traffic before changing provider defaults.",
        },
        {
          href: buildScopedShortcutHref("/virtual-keys", workspaceId, currentHref),
          label: "Keys",
          description: "Review keys tied to current providers.",
        },
        {
          href: buildScopedShortcutHref("/audit-logs", workspaceId, currentHref, {
            subjectType: "provider-connection",
          }),
          label: "Audit",
          description: "Provider credentials, defaults, and revocations.",
        },
      ] as ShellShortcut[];
    }

    if (pathname === "/virtual-keys") {
      return [
        {
          href: buildScopedShortcutHref("/virtual-keys", workspaceId, currentHref, {
            riskFilter: "expiring_soon",
          }),
          label: "Expiring keys",
          description: "Keys that need rotation soon.",
        },
        {
          href: buildScopedShortcutHref("/providers", workspaceId, currentHref),
          label: "Providers",
          description: "Review provider health before key changes.",
        },
        {
          href: buildScopedShortcutHref("/audit-logs", workspaceId, currentHref, {
            subjectType: "virtual-key",
          }),
          label: "Audit",
          description: "Key creation, rotation, and revocation history.",
        },
      ] as ShellShortcut[];
    }

    if (pathname === "/alerts") {
      return [
        {
          href: buildScopedShortcutHref("/alerts", workspaceId, currentHref, {
            status: "open",
            queueLane: "needs-ack",
          }),
          label: "Needs ack",
          description: "Alerts waiting for first response.",
        },
        {
          href: buildScopedShortcutHref("/usage-events", workspaceId, currentHref, {
            outcome: "attention",
          }),
          label: "Usage",
          description: "Blocked or expensive traffic.",
        },
        {
          href: buildScopedShortcutHref("/exports", workspaceId, currentHref, {
            kind: "audit-logs",
          }),
          label: "Exports",
          description: "Export current alert state.",
        },
      ] as ShellShortcut[];
    }

    if (pathname === "/members") {
      return [
        {
          href: buildScopedShortcutHref("/members", workspaceId, currentHref, {
            section: "invites",
            status: "invited",
            focus: "stale_invites",
          }),
          label: "Stale invites",
          description: "Invites that still need action.",
        },
        {
          href: buildScopedShortcutHref("/members", workspaceId, currentHref, {
            section: "offboarding",
            focus: "dormant_broad_access",
          }),
          label: "Offboarding",
          description: "Review risky memberships.",
        },
        {
          href: buildScopedShortcutHref("/audit-logs", workspaceId, currentHref, {
            subjectType: "member",
          }),
          label: "Audit",
          description: "Role, scope, and disable changes.",
        },
      ] as ShellShortcut[];
    }

    return [
      {
        href: buildScopedShortcutHref("/alerts", workspaceId, currentHref, { status: "open" }),
        label: "Alerts",
        description: "Open alerts and blocks.",
      },
      {
        href: buildScopedShortcutHref("/providers", workspaceId, currentHref),
        label: "Providers",
        description: "Review active providers and failed tests.",
      },
      {
        href: buildScopedShortcutHref("/virtual-keys", workspaceId, currentHref),
        label: "Keys",
        description: "Review expiring keys and stale access.",
      },
      {
        href: buildScopedShortcutHref("/exports", workspaceId, currentHref),
        label: "Exports",
        description: "Export activity.",
      },
    ] as ShellShortcut[];
  }, [currentHref, workspaceId]);
  const workflowShortcuts = useMemo<ShellShortcut[]>(() => {
    if (!workspaceId) {
      return [
        {
          href: buildContextualHref("/", currentHref),
          label: "Home",
          description: "Open Home first.",
        },
        {
          href: buildContextualHref("/workspaces", currentHref),
          label: "Workspaces",
          description: "Select a workspace first.",
        },
        {
          href: buildContextualHref("/organizations", currentHref),
          label: "Orgs",
          description: "Confirm ownership.",
        },
      ];
    }

    if (pathname === "/usage-events" || pathname === "/audit-logs" || pathname === "/exports") {
      return [
        {
          href: buildScopedShortcutHref("/usage-events", workspaceId, currentHref),
          label: "Usage",
          description: "Open usage events.",
        },
        {
          href: buildScopedShortcutHref("/audit-logs", workspaceId, currentHref),
          label: "Audit",
          description: "Related audit history.",
        },
        {
          href: `${buildScopedShortcutHref("/exports", workspaceId, currentHref)}#scheduled-reports`,
          label: "Recurring reports",
          description: "One-off and scheduled exports.",
        },
      ];
    }

    if (pathname === "/alerts" || pathname === "/budgets") {
      return [
        {
          href: buildScopedShortcutHref("/alerts", workspaceId, currentHref, { status: "open" }),
          label: "Alerts",
          description: "Review alert status.",
        },
        {
          href: buildScopedShortcutHref("/usage-events", workspaceId, currentHref),
          label: "Usage",
          description: "Review blocked or expensive traffic.",
        },
        {
          href: `${buildScopedShortcutHref("/exports", workspaceId, currentHref)}#operational-follow-up`,
          label: "Exports",
          description: "Export current decisions.",
        },
      ];
    }

    return [
      {
        href: buildScopedShortcutHref("/providers", workspaceId, currentHref),
        label: "Open providers",
        description: "Review provider status and tests.",
      },
        {
          href: buildScopedShortcutHref("/members", workspaceId, currentHref),
          label: "Open members",
          description: "Review membership and scope.",
      },
      {
        href: buildScopedShortcutHref("/virtual-keys", workspaceId, currentHref),
        label: "Open keys",
        description: "Review risky keys.",
      },
    ];
  }, [currentHref, pathname, workspaceId]);
  const topbarActions = useMemo<ShellAction[]>(() => {
    if (!workspaceId) {
      return [
        {
          href: buildContextualHref("/workspaces", currentHref),
          label: "Workspaces",
        },
        {
          href: buildContextualHref("/organizations", currentHref),
          label: "Orgs",
        },
      ];
    }

    return [
      {
        href: buildScopedShortcutHref("/alerts", workspaceId, currentHref, { status: "open" }),
        label: "Alerts",
      },
      {
        href: buildScopedShortcutHref("/providers", workspaceId, currentHref),
        label: "Providers",
      },
      {
        href: buildScopedShortcutHref("/exports", workspaceId, currentHref),
        label: "Exports",
      },
    ];
  }, [currentHref, pathname, workspaceId]);
  const workspaceJumpItems = useMemo<WorkspaceJumpItem[]>(
    () =>
      recentWorkspaces.flatMap((workspace) => {
        const workspaceName = getStoredRecentWorkspaceName(workspace.workspaceName);
        if (!workspaceName) {
          return [];
        }

        return [
          {
            id: workspace.id,
            label: workspaceName,
            href: buildWorkspaceScopedHref(pathname, searchParams, workspace.id),
            visitedAt: workspace.visitedAt,
          },
        ];
      }),
    [pathname, recentWorkspaces, searchParams],
  );
  const surfaceMemoryItems = useMemo<SurfaceMemoryItem[]>(() => {
    const buildDescriptor = (input: SurfaceDescriptorInput) =>
      resolveSurfaceDescriptor(input, { tr: shellTr, locale });

    const favoriteItems = favoriteSurfaces.map((surface) => {
      const descriptor = buildDescriptor({
        href: surface.href,
        workspaceId: surface.workspaceId ?? null,
        workspaceName: surface.workspaceName ?? null,
        savedAt: surface.savedAt,
        source: "favorite",
        descriptorKey: surface.descriptorKey,
        descriptorProps: surface.descriptorProps,
      });

      return {
        id: `favorite:${surface.href}`,
        href: surface.href,
        label: descriptor.label,
        description: descriptor.description,
        meta: descriptor.meta,
        source: "favorite" as const,
      };
    });

    const recentItems = recentVisits.map((visit) => {
      const descriptor = buildDescriptor({
        href: visit.href,
        workspaceId: visit.workspaceId ?? null,
        visitedAt: visit.visitedAt,
        source: "recent",
        descriptorKey: visit.descriptorKey,
        descriptorProps: visit.descriptorProps,
      });

      return {
        id: `recent:${visit.href}`,
        href: visit.href,
        label: descriptor.label,
        description: descriptor.description,
        meta: descriptor.meta,
        source: "recent" as const,
      };
    });

    const deduped = new Map<string, SurfaceMemoryItem>();

    for (const item of [...favoriteItems, ...recentItems]) {
      if (item.href === currentHref) {
        continue;
      }

      if (!deduped.has(item.href)) {
        deduped.set(item.href, item);
      }
    }

    return Array.from(deduped.values()).slice(0, 4);
  }, [currentHref, favoriteSurfaces, locale, recentVisits, shellTr]);
  const operatorContextCards = useMemo<OperatorContextCard[]>(() => {
    if (!workspaceId) {
      return [
        {
          eyebrow: "Start",
          title: "Workspaces",
          description: "Select a workspace first.",
          href: buildContextualHref("/workspaces", currentHref),
          tone: "warning" as const,
          meta: "Required",
          actionLabel: "Open",
        },
        {
          eyebrow: "Next",
          title: "Home",
                  description: "Homepage view for priority, alerts, and setup.",
          href: buildContextualHref("/", currentHref),
          tone: "neutral" as const,
          meta: "Home",
          actionLabel: "Open",
        },
        {
          eyebrow: "Scope",
          title: "Orgs",
          description: "Confirm ownership and billing.",
          href: buildContextualHref("/organizations", currentHref),
          tone: "neutral" as const,
          meta: "Setup",
          actionLabel: "Open",
        },
      ] as OperatorContextCard[];
    }

    const handoffCard = (() => {
      if (pathname === "/providers") {
        return {
          eyebrow: "Follow-up",
          title: "Exports",
          description: "Export provider changes.",
          href: buildScopedShortcutHref("/exports", workspaceId, currentHref, { kind: "audit-logs" }),
          tone: "neutral" as const,
          meta: "Recommended",
          actionLabel: "Open",
        };
      }

      if (pathname === "/virtual-keys") {
        return {
          eyebrow: "Follow-up",
          title: "Exports",
          description: "Export key changes.",
          href: buildScopedShortcutHref("/exports", workspaceId, currentHref, { kind: "audit-logs" }),
          tone: "neutral" as const,
          meta: "Recommended",
          actionLabel: "Open",
        };
      }

      if (pathname === "/audit-logs" || pathname === "/exports" || pathname === "/usage-events") {
        return {
          eyebrow: "Follow-up",
          title: "Reports",
          description: "Keep reports and exports easy to reopen.",
          href: `${buildScopedShortcutHref("/exports", workspaceId, currentHref)}#scheduled-reports`,
          tone: "neutral" as const,
          meta: "Reports",
          actionLabel: "Open",
        };
      }

      if (pathname === "/alerts" || pathname === "/budgets") {
        return {
          eyebrow: "Follow-up",
          title: "Exports",
          description: "Export alert decisions.",
          href: `${buildScopedShortcutHref("/exports", workspaceId, currentHref)}#operational-follow-up`,
          tone: "warning" as const,
          meta: "Recommended",
          actionLabel: "Open",
        };
      }

      return {
        eyebrow: "Follow-up",
        title: "Home",
        description: "Return to Home.",
        href: buildScopedShortcutHref("/", workspaceId, currentHref),
        tone: "neutral" as const,
        meta: "Home",
        actionLabel: "Open",
      };
    })();

    const resumeCard =
      surfaceMemoryItems[0]
        ? {
            eyebrow: "Resume",
            title: surfaceMemoryItems[0].label,
            description: surfaceMemoryItems[0].description,
            href: surfaceMemoryItems[0].href,
            tone: surfaceMemoryItems[0].source === "favorite" ? ("neutral" as const) : ("warning" as const),
            meta:
              surfaceMemoryItems[0].source === "favorite"
                ? shellTr("savedViewLabel")
                : shellTr("recentVisitLabel"),
            actionLabel: "Open",
          }
        : workspaceJumpItems[0]
          ? {
              eyebrow: "Other workspace",
              title: workspaceJumpItems[0].label,
              description: `Open ${currentPageLabel} in another recent workspace.`,
              href: workspaceJumpItems[0].href,
              tone: "neutral" as const,
              meta: "Recent workspace",
              actionLabel: "Open",
            }
          : null;

    const baseCards: OperatorContextCard[] = [
      {
        eyebrow: "Start here",
        title: taskZoneItems[0]?.label ?? "Home",
        description:
          taskZoneItems[0]?.description ??
          "Open the next action.",
        href: taskZoneItems[0]?.href ?? buildScopedShortcutHref("/", workspaceId, currentHref),
        tone:
          pathname === "/alerts" || pathname === "/budgets"
            ? ("critical" as const)
            : pathname === "/providers" || pathname === "/virtual-keys"
              ? ("warning" as const)
              : ("neutral" as const),
        meta: taskLane.label,
        actionLabel: "Open",
      },
      {
        eyebrow: "Next",
        title: workflowShortcuts[0]?.label ?? "Next",
        description:
          workflowShortcuts[0]?.description ??
          "Open the next action.",
        href: workflowShortcuts[0]?.href ?? buildScopedShortcutHref("/", workspaceId, currentHref),
        tone: "neutral" as const,
        meta: "Suggested",
        actionLabel: "Open",
      },
      handoffCard,
      ...(resumeCard ? [resumeCard] : []),
    ];

    return baseCards.slice(0, 4);
  }, [currentHref, currentPageLabel, pathname, surfaceMemoryItems, taskLane.label, taskZoneItems, workflowShortcuts, workspaceId, workspaceJumpItems, shellTr]);
  const localizeShortcut = useMemo(
    () => (shortcut: ShellShortcut) => ({
      ...shortcut,
      label: tr(shortcut.label),
      description: shortcut.description ? tr(shortcut.description) : undefined,
    }),
    [tr],
  );
  const localizedTaskZoneItems = useMemo(
    () => taskZoneItems.map(localizeShortcut),
    [localizeShortcut, taskZoneItems],
  );
  const localizedWorkflowShortcuts = useMemo(
    () => workflowShortcuts.map(localizeShortcut),
    [localizeShortcut, workflowShortcuts],
  );
  const localizedTopbarActions = useMemo(
    () =>
      topbarActions.map((action) => ({
        ...action,
        label: tr(action.label),
      })),
    [topbarActions, tr],
  );
  const localizedSurfaceMemoryItems = useMemo(
    () =>
      surfaceMemoryItems.map((item) => ({
        ...item,
        label: tr(item.label),
        description: tr(item.description),
        meta: tr(item.meta),
      })),
    [surfaceMemoryItems, tr],
  );
  const localizedOperatorContextCards = useMemo(
    () =>
      operatorContextCards.map((card) => ({
        ...card,
        eyebrow: tr(card.eyebrow),
        title: tr(card.title),
        description: tr(card.description),
        badge: card.badge ? tr(card.badge) : undefined,
        meta: card.meta ? tr(card.meta) : undefined,
        actionLabel: card.actionLabel ? tr(card.actionLabel) : undefined,
      })),
    [operatorContextCards, tr],
  );
  const paletteItems = useMemo(() => {
    if (!shouldPreparePalette) {
      return [];
    }

    const items: CommandPaletteItem[] = [];

    for (const visit of recentVisits) {
      const descriptor = resolveSurfaceDescriptor(
        {
          href: visit.href,
          workspaceId: visit.workspaceId ?? null,
          visitedAt: visit.visitedAt,
          source: "recent",
          descriptorKey: visit.descriptorKey,
          descriptorProps: visit.descriptorProps,
        },
        { tr: shellTr, locale },
      );

      items.push({
        id: `visit:${visit.href}`,
        label: descriptor.label,
        description: descriptor.description,
        href: visit.href,
        section: descriptor.section,
        keywords: descriptor.keywords,
      });
    }

    for (const surface of favoriteSurfaces) {
      const descriptor = resolveSurfaceDescriptor(
        {
          href: surface.href,
          workspaceId: surface.workspaceId ?? null,
          workspaceName: surface.workspaceName ?? null,
          savedAt: surface.savedAt,
          source: "favorite",
          descriptorKey: surface.descriptorKey,
          descriptorProps: surface.descriptorProps,
        },
        { tr: shellTr, locale },
      );

      items.push({
        id: `favorite:${surface.href}`,
        label: descriptor.label,
        description: descriptor.description,
        href: surface.href,
        section: descriptor.section,
        keywords: descriptor.keywords,
      });
    }

    for (const workspace of recentWorkspaces) {
      const workspaceLabel = workspace.workspaceName?.trim() || workspace.id;
      items.push({
        id: `workspace:${workspace.id}:${pathname}`,
        label: workspaceLabel,
        description: shellTr("switchingWorkspace", {workspace: workspaceLabel}),
        href: buildWorkspaceScopedHref(pathname, searchParams, workspace.id),
        section: shellKey("commandPalette.sections.workspaces"),
        keywords: `${workspaceLabel} workspace switch recent`,
      });
    }

    for (const workspace of workspaceContextOptions) {
      if (workspace.id === workspaceId) {
        continue;
      }

      const workspaceOptionLabel = workspace.label;
      items.push({
        id: `workspace-option:${workspace.id}:${pathname}`,
        label: workspaceOptionLabel,
        description: tr(shellKey("commandPalette.openPageInWorkspace"), {workspace: workspaceOptionLabel}),
        href: buildWorkspaceScopedHref(pathname, searchParams, workspace.id),
        section: shellKey("commandPalette.sections.workspaces"),
        keywords: `${workspace.label} workspace switch all workspaces directory`,
      });
    }

    for (const shortcut of workflowShortcuts) {
      items.push({
        id: `workflow:${shortcut.href}`,
        label: shortcut.label,
        description: shortcut.description ?? "",
        href: shortcut.href,
        section: shellKey("commandPalette.sections.shortcuts"),
        keywords: `${shortcut.label} ${shortcut.description ?? ""} workflow continue handoff`,
      });
    }

    for (const shortcut of taskZoneItems) {
      items.push({
        id: `task:${shortcut.href}`,
        label: shortcut.label,
        description: shortcut.description ?? "",
        href: shortcut.href,
        section: shellKey("commandPalette.sections.now"),
        keywords: `${shortcut.label} ${shortcut.description ?? ""} task queue do next`,
      });
    }

    for (const shortcut of pinnedTasks as ShellShortcut[]) {
      const shortcutDescription = shortcut.description || shellKey("commandPalette.shortcut");
      items.push({
        id: `pinned:${shortcut.href}`,
        label: shortcut.label,
        description: shortcutDescription,
        href: shortcut.href,
        section: shellKey("commandPalette.sections.pinned"),
        keywords: `${shortcut.label} ${shortcutDescription} pinned favorites`,
      });
    }

    items.push({
      id: `quick:save-view:${currentHref}`,
      label: isCurrentSurfaceFavorited ? "Remove view" : "Save view",
      description: isCurrentSurfaceFavorited
        ? shellKey("utility.removeViewDescription")
        : shellKey("utility.saveViewDescription"),
      href: currentHref,
      section: shellKey("commandPalette.sections.tools"),
      keywords: `${currentPageLabel} save view favorite current page`,
      shortcutLabel: "⌘⇧S",
      action: () => handleToggleFavoriteSurface(),
    });

    items.push({
      id: `quick:copy-link:${currentHref}`,
      label: shellKey("utility.copyLink"),
      description: shellKey("utility.copyLink"),
      href: currentHref,
      section: shellKey("commandPalette.sections.tools"),
      keywords: `${currentPageLabel} copy page link share lane`,
      action: () => {
        void handleCopyLaneLink();
      },
    });

    items.push({
      id: `quick:focus-mode:${currentHref}`,
      label: isFocusMode ? shellKey("utility.focusOff") : shellKey("utility.focusOn"),
      description: isFocusMode
        ? shellKey("utility.showSupportPanels")
        : shellKey("utility.hideSupportPanels"),
      href: currentHref,
      section: shellKey("commandPalette.sections.tools"),
      keywords: `${currentPageLabel} focus mode toggle distractions`,
      shortcutLabel: "⌘.",
      action: () => handleToggleFocusMode(),
    });

    if (workspaceId) {
      items.push({
        id: `quick:workspace-directory:${workspaceId}`,
        label: "Workspaces",
        description: shellKey("utility.openWorkspaces"),
        href: buildNavHref("/workspaces", null),
        section: shellKey("commandPalette.sections.tools"),
        keywords: "open workspace directory change scope workspaces",
      });
    }

    for (const action of topbarActions) {
      items.push({
        id: `action:${action.href}`,
        label: action.label,
        description: shellKey("utility.topbarAction"),
        href: action.href,
        section: shellKey("commandPalette.sections.tools"),
        keywords: `${action.label} topbar action`,
      });
    }

    const commandHomeItem = homeNavItem;

    items.push({
      id: `nav:${commandHomeItem.href}`,
      label: commandHomeItem.label,
      description: commandHomeItem.description,
      href: buildNavHref(commandHomeItem.href, workspaceId),
      section: shellKey("taskLane.home.label"),
      keywords: `${commandHomeItem.label} ${commandHomeItem.description} ${(commandHomeItem.keywords ?? []).join(" ")}`,
    });

    items.push({
      id: "tool:setup",
      label: shellKey("navigation.items.setup.label"),
      description: shellKey("navigation.items.setup.description"),
      href: buildContextualHref("/setup", currentHref),
      section: shellKey("commandPalette.sections.tools"),
      keywords: "setup onboarding activation checklist getting started",
    });

    for (const section of navSections) {
      for (const item of section.items) {
        items.push({
          id: `nav:${item.href}`,
          label: item.label,
          description: item.description,
          href: buildNavHref(item.href, workspaceId),
          section: section.label,
          keywords: `${section.label} ${section.description} ${item.label} ${item.description} ${(item.keywords ?? []).join(" ")}`,
        });
      }
    }

    const dedupedItems = new Map<string, CommandPaletteItem>();

    for (const item of items) {
      const key = `${item.section}:${item.label}:${item.href}`;
      if (!dedupedItems.has(key)) {
        dedupedItems.set(key, item);
      }
    }

    return Array.from(dedupedItems.values());
  }, [
    currentHref,
    currentPageLabel,
    favoriteSurfaces,
    isCurrentSurfaceFavorited,
    isFocusMode,
    pathname,
    recentVisits,
    recentWorkspaces,
    searchParams,
    taskZoneItems,
    topbarActions,
    workspaceContextOptions,
    workspaceId,
    pinnedTasks,
    shouldPreparePalette,
    workflowShortcuts,
    locale,
    shellTr,
  ]);
  const localizedPaletteItems = useMemo(
    () => {
      if (!shouldPreparePalette) {
        return [];
      }

      return paletteItems.map((item) => {
        const sectionLabel = tr(item.section);
        const label = tr(item.label);
        const description = tr(item.description);

        return {
          ...item,
          label,
          description,
          sectionLabel,
          keywords: [item.keywords, sectionLabel, label, description].filter(Boolean).join(" "),
          shortcutLabel: item.shortcutLabel ? tr(item.shortcutLabel) : item.shortcutLabel,
        };
      });
    },
    [paletteItems, shouldPreparePalette, tr],
  );
  const filteredPaletteItems = useMemo(() => {
    if (!shouldPreparePalette) {
      return [];
    }

    if (!deferredPaletteQuery) {
      return localizedPaletteItems.slice(0, 18);
    }

    return localizedPaletteItems
      .map((item, index) => ({
        item,
        index,
        score: getCommandPaletteItemScore(item, normalizedPaletteQuery, deferredPaletteTokens),
      }))
      .filter((entry) => entry.score >= 0)
      .sort((left, right) => right.score - left.score || left.index - right.index)
      .map((entry) => entry.item)
      .slice(0, 24);
  }, [
    deferredPaletteQuery,
    deferredPaletteTokens,
    localizedPaletteItems,
    normalizedPaletteQuery,
    shouldPreparePalette,
  ]);
  const groupedPaletteItems = useMemo(() => {
    if (!shouldPreparePalette) {
      return [];
    }

    const groups = new Map<string, { label: string; items: CommandPaletteItem[] }>();

    for (const item of filteredPaletteItems) {
      const group = groups.get(item.section) ?? {
        label: item.sectionLabel ?? tr(item.section),
        items: [],
      };
      group.items.push(item);
      groups.set(item.section, group);
    }

    return Array.from(groups.entries())
      .sort(
        ([leftSection], [rightSection]) =>
          getCommandPaletteSectionRank(leftSection) - getCommandPaletteSectionRank(rightSection) ||
          leftSection.localeCompare(rightSection),
      )
      .map(([section, group]) => ({
        section,
        label: group.label,
        items: group.items,
      }));
  }, [filteredPaletteItems, shouldPreparePalette, tr]);

  useEffect(() => {
    try {
      const raw =
        readTimedSessionStorageValue<unknown[]>(recentVisitStorageKey) ??
        readJsonStorageValue<unknown[]>(window.localStorage, recentVisitStorageKey) ??
        [];
      const normalized = raw
        .map(normalizeStoredRecentVisit)
        .filter((item): item is StoredRecentVisit => Boolean(item));
      const nextVisits = [
        {
          href: currentHref,
          visitedAt: Date.now(),
          workspaceId,
          descriptorKey: buildSurfaceDescriptorKey(currentHref, workspaceId),
        },
        ...normalized.filter((item) => item.href !== currentHref),
      ].slice(0, maxStoredRecentVisits);

      writeTimedSessionStorageValue(recentVisitStorageKey, nextVisits, recentNavigationStorageTtlMs);
      window.localStorage.removeItem(recentVisitStorageKey);
      setRecentVisits(nextVisits.filter((item) => item.href !== currentHref).slice(0, maxStoredRecentVisits));
    } catch {
      setRecentVisits([]);
    }

    setIsSidebarOpen(false);
  }, [currentHref, workspaceId]);

  useEffect(() => {
    setPendingHref(null);
  }, [currentHref]);

  useEffect(() => {
    try {
      const raw =
        readTimedSessionStorageValue<unknown[]>(recentWorkspaceStorageKey) ??
        readJsonStorageValue<unknown[]>(window.localStorage, recentWorkspaceStorageKey) ??
        [];
      const parsed = raw
        .map(normalizeStoredRecentWorkspace)
        .filter(
          (item): item is StoredRecentWorkspace =>
            item !== null && Boolean(getStoredRecentWorkspaceName(item.workspaceName)),
        );
      if (parsed.length) {
        writeTimedSessionStorageValue(
          recentWorkspaceStorageKey,
          parsed,
          recentNavigationStorageTtlMs,
        );
      } else {
        window.sessionStorage.removeItem(recentWorkspaceStorageKey);
      }
      window.localStorage.removeItem(recentWorkspaceStorageKey);
      setRecentWorkspaces(parsed.filter((item) => item.id !== workspaceId).slice(0, maxStoredRecentWorkspaces));
    } catch {
      setRecentWorkspaces([]);
    }
  }, [workspaceId]);

  useEffect(() => {
    try {
      const raw = readJsonStorageValue<unknown[]>(window.localStorage, favoriteSurfaceStorageKey) ?? [];
      const normalized = raw
        .map(normalizeStoredFavoriteSurface)
        .filter((item): item is StoredFavoriteSurface => Boolean(item));
      if (normalized.length) {
        window.localStorage.setItem(favoriteSurfaceStorageKey, JSON.stringify(normalized));
      } else {
        window.localStorage.removeItem(favoriteSurfaceStorageKey);
      }
      setFavoriteSurfaces(normalized.slice(0, 6));
    } catch {
      setFavoriteSurfaces([]);
    }
  }, [currentHref]);

  useEffect(() => {
    if (!workspaceId) {
      return;
    }

    try {
      const raw =
        readTimedSessionStorageValue<unknown[]>(recentWorkspaceStorageKey) ??
        readJsonStorageValue<unknown[]>(window.localStorage, recentWorkspaceStorageKey) ??
        [];
      const parsed = raw
        .map(normalizeStoredRecentWorkspace)
        .filter(
          (item): item is StoredRecentWorkspace =>
            item !== null && Boolean(getStoredRecentWorkspaceName(item.workspaceName)),
        );
      const nextWorkspaces = [
        {
          id: workspaceId,
          workspaceName: getStoredRecentWorkspaceName(workspaceScopeLabel),
          visitedAt: Date.now(),
        },
        ...parsed.filter((item) => item.id !== workspaceId),
      ].slice(0, maxStoredRecentWorkspaces);

      writeTimedSessionStorageValue(recentWorkspaceStorageKey, nextWorkspaces, recentNavigationStorageTtlMs);
      window.localStorage.removeItem(recentWorkspaceStorageKey);
      setRecentWorkspaces(nextWorkspaces.filter((item) => item.id !== workspaceId).slice(0, maxStoredRecentWorkspaces));
    } catch {
      setRecentWorkspaces([]);
    }
  }, [workspaceId, workspaceScopeLabel]);

  useEffect(() => {
    try {
      setIsFocusMode(window.localStorage.getItem(focusModeStorageKey) === "1");
    } catch {
      setIsFocusMode(false);
    }
  }, []);

  useEffect(() => {
    if (!workspaceId) {
      return;
    }

    persistWorkspacePreference(
      workspaceId,
      consolePreferences.rememberLastWorkspace,
    );
  }, [consolePreferences.rememberLastWorkspace, workspaceId]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    setShareHref(new URL(currentHref, window.location.origin).toString());
  }, [currentHref]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) {
      setAllowPaletteAutoFocus(false);
      return;
    }

    const mediaQuery = window.matchMedia("(hover: hover) and (pointer: fine)");
    const updatePreference = () => setAllowPaletteAutoFocus(mediaQuery.matches);

    updatePreference();
    mediaQuery.addEventListener("change", updatePreference);
    return () => mediaQuery.removeEventListener("change", updatePreference);
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setIsCommandPaletteOpen(true);
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "s") {
        event.preventDefault();
        handleToggleFavoriteSurface();
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key === ".") {
        event.preventDefault();
        handleToggleFocusMode();
        return;
      }

      if (event.key === "/" && !isTypingTarget(event.target)) {
        event.preventDefault();
        setIsCommandPaletteOpen(true);
        return;
      }

      if (event.key === "Escape") {
        setIsCommandPaletteOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleToggleFavoriteSurface, handleToggleFocusMode]);

  useEffect(() => {
    if (!isCommandPaletteOpen) {
      setPaletteQuery("");
    }
  }, [isCommandPaletteOpen]);

  useEffect(() => {
    if (copyLaneStatus === "idle") {
      return;
    }

    const timeout = window.setTimeout(() => {
      setCopyLaneStatus("idle");
    }, 1600);

    return () => window.clearTimeout(timeout);
  }, [copyLaneStatus]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.location.hash) {
      return;
    }

    const targetId = decodeURIComponent(window.location.hash.slice(1));
    if (!targetId) {
      return;
    }

    const restoreFragmentContext = () => {
      const target = document.getElementById(targetId);
      if (!(target instanceof HTMLElement)) {
        return;
      }

      let detailsAncestor = target.closest("details");
      while (detailsAncestor instanceof HTMLDetailsElement) {
        detailsAncestor.open = true;
        detailsAncestor = detailsAncestor.parentElement?.closest("details") ?? null;
      }

      target.scrollIntoView({
        block: "center",
        inline: "nearest",
      });
    };

    const frameA = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(restoreFragmentContext);
    });

    return () => window.cancelAnimationFrame(frameA);
  }, [pathname, searchParams]);

  function announceAction(message: string) {
    setLiveMessage("");
    window.setTimeout(() => setLiveMessage(message), 0);
  }

  const warmRoute = useCallback((href: string) => {
    if (
      !href ||
      href === currentHref ||
      warmedRouteHrefsRef.current.has(href) ||
      workspaceIdentityState.status === "switching"
    ) {
      return Promise.resolve();
    }

    warmedRouteHrefsRef.current.add(href);
    const skipPrefetch = shouldSkipWorkspacePrefetch(href);

    try {
      if (!skipPrefetch) {
        router.prefetch(href);
      }
      void prefetchConsoleRouteData(queryClient, href, { skip: skipPrefetch }).catch(() => {
        warmedRouteHrefsRef.current.delete(href);
      });
    } catch {
      warmedRouteHrefsRef.current.delete(href);
      // Ignore prefetch failures and keep navigation responsive.
    }

    return Promise.resolve();
  }, [
    currentHref,
    queryClient,
    router,
    workspaceIdentityState.status,
    shouldSkipWorkspacePrefetch,
  ]);

  useEffect(() => {
    if (typeof window === "undefined" || !workspaceId) {
      return;
    }

    const frequentRouteHrefs = [
      buildNavHref("/", workspaceId),
      buildNavHref("/providers", workspaceId),
      buildNavHref("/alerts", workspaceId),
      buildNavHref("/usage-events", workspaceId),
      buildNavHref("/audit-logs", workspaceId),
    ].filter((href) => href !== currentHref);

    if (!frequentRouteHrefs.length) {
      return;
    }

    let cancelled = false;
    const runWarmup = () => {
      if (cancelled) {
        return;
      }

      for (const href of frequentRouteHrefs) {
        void warmRoute(href);
      }
    };

    const idleCallback = "requestIdleCallback" in window
      ? window.requestIdleCallback(runWarmup, { timeout: 1200 })
      : null;
    const timeoutId = idleCallback === null ? window.setTimeout(runWarmup, 200) : null;

    return () => {
      cancelled = true;
      if (idleCallback !== null && "cancelIdleCallback" in window) {
        window.cancelIdleCallback(idleCallback);
      }
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [currentHref, warmRoute, workspaceId]);

  function markPendingNavigation(
    href: string,
    event?: Pick<
      ReactMouseEvent<HTMLElement>,
      "button" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey" | "preventDefault"
    >,
  ) {
    if (event && (event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey)) {
      return;
    }

    if (isSameNavDestination(currentHref, href)) {
      event?.preventDefault();
      setPendingHref(null);
      return;
    }

    setPendingHref(href);
  }

  function writeFavoriteSurfaces(items: StoredFavoriteSurface[]) {
    const truncated = items.slice(0, 8);
    window.localStorage.setItem(favoriteSurfaceStorageKey, JSON.stringify(truncated));
    setFavoriteSurfaces(truncated.slice(0, 6));
  }

  function readFavoriteSurfacesFromStorage() {
    const raw = readJsonStorageValue<unknown[]>(window.localStorage, favoriteSurfaceStorageKey) ?? [];
    return raw
      .map(normalizeStoredFavoriteSurface)
      .filter((item): item is StoredFavoriteSurface => Boolean(item));
  }

  function handleToggleFavoriteSurface() {
    try {
      const parsed = readFavoriteSurfacesFromStorage();
      const isCurrentlyFavorited = parsed.some((item) => item.href === currentHref);
      const nextFavorites = isCurrentlyFavorited
        ? parsed.filter((item) => item.href !== currentHref)
        : [
            {
              href: currentHref,
              savedAt: Date.now(),
              workspaceId,
              workspaceName: workspaceLabel?.trim() ?? null,
              descriptorKey: buildSurfaceDescriptorKey(currentHref, workspaceId),
            },
            ...parsed.filter((item) => item.href !== currentHref),
          ];

      writeFavoriteSurfaces(nextFavorites);
      announceAction(
        isCurrentlyFavorited
          ? shellTr("savedViewRemoved")
          : shellTr("savedViewAdded"),
      );
    } catch {
      announceAction(shellTr("savedViewUpdateFailed"));
    }
  }

  function handleRemoveFavoriteSurface(href: string) {
    try {
      const parsed = readFavoriteSurfacesFromStorage();
      const nextFavorites = parsed.filter((item) => item.href !== href);
      writeFavoriteSurfaces(nextFavorites);
      announceAction(shellTr("savedViewRemoved"));
    } catch {
      announceAction(shellTr("savedViewRemovalFailed"));
    }
  }

  function handleClearFavoriteSurfaces() {
    try {
      writeFavoriteSurfaces([]);
      announceAction(shellTr("savedViewsCleared"));
    } catch {
      announceAction(shellTr("savedViewsClearFailed"));
    }
  }

  function handleToggleFocusMode() {
    setIsFocusMode((current) => {
      const next = !current;

      try {
        window.localStorage.setItem(focusModeStorageKey, next ? "1" : "0");
      } catch {
        // Ignore storage failures and keep the UI responsive.
      }

      announceAction(tr(next ? "Focus mode on." : "Focus mode off."));

      return next;
    });
  }

  const quickThemeValue = hasMounted ? (resolvedTheme === "dark" ? "dark" : "light") : "system";
  const QuickThemeIcon =
    quickThemeValue === "dark" ? MoonStar : quickThemeValue === "light" ? SunMedium : LaptopMinimal;
  const quickThemeLabel = tr(
    quickThemeValue === "dark"
      ? shellKey("themes.dark")
      : quickThemeValue === "light"
        ? shellKey("themes.light")
        : shellKey("themes.system"),
  );

  async function handleCopyLaneLink() {
    try {
      await navigator.clipboard.writeText(shareHref || currentHref);
      setCopyLaneStatus("copied");
      announceAction(tr(shellKey("utility.laneLinkCopied")));
    } catch {
      setCopyLaneStatus("error");
      announceAction(tr(shellKey("utility.laneLinkCopyFailed")));
    }
  }

  function navigateToHref(href: string, options?: { announce?: string }) {
    if (!href || isSameNavDestination(currentHref, href)) {
      setPendingHref(null);
      return;
    }

    if (options?.announce) {
      announceAction(options.announce);
    }

    setPendingHref(href);
    void warmRoute(href);
    router.push(href);
  }


  const visibleWorkflowShortcuts = localizedWorkflowShortcuts.slice(0, 3);
  const visibleOperatorContextCards = localizedOperatorContextCards.slice(0, 1);
  const visibleSurfaceMemoryItems = localizedSurfaceMemoryItems.filter((item) => item.source === "recent").slice(0, 2);
  const shouldShowOperatorContext =
    showOperatorContextCards &&
    !isFocusMode &&
    !isMinimalSidebar &&
    !useCompactHeader &&
    pathname !== "/" &&
    visibleOperatorContextCards.length > 0;
  const renderLanguageOptions = () => {
    const statusMessage = isPending
      ? shellTr("languageSwitchPending")
      : `${shellTr("currentLanguage")}: ${locale}`;

    return (
      <div className="space-y-1 px-1">
        <DropdownMenuRadioGroup
          onValueChange={(value) => setLocale(value as (typeof localeOptions)[number]["value"])}
          value={locale}
        >
          {localeOptions.map((option) => {
            const isActive = locale === option.value;
            const optionDescription =
              option.value === "zh" ? shellTr("useChinese") : shellTr("useEnglish");

            return (
              <DropdownMenuRadioItem
                className="gap-2"
                key={option.value}
                value={option.value}
                disabled={isPending}
              >
                <div className="grid flex-1 gap-0.5">
                  <span>{option.label}</span>
                  <span className="text-xs uppercase text-muted-foreground">{optionDescription}</span>
                </div>
                <Check className={cn("size-4 text-[var(--primary-strong)] opacity-0 transition-opacity", isActive && "opacity-100")} />
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
        <p className="text-xs text-muted-foreground">{statusMessage}</p>
      </div>
    );
  };

  const renderShellUtilityMenuContent = () => (
    <DropdownMenuContent align="end" className="w-64">
      <DropdownMenuLabel>{tr(shellKey("utility.preferences"))}</DropdownMenuLabel>
      <DropdownMenuGroup>
        <DropdownMenuItem onSelect={handleCopyLaneLink}>
          <Link2 className="mr-2 size-4" />
          {tr(
            copyLaneStatus === "copied"
              ? "Link copied"
              : copyLaneStatus === "error"
                ? "Retry copy link"
                : "Copy link",
          )}
        </DropdownMenuItem>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <Languages className="mr-2 size-4" />
          {shellTr("languageLabel")}
          <DropdownMenuShortcut>
            {isPending ? tr("…") : activeLocaleOption?.shortLabel ?? locale}
          </DropdownMenuShortcut>
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="w-56">{renderLanguageOptions()}</DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSeparator />
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <ActiveThemeIcon className="mr-2 size-4" />
          {tr(shellKey("utility.theme"))}
          <DropdownMenuShortcut>
            {currentThemeValue === "system"
              ? tr(shellKey("themes.autoLabel"), {theme: localizedResolvedThemeLabel})
              : tr(activeTheme.label)}
          </DropdownMenuShortcut>
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="w-56">
          <DropdownMenuRadioGroup onValueChange={updateThemePreference} value={currentThemeValue}>
            {shellThemeOptions.map((option) => {
              const OptionIcon = option.icon;
              const isActive = currentThemeValue === option.value;

              return (
                <DropdownMenuRadioItem className="gap-2" disabled={isPending} key={option.value} value={option.value}>
                  <OptionIcon className="size-4" />
                  <div className="grid flex-1 gap-0.5">
                    <span>{tr(option.label)}</span>
                    <span className="text-xs text-muted-foreground">
                      {option.value === "system"
                        ? tr(shellKey("themes.systemDescription"), {theme: localizedResolvedThemeLabel})
                        : tr(shellKey("themes.fixedDescription"), {theme: tr(option.label)})}
                    </span>
                  </div>
                  <Check className={cn("size-4 text-[var(--primary-strong)] opacity-0 transition-opacity", isActive && "opacity-100")} />
                </DropdownMenuRadioItem>
              );
            })}
          </DropdownMenuRadioGroup>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    </DropdownMenuContent>
  );

  const workspaceIdentityResolution = shellSession.session?.workspace.identityResolution ?? null;
  const shouldShowWorkspaceIdentityNotice =
    Boolean(workspaceId) &&
    (workspaceIdentityState.status === "failed" ||
      workspaceIdentityState.status === "switching" ||
      workspaceIdentityResolution?.status === "switch_required");
  const workspaceIdentityNoticeActions =
    workspaceIdentityState.status === "failed" && workspaceIdentityState.workspaceId === workspaceId ? (
      <div className="flex flex-wrap gap-2">
        <Button
          className="rounded-full px-4"
          onClick={() => shellSession.retryWorkspaceIdentitySync()}
          size="sm"
          type="button"
          variant="outline"
        >
          {shellTr("workspaceContextRetry")}
        </Button>
        <Button asChild className="rounded-full px-4" size="sm" variant="outline">
          <Link href={`/auth/select-identity?returnTo=${encodeURIComponent(currentHref)}`}>
            {shellTr("workspaceContextSelectIdentity")}
          </Link>
        </Button>
      </div>
    ) : null;

  return (
    <>
      <div className="min-h-screen overflow-x-clip" style={shellRootStyle}>
        <a className="skip-link" href="#main-content">
          {tr(shellKey("utility.skipToContent"))}
        </a>
        <div aria-atomic="true" aria-live="polite" className="visually-hidden">
          {liveMessage}
        </div>

        <div className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-[color:var(--border-default)] bg-[color:color-mix(in_srgb,var(--surface-canvas)_92%,var(--surface-1)_8%)] px-3 py-2 backdrop-blur-md xl:hidden">
          <div className="min-w-0">
            <p className="truncate text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground/72">
              {workspaceScopeLabel ?? tr(shellKey("utility.appName"))}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  aria-label={`${tr(shellKey("utility.theme"))}: ${quickThemeLabel}`}
                  className="h-8 min-w-0 rounded-full border border-[color:var(--border-default)] bg-[color:color-mix(in_srgb,var(--surface-1)_94%,var(--surface-canvas)_6%)] px-2.5 text-[12px] font-medium text-foreground shadow-none hover:bg-[color:color-mix(in_srgb,var(--surface-1)_86%,var(--surface-hover)_14%)]"
                  size="sm"
                  title={`${tr(shellKey("utility.theme"))}: ${quickThemeLabel}`}
                  type="button"
                  variant="ghost"
                >
                  <QuickThemeIcon className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-36">
                <DropdownMenuLabel>{tr(shellKey("utility.theme"))}</DropdownMenuLabel>
                <DropdownMenuRadioGroup onValueChange={updateThemePreference} value={currentThemeValue}>
                  {shellThemeOptions.map((option) => {
                    const OptionIcon = option.icon;
                    const isActive = currentThemeValue === option.value;

                    return (
                      <DropdownMenuRadioItem className="gap-2 py-1.5" key={`mobile-theme-${option.value}`} value={option.value}>
                        <OptionIcon className="size-3.5" />
                        <span className="flex-1 text-[12.5px]">{tr(option.label)}</span>
                        <Check className={cn("size-3.5 text-[var(--primary-strong)] opacity-0 transition-opacity", isActive && "opacity-100")} />
                      </DropdownMenuRadioItem>
                    );
                  })}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              aria-label={tr(shellKey("utility.openSearch"))}
              className="size-8 rounded-md border border-transparent text-muted-foreground shadow-none hover:border-[color:var(--border-default)] hover:bg-[color:color-mix(in_srgb,var(--surface-1)_92%,var(--surface-2)_8%)] hover:text-foreground"
              onClick={() => setIsCommandPaletteOpen(true)}
              size="icon"
              type="button"
              variant="ghost"
            >
              <Search className="size-4" />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  aria-label={tr(shellKey("utility.openHeaderActions"))}
                  className="size-8 rounded-md border border-transparent bg-transparent text-muted-foreground shadow-none hover:border-[color:var(--border-default)] hover:bg-[color:color-mix(in_srgb,var(--surface-1)_92%,var(--surface-2)_8%)] hover:text-foreground"
                  size="icon"
                  type="button"
                  variant="ghost"
                >
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              {renderShellUtilityMenuContent()}
            </DropdownMenu>
            <Button
              aria-controls="workspace-shell-sidebar"
              aria-expanded={isSidebarOpen}
              className="min-h-8 rounded-md border border-transparent bg-transparent px-2.5 text-[13px] text-muted-foreground shadow-none hover:border-[color:var(--border-default)] hover:bg-[color:color-mix(in_srgb,var(--surface-1)_92%,var(--surface-2)_8%)] hover:text-foreground"
              onClick={() => setIsSidebarOpen((current) => !current)}
              size="sm"
              type="button"
              variant="ghost"
            >
              {isSidebarOpen ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
            </Button>
          </div>
        </div>

        {isSidebarOpen ? (
          <button
            aria-label={tr(shellKey("utility.closeNavigation"))}
            className="shell-sidebar-scrim fixed inset-0 z-30 bg-black/20 backdrop-blur-[1px] xl:hidden"
            onClick={() => setIsSidebarOpen(false)}
            type="button"
          />
        ) : null}

        <div className={shellStageClassName}>
          <aside
            className={cn(
              "shell-sidebar-panel fixed inset-y-0 left-0 z-40 w-[88vw] max-w-[320px] border-r border-[color:var(--border-default)] bg-[color:color-mix(in_srgb,var(--surface-1)_96%,var(--surface-canvas)_4%)] shadow-none transition-transform duration-200 xl:sticky xl:top-0 xl:h-screen xl:max-w-none xl:translate-x-0 xl:border-b-0 xl:w-[var(--shell-sidebar-width)] xl:bg-[color:color-mix(in_srgb,var(--surface-canvas-subtle)_88%,var(--surface-1)_12%)] xl:shadow-none",
              isSidebarOpen ? "translate-x-0" : "-translate-x-full xl:translate-x-0",
            )}
          >
            <div className="flex items-center justify-between border-b border-[color:var(--border-default)] px-4 py-3 xl:hidden">
              <div className="grid gap-0.5">
                <p className="text-[11px] font-medium tracking-[0.08em] text-muted-foreground/84">ModelYard</p>
                <strong className="text-sm tracking-tight text-foreground">{tr(shellKey("utility.navigation"))}</strong>
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  aria-label={tr(shellKey("utility.openSearch"))}
                  className="size-8 rounded-md border border-transparent text-muted-foreground shadow-none hover:border-[color:var(--border-default)] hover:bg-[color:color-mix(in_srgb,var(--surface-1)_92%,var(--surface-2)_8%)] hover:text-foreground"
                  onClick={() => {
                    setIsSidebarOpen(false);
                    setIsCommandPaletteOpen(true);
                  }}
                  size="icon"
                  type="button"
                  variant="ghost"
                >
                  <Search className="size-4" />
                </Button>
                <Button
                  aria-label={tr(shellKey("utility.closeNavigation"))}
                  className="size-8 rounded-md border border-transparent bg-transparent text-muted-foreground shadow-none hover:border-[color:var(--border-default)] hover:bg-[color:color-mix(in_srgb,var(--surface-1)_92%,var(--surface-2)_8%)] hover:text-foreground"
                  onClick={() => setIsSidebarOpen(false)}
                  size="icon"
                  type="button"
                  variant="ghost"
                >
                  <PanelLeftClose className="size-4" />
                </Button>
              </div>
            </div>

            <div
              className={cn("space-y-4 px-3 py-4 pb-6 xl:flex xl:h-full xl:flex-col xl:px-3 xl:py-5")}
              id="workspace-shell-sidebar"
            >
              <div className="space-y-1.5 border-b border-[color:var(--border-default)] px-1 pb-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/78">
                  {tr(shellKey("utility.appName"))}
                </p>
                <div className="space-y-0.5">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/74">
                    {tr(workspaceId ? "Workspace" : "Workspaces")}
                  </p>
                  <p className="truncate text-[13px] font-medium text-foreground/90">
                    {workspaceScopeLabel ?? tr("Workspaces")}
                  </p>
                </div>
              </div>

              <nav aria-label={tr(shellKey("utility.primaryNavigation"))} className="min-h-0 flex-1 overflow-y-auto pr-1">
                {shouldRenderNavigationSkeleton ? (
                  <div className={cn("pb-4", isMinimalSidebar ? "space-y-3.5" : "space-y-5")}>
                    <div className="calm-skeleton-block h-9 rounded-md" />
                    {Array.from({ length: 3 }).map((_, index) => (
                      <div className={cn(isMinimalSidebar ? "space-y-1" : "space-y-1.5")} key={`nav-skeleton-${index}`}>
                        <div className="calm-skeleton-block h-7 rounded-md" />
                        <div className="ml-2 space-y-1 border-l border-border/50 pl-2.5">
                          <div className="calm-skeleton-block h-7 rounded-md" />
                          <div className="calm-skeleton-block h-7 rounded-md" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : filteredHomeNavItem || filteredNavSections.length ? (
                  <div className={cn("pb-4", isMinimalSidebar ? "space-y-3.5" : "space-y-5")}>
                    {filteredHomeNavItem ? (() => {
                      const homeHref = buildNavHref(filteredHomeNavItem.href, workspaceId);
                      const homeActive = isActiveNavItem(pathname, filteredHomeNavItem.href);
                      const homePending = pendingHref === homeHref;

                      return (
                        <Link
                          aria-current={homeActive ? "page" : undefined}
                          className={cn(
                            "motion-surface group flex min-h-9 items-center rounded-md border px-2 shadow-none transition-colors",
                            homeActive
                              ? "-translate-y-px border-[color:var(--primary-border)] bg-[color:color-mix(in_srgb,var(--surface-1)_76%,var(--surface-selected)_24%)] text-foreground shadow-none"
                              : homePending
                                ? "translate-x-0.5 border-transparent text-foreground/74"
                                : "border-transparent text-muted-foreground/84 hover:border-[color:var(--border-default)] hover:bg-[color:color-mix(in_srgb,var(--surface-1)_92%,var(--surface-2)_8%)] hover:text-foreground",
                          )}
                          href={homeHref}
                          onClick={(event) => {
                            markPendingNavigation(homeHref, event);
                            setIsSidebarOpen(false);
                          }}
                          onPointerDown={() => warmRoute(homeHref)}
                          onFocus={() => warmRoute(homeHref)}
                          onMouseEnter={() => warmRoute(homeHref)}
                          key={filteredHomeNavItem.href}
                        >
                          <span className="inline-flex min-w-0 items-center gap-2">
                            {filteredHomeNavItem.icon ? (
                              <filteredHomeNavItem.icon
                                aria-hidden="true"
                                className="size-3.5 shrink-0 text-current opacity-65"
                              />
                            ) : null}
                            <span className="truncate text-[13.5px] font-medium">
                              {filteredHomeNavItem.label}
                            </span>
                          </span>
                        </Link>
                      );
                    })() : null}
                    {filteredNavSections.map((section) => {
                      const hasActiveItem = section.items.some((item) => isActiveNavItem(pathname, item.href));
                      const isSectionExpanded = getIsSectionExpanded(section.label, hasActiveItem);
                      const SectionToggleIcon = isSectionExpanded ? ChevronDown : ChevronRight;

                      return (
                        <div className={cn(isMinimalSidebar ? "space-y-1" : "space-y-1.5")} key={section.label}>
                          {isMinimalSidebar ? (
                            <div
                              className={cn(
                                "flex w-full items-center justify-between rounded-md px-2 py-1 text-left",
                                hasActiveItem
                                  ? "text-foreground"
                                  : "text-muted-foreground/82",
                              )}
                            >
                              <span className="min-w-0">
                                <span className="block text-[11px] font-semibold uppercase tracking-[0.1em]">
                                  {section.label}
                                </span>
                              </span>
                            </div>
                          ) : (
                            <button
                              aria-expanded={isSectionExpanded}
                              className={cn(
                                "flex w-full items-center justify-between rounded-md border px-2 py-1 text-left shadow-none transition-colors",
                                hasActiveItem
                                  ? "border-[color:var(--primary-border)] bg-[color:color-mix(in_srgb,var(--surface-1)_80%,var(--surface-selected)_20%)] text-foreground shadow-none"
                                  : "border-transparent text-muted-foreground/82 hover:border-[color:var(--border-default)] hover:bg-[color:color-mix(in_srgb,var(--surface-1)_92%,var(--surface-2)_8%)] hover:text-foreground",
                              )}
                              onClick={() => toggleNavSection(section.label)}
                              type="button"
                            >
                              <span className="min-w-0">
                                <span className="block text-[11px] font-semibold uppercase tracking-[0.1em]">
                                  {section.label}
                                </span>
                              </span>
                              <SectionToggleIcon
                                aria-hidden="true"
                                className="size-3.5 shrink-0 text-current opacity-60"
                                strokeWidth={1.9}
                              />
                            </button>
                          )}

                          {isSectionExpanded ? (
                            <div className="ml-2 space-y-0.5 border-l border-border/70 pl-2.5">
                              {section.items.map((item) => {
                                const active = isActiveNavItem(pathname, item.href);
                                const href = buildNavHref(item.href, workspaceId);
                                const isPending = pendingHref === href;

                                return (
                                  <Link
                                    aria-current={active ? "page" : undefined}
                                    className={cn(
                                      "motion-surface group flex items-center rounded-md border px-2 shadow-none transition-colors",
                                      isMinimalSidebar ? "min-h-7 text-[13.5px]" : "min-h-8 text-[13.5px]",
                                      active
                                        ? "-translate-y-px border-[color:var(--primary-border)] bg-[color:color-mix(in_srgb,var(--surface-1)_76%,var(--surface-selected)_24%)] text-foreground shadow-none"
                                        : isPending
                                          ? "translate-x-0.5 border-transparent text-foreground/74"
                                          : "border-transparent text-muted-foreground/84 hover:border-[color:var(--border-default)] hover:bg-[color:color-mix(in_srgb,var(--surface-1)_92%,var(--surface-2)_8%)] hover:text-foreground",
                                    )}
                                    href={href}
                                    onClick={(event) => {
                                      markPendingNavigation(href, event);
                                      setIsSidebarOpen(false);
                                    }}
                                    onPointerDown={() => warmRoute(href)}
                                    onFocus={() => warmRoute(href)}
                                    onMouseEnter={() => warmRoute(href)}
                                    key={item.href}
                                  >
                                    <span className="inline-flex min-w-0 items-center gap-2">
                                      {isPending && !active ? <span className="size-1 rounded-full bg-current opacity-70" /> : null}
                                      {item.icon ? (
                                        <item.icon
                                          aria-hidden="true"
                                          className="size-3.5 shrink-0 text-current opacity-65"
                                          strokeWidth={1.8}
                                        />
                                      ) : null}
                                      <span className={cn("truncate", active ? "font-semibold" : "font-medium")}>{item.label}</span>
                                    </span>
                                  </Link>
                                );
                              })}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="px-3 py-6">
                    <EmptyState compact description={tr(shellKey("utility.tryBroaderTerm"))} title={tr(shellKey("utility.noPages"))} />
                  </div>
                )}
              </nav>
            </div>
          </aside>

          <main
            aria-busy={pendingHref ? true : undefined}
            className={mainStageClassName}
            data-busy={pendingHref ? "true" : "false"}
            id="main-content"
            tabIndex={-1}
          >
            <div className={contentStackClassName}>
              <header className={cn(headerCardClassName, "motion-enter motion-enter-fast")}>
                <div className={headerContentClassName}>
                  <span
                    ref={inlineTitleMeasureRef}
                    className={cn(
                      "pointer-events-none absolute opacity-0",
                      useCompactHeader ? "text-[1.02rem] sm:text-[1.08rem]" : "text-[1.14rem] sm:text-[1.22rem]",
                    )}
                  >
                    {displayTitle}
                  </span>
                  <div className={headerRowClassName}>
                    <div className="flex min-w-0 items-center gap-3">
                      {localizedReturnContext ? (
                        <Button
                          asChild
                          className={cn(
                            "h-auto rounded-md border border-transparent px-1.5 py-1 font-normal text-muted-foreground shadow-none hover:bg-transparent hover:text-foreground",
                            useCompactHeader && "text-[12px]",
                          )}
                          size="sm"
                          variant="ghost"
                        >
                          <Link href={localizedReturnContext.href}>
                            <ChevronLeft className="size-3.5" />
                            <span className="hidden sm:inline">{localizedReturnContext.ctaLabel}</span>
                          </Link>
                        </Button>
                      ) : null}

                      <div className="flex min-w-0 items-center">
                        <motion.div
                          animate={{
                            opacity: (isScrolled && inlineTitleSlotWidth) ? 1 : 0,
                            width: isScrolled ? inlineTitleSlotWidth : 0,
                            marginRight: (isScrolled && inlineTitleSlotWidth) ? 8 : 0,
                          }}
                          className="min-w-0 overflow-hidden"
                          initial={false}
                          transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
                        >
                          <motion.h1
                            animate={{
                              opacity: isScrolled ? 1 : 0,
                              scale: isScrolled ? 1 : 0.88,
                              y: isScrolled ? 0 : 10,
                            }}
                            className={cn(
                              "truncate font-semibold tracking-[-0.03em] text-foreground",
                              useCompactHeader ? "text-[1.02rem] sm:text-[1.08rem]" : "text-[1.14rem] sm:text-[1.22rem]",
                            )}
                            initial={false}
                            style={{ originX: 0, originY: 0.5 }}
                            transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
                          >
                            {displayTitle}
                          </motion.h1>
                        </motion.div>
                        {workspaceContextOptions.length ? (
                          <motion.div
                            animate={{ opacity: 1 }}
                            className="flex min-w-0 items-center"
                            initial={false}
                            transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
                          >
                            <motion.div
                              animate={{ 
                                opacity: isScrolled ? 1 : 0,
                                width: isScrolled ? 1 : 0,
                                marginRight: isScrolled ? 8 : 0 
                              }}
                              className="hidden h-4 bg-border/40 sm:block overflow-hidden"
                              initial={false}
                              transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
                            />
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  className={cn(
                                    workspaceTriggerClassName,
                                    "h-8 border-[color:var(--border-default)] bg-[color:color-mix(in_srgb,var(--surface-1)_94%,var(--surface-canvas)_6%)]",
                                  )}
                                  size="sm"
                                  type="button"
                                  variant="ghost"
                                >
                                  <span aria-hidden="true" className={workspaceIndicatorClassName} />
                                  <span className="max-w-[180px] truncate font-medium text-foreground/88">
                                    {workspaceScopeLabel ?? tr("Workspaces")}
                                  </span>
                                  <ChevronDown className="size-3.5 text-muted-foreground/70" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="start" className="max-h-[22rem] w-[320px] overflow-y-auto">
                                <DropdownMenuLabel>{tr(workspaceId ? "Switch workspace" : "Choose workspace")}</DropdownMenuLabel>
                                {workspaceRecentMenuItems.length ? (
                                  <>
                                    <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                                      {tr("Recent")}
                                    </div>
                                    {workspaceRecentMenuItems.map(renderWorkspaceMenuItem)}
                                    <DropdownMenuSeparator />
                                  </>
                                ) : null}
                                <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                                  {hasWorkspaceDirectory ? tr("Workspaces") : tr("Recent")}
                                </div>
                                {directoryItemsToRender.map(renderWorkspaceMenuItem)}
                                <DropdownMenuSeparator />
                                <DropdownMenuItem asChild>
                                  <Link
                                    href={buildNavHref("/workspaces", null)}
                                    onClick={() => setPendingHref(buildNavHref("/workspaces", null))}
                                    onPointerDown={() => void warmRoute(buildNavHref("/workspaces", null))}
                                    onFocus={() => void warmRoute(buildNavHref("/workspaces", null))}
                                    onMouseEnter={() => void warmRoute(buildNavHref("/workspaces", null))}
                                  >
                                    <ArrowRight className="mr-2 size-4" />
                                    {tr("Workspaces")}
                                  </Link>
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </motion.div>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <div className="hidden items-center gap-1 xl:flex">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              aria-label={`${tr(shellKey("utility.theme"))}: ${quickThemeLabel}`}
                              className={cn(
                                "h-[30px] w-auto gap-1.5 rounded-full border border-[color:var(--border-default)] bg-[color:color-mix(in_srgb,var(--surface-1)_94%,var(--surface-canvas)_6%)] px-2.5 text-[12px] font-medium text-foreground shadow-none hover:bg-[color:color-mix(in_srgb,var(--surface-1)_86%,var(--surface-hover)_14%)]",
                                useCompactHeader && "px-2",
                              )}
                              title={`${tr(shellKey("utility.theme"))}: ${quickThemeLabel}`}
                              type="button"
                              variant="ghost"
                            >
                              <QuickThemeIcon className="size-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-44">
                            <DropdownMenuLabel>{tr(shellKey("utility.theme"))}</DropdownMenuLabel>
                            <DropdownMenuRadioGroup onValueChange={updateThemePreference} value={currentThemeValue}>
                              {shellThemeOptions.map((option) => {
                                const OptionIcon = option.icon;
                                const isActive = currentThemeValue === option.value;

                                return (
                                  <DropdownMenuRadioItem className="gap-2 py-1.5" key={`desktop-theme-${option.value}`} value={option.value}>
                                    <OptionIcon className="size-3.5" />
                                    <div className="grid flex-1 gap-0.5">
                                      <span className="text-[12.5px]">{tr(option.label)}</span>
                                    </div>
                                    <Check
                                      className={cn("size-3.5 text-[var(--primary-strong)] opacity-0 transition-opacity", isActive && "opacity-100")}
                                    />
                                  </DropdownMenuRadioItem>
                                );
                              })}
                            </DropdownMenuRadioGroup>
                          </DropdownMenuContent>
                        </DropdownMenu>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              className={cn(headerIconButtonClassName, "h-[30px] w-auto gap-1.5 px-2 text-[12.5px]")}
                              type="button"
                              variant="ghost"
                            >
                              <Languages className="size-3.5" />
                              <span className="text-[11px] text-muted-foreground/72">
                                {isPending ? tr("…") : activeLocaleOption?.shortLabel ?? locale}
                              </span>
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-56">
                            {renderLanguageOptions()}
                          </DropdownMenuContent>
                        </DropdownMenu>
                        <Button
                          aria-label={tr(shellKey("commandPalette.placeholder"))}
                          className={cn(headerIconButtonClassName, "h-[30px] w-auto px-2")}
                          onClick={() => setIsCommandPaletteOpen(true)}
                          size="icon"
                          type="button"
                          variant="ghost"
                        >
                          <Command className="size-3.5" />
                        </Button>
                      </div>
                      <IdentitySwitcher
                        currentPathname={pathname}
                        currentWorkspaceId={workspaceId}
                        isError={shellSession.isError}
                        isLoading={shellSession.isLoading}
                        shellSession={shellSession.session}
                      />
                      <AppShellUserMenu
                        authStatus={authStatus}
                        currentHref={currentRouteHref}
                        isError={shellSession.isError}
                        isLoading={shellSession.isLoading}
                        user={shellSession.session?.auth.user ?? null}
                      />
                    </div>
                  </div>

                  <motion.div
                    animate={{
                      height: isScrolled ? 0 : "auto",
                      marginTop: isScrolled ? 0 : 8,
                      opacity: isScrolled ? 0 : 1,
                    }}
                    className="space-y-1.5 overflow-hidden"
                    initial={false}
                    transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                  >
                    <motion.h1
                      animate={{
                        opacity: isScrolled ? 0 : 1,
                        scale: isScrolled ? 0.94 : 1,
                        y: isScrolled ? -10 : 0,
                      }}
                      className={cn(
                        "text-balance font-semibold tracking-[-0.03em] text-foreground",
                        useCompactHeader ? "text-[1.34rem] sm:text-[1.46rem]" : "text-[1.56rem] sm:text-[1.72rem]",
                      )}
                      initial={false}
                      style={{ originX: 0, originY: 0 }}
                      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                    >
                      {displayTitle}
                    </motion.h1>
                    {currentSurfaceDescription ? (
                      <motion.p
                        animate={{ opacity: isScrolled ? 0 : 1, y: isScrolled ? -6 : 0 }}
                        className="truncate text-[13px] text-muted-foreground/90"
                        initial={false}
                        transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                      >
                        {currentSurfaceDescription}
                      </motion.p>
                    ) : null}
                  </motion.div>
                </div>
              </header>

        {shouldShowOperatorContext ? (
          <nav
            aria-label={tr(shellKey("utility.operatorContext"))}
            className="motion-enter motion-enter-fast motion-delay-1 hidden flex-wrap items-center gap-x-5 gap-y-2 border-t border-border/60 pt-3 sm:flex"
          >
            {visibleOperatorContextCards.map((card) => (
              <Link
                className="group inline-flex min-w-0 items-center gap-1 text-[12px] text-muted-foreground transition-colors hover:text-foreground focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
                href={card.href}
                key={`${card.eyebrow}-${card.title}-${card.href}`}
              >
                <span className="text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/68">{card.eyebrow}</span>
                <span className="truncate font-medium text-foreground/88">{card.title}</span>
                {card.meta ? <span className="hidden text-[10px] text-muted-foreground/70 sm:inline">{card.meta}</span> : null}
              </Link>
            ))}
          </nav>
        ) : null}

              <div className="shell-route-swap space-y-3" key={isRouteTransitionPending ? `pending-${pendingHref}` : currentHref}>
                {shouldShowWorkspaceIdentityNotice ? (
                  <ResourceInlineNotice
                    className="rounded-2xl border-border/60 bg-surface-1/90 text-foreground"
                    actions={workspaceIdentityNoticeActions}
                    label={
                      workspaceIdentityState.status === "failed"
                        ? shellTr("workspaceContextFailedLabel")
                        : shellTr("workspaceContextSyncingLabel")
                    }
                    message={
                      workspaceIdentityState.status === "failed"
                        ? shellTr(
                            workspaceIdentityState.failureReason === "timeout"
                              ? "workspaceContextFailedTimeout"
                              : "workspaceContextFailed",
                          )
                        : shellTr("workspaceContextSyncing")
                    }
                    tone={workspaceIdentityState.status === "failed" ? "warning" : "success"}
                  />
                ) : null}
                {isRouteTransitionPending ? (
                  <AppShellRouteTransitionSkeleton
                    description={
                      pendingNavigationWorkspaceId && pendingNavigationWorkspaceId !== workspaceId
                        ? tr("Switching workspace")
                        : pendingNavigationDescriptor?.section?.label
                          ? tr(pendingNavigationDescriptor.section.label)
                          : tr("Opening page")
                    }
                    title={displayTitle}
                  />
                ) : (
                  children
                )}
              </div>

              {effectiveShowSupportPanels && !isFocusMode && (visibleWorkflowShortcuts.length || visibleSurfaceMemoryItems.length || workspaceId) ? (
                <AppShellSupportPanels
                  currentHref={currentHref}
                  currentPageLabel={currentPageLabel}
                  nextActionLabel={localizedTaskZoneItems[0]?.label ?? tr(shellKey("utility.nextAction"))}
                  surfaceMemoryItems={visibleSurfaceMemoryItems}
                  workflowShortcuts={visibleWorkflowShortcuts}
                  workspaceId={workspaceId}
                  workspaceScopeLabel={workspaceScopeLabel}
                />
              ) : null}
            </div>
          </main>
        </div>
      </div>

      {isCommandPaletteOpen ? (
        <AppShellCommandPalette
          allowAutoFocus={allowPaletteAutoFocus}
          emptyLabel={tr(shellKey("commandPalette.noResults"))}
          filterLabel={tr(shellKey("commandPalette.filter"))}
          footerActions={[
            `⌘K ${tr(shellKey("commandPalette.jump"))}`,
            `⌘⇧S ${tr(shellKey("commandPalette.save"))}`,
            `⌘. ${tr(shellKey("commandPalette.focus"))}`,
          ]}
          groupedItems={groupedPaletteItems}
          onOpenChange={setIsCommandPaletteOpen}
          onSelectItem={(item) => {
            if (item.action) {
              setIsCommandPaletteOpen(false);
              item.action();
              return;
            }

            setIsCommandPaletteOpen(false);
            navigateToHref(item.href);
          }}
          open={isCommandPaletteOpen}
          placeholder={tr(shellKey("commandPalette.placeholder"))}
          query={paletteQuery}
          queryActionLabel={tr(shellKey("commandPalette.go"))}
          queryRunLabel={tr(shellKey("commandPalette.run"))}
          setQuery={setPaletteQuery}
        />
      ) : null}
    </>
  );
}
