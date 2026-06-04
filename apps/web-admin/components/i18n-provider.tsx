"use client";

import type {ReactNode} from "react";

import {LocalePreferenceProvider, localeOptions, useLocalePreference, useT} from "@/app/lib/i18n-client";

type I18nContextValue = {
  locale: ReturnType<typeof useLocalePreference>["locale"];
  setLocale: ReturnType<typeof useLocalePreference>["setLocale"];
  tr: ReturnType<typeof useT>;
  isPending: ReturnType<typeof useLocalePreference>["isPending"];
  pendingLocale: ReturnType<typeof useLocalePreference>["pendingLocale"];
};

export {localeOptions};

export function I18nProvider({children}: {children: ReactNode}) {
  return <LocalePreferenceProvider>{children}</LocalePreferenceProvider>;
}

export function useI18n(): I18nContextValue {
  const {locale, setLocale, isPending, pendingLocale} = useLocalePreference();
  const tr = useT();

  return {
    locale,
    setLocale,
    tr,
    isPending,
    pendingLocale,
  };
}
