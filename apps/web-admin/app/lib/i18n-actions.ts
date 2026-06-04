"use server";

import {cookies} from "next/headers";

import {localeCookieName, normalizeLocale, type AppLocale} from "./i18n";

export async function persistLocalePreference(locale: AppLocale) {
  const normalizedLocale = normalizeLocale(locale);
  const cookieStore = await cookies();
  cookieStore.set(localeCookieName, normalizedLocale, {
    path: "/",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
  });

  return normalizedLocale;
}
