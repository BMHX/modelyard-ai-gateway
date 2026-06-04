export const workspacePreferenceCookieName = "teamops_last_workspace";
export const workspacePreferenceMaxAgeSeconds = 60 * 60 * 24 * 30;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeWorkspacePreferenceValue(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function isWorkspacePreferenceValueUuid(value?: string | null) {
  const normalized = normalizeWorkspacePreferenceValue(value);
  return normalized !== null && uuidPattern.test(normalized);
}

export function readWorkspacePreferenceFromCookieString(cookieHeader?: string | null) {
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
