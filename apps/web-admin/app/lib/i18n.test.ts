import assert from "node:assert/strict";
import test from "node:test";

import { createAppTranslator, getPathLocale, localizeHref, resolveClientLocale, translateInlineText } from "./i18n";

test("createAppTranslator returns English messages for default-locale routes", () => {
  const t = createAppTranslator("en");

  assert.equal(t("providers.title"), "Providers");
  assert.equal(t("shell.currentLanguage"), "Current language");
});

test("createAppTranslator returns Chinese messages for zh-prefixed routes", () => {
  const t = createAppTranslator("zh");

  assert.equal(t("providers.title"), "供应商");
  assert.equal(t("shell.currentLanguage"), "当前语言");
});

test("getPathLocale follows the locale prefix instead of cached client state", () => {
  assert.equal(getPathLocale("/providers"), "en");
  assert.equal(getPathLocale("/en/providers"), "en");
  assert.equal(getPathLocale("/zh/providers"), "zh");
  assert.equal(getPathLocale("/zh"), "zh");
  assert.equal(getPathLocale(null), "en");
});

test("resolveClientLocale falls back to cookie or document language for unprefixed routes", () => {
  assert.equal(resolveClientLocale({ pathname: "/virtual-keys", cookieLocale: "zh" }), "zh");
  assert.equal(resolveClientLocale({ pathname: "/providers", documentLocale: "zh-CN" }), "zh");
  assert.equal(resolveClientLocale({ pathname: "/zh/virtual-keys", cookieLocale: "en" }), "zh");
  assert.equal(resolveClientLocale({ pathname: "/en/providers", cookieLocale: "zh" }), "en");
  assert.equal(resolveClientLocale({ pathname: "/providers" }), "en");
});

test("localizeHref swaps locale prefixes without changing query or hash", () => {
  assert.equal(localizeHref("/en/providers?view=all#inventory", "en"), "/providers?view=all#inventory");
  assert.equal(localizeHref("/en/providers?view=all#inventory", "zh"), "/zh/providers?view=all#inventory");
  assert.equal(localizeHref("/zh/providers?view=all#inventory", "en"), "/providers?view=all#inventory");
  assert.equal(localizeHref("/providers?view=all#inventory", "zh"), "/zh/providers?view=all#inventory");
});

test("translateInlineText normalizes legacy zh scope labels", () => {
  assert.equal(translateInlineText("zh", "environment / 开发 (development)"), "环境 / 开发");
  assert.equal(translateInlineText("zh", "environment / shadow (staging)"), "环境 / shadow (预发)");
  assert.equal(translateInlineText("zh", "project / Core API"), "项目 / Core API");
});
