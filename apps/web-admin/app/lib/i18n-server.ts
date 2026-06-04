import {getLocale} from "next-intl/server";

import {isLikelyMessageKey, loadMessages, resolveInlineMessageTemplate, resolveMessageKey, normalizeLocale, translateInlineText, type AppLocale, type MessageNamespace} from "./i18n";

type TranslationValues = Record<string, string | number | boolean | Date | null | undefined>;

export async function getCurrentLocale(): Promise<AppLocale> {
  return normalizeLocale(await getLocale());
}

export async function getT(namespace?: MessageNamespace | string) {
  const locale = await getCurrentLocale();
  const messages = (await loadMessages(locale)) as Record<string, unknown>;

  return (key: string, values?: TranslationValues) => {
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

    if (isLikelyMessageKey(key) && key.includes(".")) {
      return key;
    }

    return translateInlineText(locale, key);
  };
}

export async function getLoadedMessages(namespaces?: readonly MessageNamespace[]) {
  const locale = await getCurrentLocale();
  return loadMessages(locale, namespaces);
}
