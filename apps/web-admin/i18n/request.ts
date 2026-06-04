import {cookies} from "next/headers";
import {getRequestConfig} from "next-intl/server";

import {localeCookieName, normalizeLocale} from "@/app/lib/i18n";

export default getRequestConfig(async ({requestLocale}) => {
  const cookieStore = await cookies();
  const requestedLocale = await requestLocale;
  const locale = normalizeLocale(requestedLocale ?? cookieStore.get(localeCookieName)?.value);

  return {
    locale,
    messages: {},
    timeZone: "UTC",
  };
});
