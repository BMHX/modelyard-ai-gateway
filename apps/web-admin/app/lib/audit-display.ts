import { translateInlineText, type AppLocale } from "./i18n";

const actorDisplayNameMap = {
  "web-admin": {
    en: "Admin Console",
    zh: "管理后台",
  },
} as const;

export function formatAuditActorLabel(actorId: string, locale: AppLocale) {
  const mapped = actorDisplayNameMap[actorId as keyof typeof actorDisplayNameMap];
  if (mapped) {
    return mapped[locale];
  }

  return translateInlineText(locale, actorId);
}
