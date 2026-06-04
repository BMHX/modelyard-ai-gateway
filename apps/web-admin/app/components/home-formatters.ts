import type { AppLocale } from "../lib/i18n";

function getIntlLocale(locale: AppLocale) {
  return locale === "zh" ? "zh-CN" : "en-US";
}

export function formatUsd(amount: number, locale: AppLocale) {
  const formatted = new Intl.NumberFormat(getIntlLocale(locale), {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);

  return locale === "zh" ? formatted.replace(/^US\$/, "美元 ") : formatted;
}

export function formatInteger(value: number, locale: AppLocale) {
  return new Intl.NumberFormat(getIntlLocale(locale)).format(value);
}
