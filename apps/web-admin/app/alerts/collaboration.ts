import type { Alert } from "@teamops/contracts";

import type { AlertCollaborationState } from "../components/alert-collaboration-panel";
import type { AppLocale } from "../lib/i18n";
import { translateInlineText } from "../lib/i18n";
import enAlertsMessages from "../messages/en/alerts.json";
import zhAlertsMessages from "../messages/zh/alerts.json";
import { buildAlertAuditHref, buildAlertUsageHref, getAlertMetadataString, getAlertScopeInfo } from "./presentation";

type TranslationValues = Record<string, string | number | undefined>

function formatMessage(template: string, values?: TranslationValues) {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? `{${key}}`));
}

function resolveAlertMessage(messages: Record<string, unknown>, key: string): string | null {
  const exact = messages[key];
  if (typeof exact === "string") return exact;
  if (exact && typeof exact === "object" && "" in exact && typeof (exact as Record<string, unknown>)[""] === "string") {
    return (exact as Record<string, string>)[""];
  }

  const nested = key.split(".").reduce<unknown>((current, part) => {
    if (!current || typeof current !== "object" || !(part in (current as Record<string, unknown>))) {
      return null;
    }
    return (current as Record<string, unknown>)[part];
  }, messages);

  if (typeof nested === "string") return nested;
  if (nested && typeof nested === "object" && "" in nested && typeof (nested as Record<string, unknown>)[""] === "string") {
    return (nested as Record<string, string>)[""];
  }
  return null;
}

function createAlertsTranslator(locale?: AppLocale) {
  const normalized = locale === "zh" ? "zh" : "en";
  const messages = (normalized === "zh" ? zhAlertsMessages : enAlertsMessages) as Record<string, unknown>;
  return (text: string, values?: TranslationValues) => {
    const fallback = typeof values?.default === "string" ? values.default : text;
    const template = resolveAlertMessage(messages, text) ?? translateInlineText(locale ?? "en", fallback);
    return formatMessage(template, values);
  };
}

function getIntlLocale(locale?: AppLocale) {
  return locale === "zh" ? "zh-CN" : "en-US";
}

