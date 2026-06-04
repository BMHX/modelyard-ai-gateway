import type { Capabilities } from "./capabilities";
import { stripLocalePrefix } from "./i18n";

function normalizeRoutePathname(pathname: string) {
  return stripLocalePrefix(pathname) || "/";
}

function matchesRoute(pathname: string, route: string) {
  return pathname === route || pathname.startsWith(`${route}/`);
}

export function canAccessConsoleRoute(pathname: string, capabilities: Capabilities) {
  const normalizedPathname = normalizeRoutePathname(pathname);

  if (normalizedPathname === "/" || normalizedPathname === "/workspaces") {
    return true;
  }

  if (
    matchesRoute(normalizedPathname, "/organizations") ||
    matchesRoute(normalizedPathname, "/providers")
  ) {
    return capabilities.canAccessAdminSurfaces;
  }

  if (matchesRoute(normalizedPathname, "/members")) {
    return capabilities.canManageMembers;
  }

  if (matchesRoute(normalizedPathname, "/projects")) {
    return capabilities.canManageProjects;
  }

  if (matchesRoute(normalizedPathname, "/virtual-keys") || matchesRoute(normalizedPathname, "/access")) {
    return capabilities.canAccessDeveloperTools;
  }

  if (matchesRoute(normalizedPathname, "/usage-events")) {
    return capabilities.canViewUsage;
  }

  if (
    matchesRoute(normalizedPathname, "/budgets") ||
    matchesRoute(normalizedPathname, "/alerts") ||
    matchesRoute(normalizedPathname, "/audit-logs") ||
    matchesRoute(normalizedPathname, "/exports")
  ) {
    return capabilities.canManageGovernance;
  }

  if (matchesRoute(normalizedPathname, "/prompt-inspections")) {
    return capabilities.canReviewPrompts || capabilities.isAdvancedUser;
  }

  if (matchesRoute(normalizedPathname, "/release-lineage")) {
    return capabilities.canAccessAdminSurfaces;
  }

  return true;
}
