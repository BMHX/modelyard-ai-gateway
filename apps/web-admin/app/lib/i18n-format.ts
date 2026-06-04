import type {AppLocale} from "./i18n";

export function getIntlLocale(locale: AppLocale) {
  return locale === "zh" ? "zh-CN" : "en-US";
}

export function getIntlDateTimeLocale(locale?: string | null) {
  if (locale?.toLowerCase().startsWith("zh")) {
    return "zh-CN";
  }

  if (locale?.toLowerCase().startsWith("en")) {
    return "en-US";
  }

  return locale || "en-US";
}

export function formatNumber(value: number, locale: AppLocale, options?: Intl.NumberFormatOptions) {
  return new Intl.NumberFormat(getIntlLocale(locale), options).format(value);
}

export function formatCurrency(
  value: number,
  locale: AppLocale,
  options?: Omit<Intl.NumberFormatOptions, "currency" | "style">,
) {
  const formatted = formatNumber(value, locale, {
    style: "currency",
    currency: "USD",
    ...options,
  });

  return locale === "zh" ? formatted.replace(/^US\$/, "美元 ") : formatted;
}

export function formatDate(
  value: string | number | Date,
  locale: AppLocale,
  options?: Intl.DateTimeFormatOptions,
) {
  return new Intl.DateTimeFormat(getIntlLocale(locale), options).format(new Date(value));
}

export function formatDateTime(
  value: string | number | Date,
  locale: AppLocale,
  options?: Intl.DateTimeFormatOptions,
) {
  return formatDate(value, locale, options);
}
