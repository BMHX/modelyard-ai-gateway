import {messageCatalog} from "@/app/messages";

const localePrefixPattern = /^\/(en|zh)(?=\/|$)/i;

import {translateZhInlineText} from "./i18n/zh-CN";

const allowedEnglishTermsInChineseUi = new Set([
  "BYOK",
  "Claude Code",
  "OpenAI",
  "Anthropic",
  "Gateway",
  "Control Plane",
]);

const warnedInlineTranslationFallbacks = new Set<string>();

export const localeCookieName = "teamops-admin-locale";
export const localeSyncStorageKey = "teamops:locale-sync";
export const supportedLocales = ["en", "zh"] as const;
export type AppLocale = (typeof supportedLocales)[number];
export const defaultLocale: AppLocale = "en";

export const localeOptions = [
  {
    value: "en",
    label: "English",
    shortLabel: "EN",
  },
  {
    value: "zh",
    label: "中文",
    shortLabel: "中文",
  },
] as const satisfies ReadonlyArray<{
  value: AppLocale;
  label: string;
  shortLabel: string;
}>;

export const translationNamespaces = [
  "alerts",
  "audit",
  "budgets",
  "errors",
  "exports",
  "home",
  "layout",
  "login",
  "members",
  "organizations",
  "projects",
  "providers",
  "shared",
  "shell",
  "usage",
  "virtualKeys",
  "workspaces",
] as const;
export type MessageNamespace = (typeof translationNamespaces)[number];
export type AppMessages = (typeof messageCatalog)[AppLocale];

export function isSupportedLocale(value: string): value is AppLocale {
  return supportedLocales.includes(value as AppLocale);
}

export function normalizeLocale(value?: string | null): AppLocale {
  if (!value) {
    return defaultLocale;
  }

  if (isSupportedLocale(value)) {
    return value;
  }

  if (value.toLowerCase().startsWith("zh")) {
    return "zh";
  }

  return defaultLocale;
}

export function translateInlineText(locale: AppLocale, text: string): string {
  if (!text) {
    return text;
  }

  if (locale === "zh" && process.env.NODE_ENV !== "production" && !allowedEnglishTermsInChineseUi.has(text.trim())) {
    const normalizedText = text.replace(/\s+/g, " ").trim();
    if (normalizedText) {
      const warningKey = `${locale}:${normalizedText}`;
      if (!warnedInlineTranslationFallbacks.has(warningKey)) {
        warnedInlineTranslationFallbacks.add(warningKey);
        console.warn(
          `[i18n] translateInlineText fallback hit for "${normalizedText}". Move this copy into apps/web-admin/app/messages/en and zh.`,
        );
      }
    }
  }

  if (locale === "zh") {
    return translateZhInlineText(text);
  }

  return text;
}

export function isLikelyMessageKey(value: string) {
  return /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/.test(value);
}

export function resolveMessageKey(namespace: string | undefined, key: string) {
  if (!isLikelyMessageKey(key)) {
    return null;
  }

  if (!namespace) {
    return key;
  }

  return key.startsWith(`${namespace}.`) ? key : `${namespace}.${key}`;
}

export async function loadMessages(
  locale: AppLocale,
  namespaces?: readonly MessageNamespace[],
) {
  const catalog = messageCatalog[locale];

  if (!namespaces || namespaces.length === 0) {
    return catalog;
  }

  const selected: Partial<Record<MessageNamespace, AppMessages[MessageNamespace]>> = {};

  for (const namespace of namespaces) {
    selected[namespace] = catalog[namespace];
  }

  return selected;
}


export function stripLocalePrefix(pathname: string) {
  if (!pathname) return pathname;
  const normalized = pathname.replace(localePrefixPattern, "") || "/";
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

export function localizeHref(href: string, locale: AppLocale) {
  if (!href) return href;
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(href)) return href;
  const [pathWithQuery, hash = ""] = href.split("#");
  const normalizedPath = stripLocalePrefix(pathWithQuery || "/");
  const localizedPath = locale === "zh" ? (normalizedPath === "/" ? "/zh" : `/zh${normalizedPath}`) : normalizedPath;
  return hash ? `${localizedPath}#${hash}` : localizedPath;
}

export function getPathLocale(pathname: string | null | undefined): AppLocale {
  if (!pathname) {
    return "en";
  }

  const matchedLocale = pathname.match(localePrefixPattern)?.[1]?.toLowerCase();
  return matchedLocale === "zh" ? "zh" : "en";
}

export function resolveClientLocale(args: {
  pathname?: string | null;
  cookieLocale?: string | null;
  documentLocale?: string | null;
} = {}): AppLocale {
  const { pathname, cookieLocale, documentLocale } = args;

  if (pathname) {
    const matchedLocale = pathname.match(localePrefixPattern)?.[1]?.toLowerCase();
    if (matchedLocale === "zh") {
      return "zh";
    }
    if (matchedLocale === "en") {
      return "en";
    }
  }

  if (cookieLocale) {
    return normalizeLocale(cookieLocale);
  }

  if (documentLocale) {
    return normalizeLocale(documentLocale);
  }

  return defaultLocale;
}

export function getMessagesForLocale(locale: AppLocale) {
  return messageCatalog[locale];
}

function interpolateMessageTemplate(
  template: string,
  values?: Record<string, string | number | boolean | Date | null | undefined>,
) {
  if (!values) {
    return template;
  }

  return template.replace(/\{(\w+)\}/g, (_, token) => String(values[token] ?? `{${token}}`));
}

export function createAppTranslator(locale: AppLocale) {
  const messages = getMessagesForLocale(locale) as Record<string, unknown>;
  const translator = ((key: string, values?: Record<string, string | number | boolean | Date | null | undefined>) => {
    const template = resolveInlineMessageTemplate(messages, key);
    return template ? interpolateMessageTemplate(template, values) : key;
  }) as {
    (key: string, values?: Record<string, string | number | boolean | Date | null | undefined>): string;
    has: (key: string) => boolean;
  };

  translator.has = (key: string) => resolveInlineMessageTemplate(messages, key) !== null;

  return translator;
}

export function translateMessageTemplate(
  locale: AppLocale,
  namespace: MessageNamespace,
  key: string,
  values?: Record<string, string | number | boolean | Date | null | undefined>,
) {
  const messageKey = resolveMessageKey(namespace, key);

  let template: string | null = null;

  const messages = getMessagesForLocale(locale);
  const namespaceMessages = (messages as any)[namespace] as Record<string, unknown>;
  if (namespaceMessages) {
    template = resolveInlineMessageTemplate(namespaceMessages, key);
  } else if (messageKey) {
    template = resolveInlineMessageTemplate(messages as Record<string, unknown>, messageKey);
  }

  if (!template) {
    template = translateInlineText(locale, key);
  }

  if (!values || !template) {
    return template || key;
  }

  return interpolateMessageTemplate(template, values);
}

export function resolveInlineMessageTemplate(
  messages: Record<string, unknown>,
  key: string,
): string | null {
  const exact = messages[key];
  if (typeof exact === "string") return exact;

  const nested = key.split(".").reduce<unknown>(
    (current, part) =>
      current && typeof current === "object" && part in (current as Record<string, unknown>)
        ? (current as Record<string, unknown>)[part]
        : null,
    messages,
  );

  if (typeof nested === "string") return nested;

  if (
    nested &&
    typeof nested === "object" &&
    "" in nested &&
    typeof (nested as Record<string, unknown>)[""] === "string"
  ) {
    return (nested as Record<string, string>)[""];
  }

  return null;
}
