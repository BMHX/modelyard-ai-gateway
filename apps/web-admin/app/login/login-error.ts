import type { AppLocale } from "../lib/i18n";

export function resolveLoginErrorMessage(args: {
  locale: AppLocale;
  errorCode: string;
  errorMessage: string;
}) {
  const { locale, errorCode, errorMessage } = args;

  if (!errorCode) {
    return errorMessage;
  }

  if (locale === "zh") {
    switch (errorCode) {
      case "OIDC_NO_ACTIVE_MEMBERSHIP":
        return "当前账号没有可用的工作区成员身份，无法登录控制台。";
      case "OIDC_MEMBERSHIP_NO_ROLES":
        return "当前账号未分配任何角色，暂无权限登录控制台。";
      default:
        return errorMessage;
    }
  }

  switch (errorCode) {
    case "OIDC_NO_ACTIVE_MEMBERSHIP":
      return "No active workspace membership is available for this account.";
    case "OIDC_MEMBERSHIP_NO_ROLES":
      return "No role is assigned to this account, so console access is blocked.";
    default:
      return errorMessage;
  }
}
