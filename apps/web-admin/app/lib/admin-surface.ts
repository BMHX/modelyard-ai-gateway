import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { EMPTY_CAPABILITIES, getCapabilitiesFromPermissions } from "./capabilities";
import { getWorkspaceHomeOverview, loadWorkspaceSelection } from "./control-api";
import { normalizeWorkspacePreferenceValue, workspacePreferenceCookieName } from "./workspace-preference";

export function getPreferredWorkspaceIdFromCookieHeader(cookieHeader: string | null | undefined) {
  if (!cookieHeader) {
    return null;
  }

  const match = cookieHeader.match(
    new RegExp(`(?:^|;\\s*)${workspacePreferenceCookieName}=([^;]+)`),
  );

  if (!match?.[1]) {
    return null;
  }

  try {
    return normalizeWorkspacePreferenceValue(decodeURIComponent(match[1]));
  } catch {
    return normalizeWorkspacePreferenceValue(match[1]);
  }
}

export function buildAdminSurfaceFallbackHref(workspaceId: string | null) {
  if (!workspaceId) {
    return "/";
  }

  return `/?workspaceId=${encodeURIComponent(workspaceId)}`;
}

async function loadSurfaceCapabilities(workspaceId: string | null) {
  if (!workspaceId) {
    return EMPTY_CAPABILITIES;
  }

  try {
    const overview = await getWorkspaceHomeOverview(workspaceId);
    return getCapabilitiesFromPermissions(overview.permissions);
  } catch {
    return EMPTY_CAPABILITIES;
  }
}

export async function resolveAdminSurfaceAccess(args?: {
  requestedWorkspaceId?: string | null;
  preferredWorkspaceId?: string | null;
}) {
  const normalizedRequestedWorkspaceId = normalizeWorkspacePreferenceValue(args?.requestedWorkspaceId);
  const normalizedPreferredWorkspaceId = normalizeWorkspacePreferenceValue(args?.preferredWorkspaceId);
  const workspaceSelection = await loadWorkspaceSelection(
    normalizedRequestedWorkspaceId ?? normalizedPreferredWorkspaceId,
  );
  const capabilities = await loadSurfaceCapabilities(workspaceSelection.selectedWorkspaceId);

  return {
    workspaceSelection,
    capabilities,
    fallbackHref: buildAdminSurfaceFallbackHref(workspaceSelection.selectedWorkspaceId),
  };
}

export async function requireAdminSurfaceAccess(args?: {
  requestedWorkspaceId?: string | null;
}) {
  const cookieStore = await cookies();
  const preferredWorkspaceId = normalizeWorkspacePreferenceValue(
    cookieStore.get(workspacePreferenceCookieName)?.value,
  );
  const access = await resolveAdminSurfaceAccess({
    requestedWorkspaceId: args?.requestedWorkspaceId,
    preferredWorkspaceId,
  });

  if (!access.capabilities.canAccessAdminSurfaces) {
    redirect(access.fallbackHref);
  }

  return access;
}