function formatDateTime(value: string, locale?: AppLocale) {
  return new Intl.DateTimeFormat(getIntlLocale(locale), {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function buildSlaState(
  alert: Pick<Alert, "status">,
  slaDueAt: string | null,
  locale: AppLocale | undefined,
  tr: (text: string, values?: TranslationValues) => string,
) {
  if (!slaDueAt) {
    return {
      label: null,
      tone: null,
    } as const;
  }

  if (alert.status === "resolved") {
    return {
      label: tr("collaboration.sla.closed", { date: formatDateTime(slaDueAt, locale) }),
      tone: "resolved",
    } as const;
  }

  const dueAt = Date.parse(slaDueAt);
  if (!Number.isFinite(dueAt)) {
    return {
      label: null,
      tone: null,
    } as const;
  }

  const remainingMs = dueAt - Date.now();
  if (remainingMs <= 0) {
    return {
      label: tr("collaboration.sla.breached", { date: formatDateTime(slaDueAt, locale) }),
      tone: "critical",
    } as const;
  }

  if (remainingMs <= 4 * 60 * 60 * 1000) {
    return {
      label: tr("collaboration.sla.dueSoon", { date: formatDateTime(slaDueAt, locale) }),
      tone: "warning",
    } as const;
  }

  return {
    label: tr("collaboration.sla.due", { date: formatDateTime(slaDueAt, locale) }),
    tone: null,
  } as const;
}

export function getAlertAckState(alert: Pick<Alert, "status" | "severity">): AlertCollaborationState["ackState"] {
  if (alert.status === "resolved") {
    return "resolved";
  }

  if (alert.severity === "critical") {
    return "needs-ack";
  }

  return "acknowledged";
}

export function getAlertPlaceholderOwner(scopeInfo: ReturnType<typeof getAlertScopeInfo>, locale?: AppLocale) {
  const tr = createAlertsTranslator(locale);
  const environmentName = scopeInfo.environmentName ? translateInlineText(locale ?? "en", scopeInfo.environmentName) : null;
  const projectName = scopeInfo.projectName ? translateInlineText(locale ?? "en", scopeInfo.projectName) : null;

  if (scopeInfo.scopeKind === "environment") {
    return environmentName
      ? tr("collaboration.owner.environment", { name: environmentName })
      : tr("collaboration.owner.environmentFallback");
  }

  if (scopeInfo.scopeKind === "project") {
    return projectName
      ? tr("collaboration.owner.project", { name: projectName })
      : tr("collaboration.owner.projectFallback");
  }

  return tr("collaboration.owner.workspaceFallback");
}

export function getAlertPlaceholderNoteCount(alert: Pick<Alert, "status" | "severity">) {
  if (alert.status === "resolved") {
    return 3;
  }

  if (alert.severity === "critical") {
    return 2;
  }

  return alert.severity === "warning" ? 1 : 0;
}

export function buildAlertCollaborationState(args: {
  alert: Alert;
  scopeInfo: ReturnType<typeof getAlertScopeInfo>;
  returnTo: string;
  locale?: AppLocale;
}): AlertCollaborationState {
  const tr = createAlertsTranslator(args.locale);
  const metadata =
    args.alert.metadata && typeof args.alert.metadata === "object" && !Array.isArray(args.alert.metadata) ?
      (args.alert.metadata as Record<string, unknown>)
    : {};
  const persistedAckState = getAlertMetadataString(metadata, "collaborationAckState");
  const persistedOwnerLabel = getAlertMetadataString(metadata, "collaborationOwnerLabel");
  const persistedNote = getAlertMetadataString(metadata, "collaborationNote");
  const persistedRunbookHref = getAlertMetadataString(metadata, "collaborationRunbookHref");
  const persistedRunbookLabel = getAlertMetadataString(metadata, "collaborationRunbookLabel");
  const persistedTicketHref = getAlertMetadataString(metadata, "collaborationTicketHref");
  const persistedTicketLabel = getAlertMetadataString(metadata, "collaborationTicketLabel");
  const persistedSlaDueAt = getAlertMetadataString(metadata, "collaborationSlaDueAt");
  const persistedUpdatedAt = getAlertMetadataString(metadata, "collaborationUpdatedAt");
  const slaState = buildSlaState(args.alert, persistedSlaDueAt, args.locale, tr);

  return {
    alertId: args.alert.id,
    ownerLabel: persistedOwnerLabel ?? getAlertPlaceholderOwner(args.scopeInfo, args.locale),
    ownerHint: args.scopeInfo.label,
    ackState:
      persistedAckState === "needs-ack" || persistedAckState === "acknowledged" || persistedAckState === "resolved" ?
        persistedAckState
      : getAlertAckState(args.alert),
    slaLabel: slaState.label,
    slaTone: slaState.tone,
    noteCount: persistedNote ? 1 : getAlertPlaceholderNoteCount(args.alert),
    latestNote: persistedNote,
    runbookHref: persistedRunbookHref ?? buildAlertUsageHref(args.alert, args.returnTo),
    runbookLabel: persistedRunbookLabel ?? tr("collaboration.runbook.default"),
    ticketHref: persistedTicketHref ?? buildAlertAuditHref(args.alert, args.returnTo),
    ticketLabel: persistedTicketLabel ?? tr("collaboration.ticket.default"),
    lastUpdatedLabel:
      persistedUpdatedAt ? tr("collaboration.updated", { date: formatDateTime(persistedUpdatedAt, args.locale) })
      : args.alert.resolvedAt ?
          tr("collaboration.resolved", { date: formatDateTime(args.alert.resolvedAt, args.locale) })
        : tr("collaboration.opened", { date: formatDateTime(args.alert.createdAt, args.locale) }),
  };
}
