export const controlPlaneSessionCookieName = "teamops_cp_session";

export type WebAdminAuthMode = "session" | "bootstrap_admin" | "bootstrap_member_email";

export function getWebAdminAuthMode(): WebAdminAuthMode {
  const configuredMode = process.env.WEB_ADMIN_AUTH_MODE?.trim();
  if (
    configuredMode === "bootstrap_admin" ||
    configuredMode === "bootstrap_member_email" ||
    configuredMode === "session"
  ) {
    return configuredMode;
  }

  if (process.env.NODE_ENV !== "production") {
    if (process.env.CONTROL_API_MEMBER_EMAIL?.trim()) {
      return "bootstrap_member_email";
    }

    if (process.env.CONTROL_API_ADMIN_TOKEN?.trim()) {
      return "bootstrap_admin";
    }
  }

  return "session";
}

export function isSessionAuthMode() {
  return getWebAdminAuthMode() === "session";
}
