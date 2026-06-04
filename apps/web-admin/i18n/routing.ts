import {defineRouting} from "next-intl/routing";

import {localeCookieName} from "@/app/lib/i18n";

export const routing = defineRouting({
  locales: ["en", "zh"],
  defaultLocale: "en",
  localePrefix: "as-needed",
  localeCookie: {
    name: localeCookieName,
    sameSite: "lax",
  },
});
