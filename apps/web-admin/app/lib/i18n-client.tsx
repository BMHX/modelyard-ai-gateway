"use client";

import {createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode} from "react";
import {usePathname as useBrowserPathname} from "next/navigation";

import {
  getMessagesForLocale,
  isLikelyMessageKey,
  localizeHref,
  localeCookieName,
  localeOptions,
  normalizeLocale,
  resolveClientLocale,
  resolveInlineMessageTemplate,
  resolveMessageKey,
  translateInlineText,
  type AppLocale,
} from "./i18n";

type TranslationValues = Record<string, string | number | boolean | Date | null | undefined>;

type LocalePreferenceContextValue = {
  locale: AppLocale;
  setLocale: (locale: AppLocale) => void;
  isPending: boolean;
  pendingLocale: AppLocale | null;
};

const LocalePreferenceContext = createContext<LocalePreferenceContextValue | null>(null);

function readLocaleCookie() {
  if (typeof document === "undefined") {
    return null;
  }

  const match = document.cookie.match(
    new RegExp(`(?:^|; )${localeCookieName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=([^;]*)`),
  );
  return match ? decodeURIComponent(match[1]) : null;
}

function getCurrentClientLocale(pathname?: string | null) {
  return resolveClientLocale({
    pathname,
    cookieLocale: readLocaleCookie(),
    documentLocale: typeof document === "undefined" ? null : document.documentElement.lang,
  });
}

export function LocalePreferenceProvider({children}: {children: ReactNode}) {
  const browserPathname = useBrowserPathname();
  const locale = getCurrentClientLocale(browserPathname);
  const [pendingLocale, setPendingLocale] = useState<AppLocale | null>(null);

  useEffect(() => {
    document.documentElement.lang = locale;
    if (pendingLocale === locale) {
      setPendingLocale(null);
    }
  }, [locale, pendingLocale]);

  const setLocale = useCallback((nextLocale: AppLocale) => {
    const normalizedLocale = normalizeLocale(nextLocale);
    if (normalizedLocale === locale || normalizedLocale === pendingLocale) {
      return;
    }

    if (typeof window === "undefined") {
      return;
    }

    const currentHref = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const targetHref = localizeHref(currentHref, normalizedLocale);

    setPendingLocale(normalizedLocale);
    document.cookie = `${localeCookieName}=${normalizedLocale}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    window.location.replace(targetHref);
  }, [locale, pendingLocale]);

  const value = useMemo<LocalePreferenceContextValue>(() => ({
    locale,
    setLocale,
    isPending: pendingLocale !== null,
    pendingLocale,
  }), [locale, pendingLocale, setLocale]);

  return <LocalePreferenceContext.Provider value={value}>{children}</LocalePreferenceContext.Provider>;
}

export function useLocalePreference() {
  const context = useContext(LocalePreferenceContext);
  if (!context) throw new Error("useLocalePreference must be used within LocalePreferenceProvider.");
  return context;
}

export function useT(namespace?: string) {
  const locale = getCurrentClientLocale(useBrowserPathname());
  const messages = useMemo(() => getMessagesForLocale(locale) as Record<string, unknown>, [locale]);

  return useCallback((key: string, values?: TranslationValues) => {
    const messageKey = resolveMessageKey(namespace, key);
    if (messageKey) {
      const namespaceMessages =
        namespace && typeof messages[namespace] === "object" && messages[namespace]
          ? (messages[namespace] as Record<string, unknown>)
          : null;
      const template =
        namespaceMessages ? resolveInlineMessageTemplate(namespaceMessages, key) : resolveInlineMessageTemplate(messages, messageKey);

      if (template) {
        return values ? template.replace(/\{(\w+)\}/g, (_, token) => String(values[token] ?? `{${token}}`)) : template;
      }
    }
    if (isLikelyMessageKey(key) && key.includes(".")) return key;
    return translateInlineText(locale, key);
  }, [locale, messages, namespace]);
}

export function usePathLocale() {
  const pathname = typeof window === "undefined" ? null : window.location.pathname;
  return getCurrentClientLocale(pathname);
}

export {localeOptions};
