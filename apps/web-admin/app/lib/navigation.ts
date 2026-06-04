import {stripLocalePrefix} from "./i18n";

export type NavigationTarget = {
  href: string;
  label: string;
  ctaLabel: string;
  description: string;
};

const shellKey = (value: string) => `shell.navigationTargets.${value}`;

const SAFE_NAVIGATION_ORIGIN = "http://localhost";
const ABSOLUTE_URL_SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z\d+.-]*:/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F]/;

function parseSafeHref(value: string) {
  try {
    return new URL(value, SAFE_NAVIGATION_ORIGIN);
  } catch {
    return null;
  }
}

function formatSafeHref(url: URL) {
  return `${url.pathname}${url.search}${url.hash}`;
}

function normalizeSafePathname(pathname: string) {
  return pathname.replace(/\/{2,}/g, "/");
}

function getValidationCandidates(value: string) {
  const candidates: string[] = [];
  let current = value;

  for (let index = 0; index < 4; index += 1) {
    candidates.push(current);

    try {
      const decoded = decodeURIComponent(current);
      if (decoded === current) {
        break;
      }

      current = decoded;
    } catch {
      break;
    }
  }

  return candidates;
}

function hasForbiddenNavigationPrefix(value: string) {
  return getValidationCandidates(value).some((candidate) => {
    const normalized = candidate.trim().replace(/\\/g, "/");
    return (
      CONTROL_CHARACTER_PATTERN.test(normalized) ||
      ABSOLUTE_URL_SCHEME_PATTERN.test(normalized) ||
      normalized.startsWith("//")
    );
  });
}

function isSavedViewOpenPathname(pathname: string) {
  return /^\/saved-views\/[^/]+\/open\/?$/.test(pathname);
}

function parseSafeInternalHref(value?: string | null) {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed || !trimmed.startsWith("/") || hasForbiddenNavigationPrefix(trimmed)) {
    return null;
  }

  const url = parseSafeHref(trimmed);
  if (
    !url ||
    url.origin !== SAFE_NAVIGATION_ORIGIN ||
    !url.pathname.startsWith("/") ||
    isSavedViewOpenPathname(url.pathname)
  ) {
    return null;
  }

  url.pathname = normalizeSafePathname(stripLocalePrefix(url.pathname));

  return url;
}

function normalizeSafeReturnToUrl(url: URL) {
  const nestedReturnTo = url.searchParams.get("returnTo");
  if (!nestedReturnTo) {
    return url;
  }

  const stableReturnTo = getStableReturnTo(nestedReturnTo);
  if (stableReturnTo) {
    url.searchParams.set("returnTo", stableReturnTo);
  } else {
    url.searchParams.delete("returnTo");
  }

  return url;
}

function describeUsageEventsTarget(targetHref: string, targetUrl: URL): NavigationTarget {
  const params = targetUrl.searchParams;

  if (params.get("requestId")) {
    return {
      href: targetHref,
      label: shellKey("usage.sameRequest.label"),
      ctaLabel: shellKey("usage.sameRequest.cta"),
      description: shellKey("usage.sameRequest.description"),
    };
  }

  if (params.get("providerRequestId")) {
    return {
      href: targetHref,
      label: shellKey("usage.sameUpstream.label"),
      ctaLabel: shellKey("usage.sameUpstream.cta"),
      description: shellKey("usage.sameUpstream.description"),
    };
  }

  if (params.get("virtualKeyId")) {
    return {
      href: targetHref,
      label: shellKey("usage.virtualKey.label"),
      ctaLabel: shellKey("usage.virtualKey.cta"),
      description: shellKey("usage.virtualKey.description"),
    };
  }

  if (params.get("providerConnectionId")) {
    return {
      href: targetHref,
      label: shellKey("usage.providerConnection.label"),
      ctaLabel: shellKey("usage.providerConnection.cta"),
      description: shellKey("usage.providerConnection.description"),
    };
  }

  if (params.get("budgetPolicyId")) {
    return {
      href: targetHref,
      label: shellKey("usage.budgetPolicy.label"),
      ctaLabel: shellKey("usage.budgetPolicy.cta"),
      description: shellKey("usage.budgetPolicy.description"),
    };
  }

  const hasAdditionalFilters = Array.from(params.keys()).some(
    (key) => key !== "workspaceId" && key !== "returnTo" && key !== "offset" && key !== "savedViewId",
  );

  if (hasAdditionalFilters) {
    return {
      href: targetHref,
      label: shellKey("usage.filtered.label"),
      ctaLabel: shellKey("usage.filtered.cta"),
      description: shellKey("usage.filtered.description"),
    };
  }

  return {
    href: targetHref,
    label: shellKey("usage.base.label"),
    ctaLabel: shellKey("usage.base.cta"),
    description: shellKey("usage.base.description"),
  };
}

export function getSafeReturnTo(value?: string | null) {
  const url = parseSafeInternalHref(value);
  if (!url) {
    return null;
  }

  return formatSafeHref(normalizeSafeReturnToUrl(url));
}

export function getStableReturnTo(value?: string | null) {
  const url = parseSafeInternalHref(value);
  if (!url) {
    return null;
  }

  url.searchParams.delete("returnTo");
  return formatSafeHref(url);
}

export function describeNavigationTarget(href?: string | null): NavigationTarget | null {
  const safeHref = getSafeReturnTo(href);
  if (!safeHref) {
    return null;
  }

  const targetUrl = parseSafeHref(safeHref);
  if (!targetUrl) {
    return null;
  }

  const pathname = targetUrl.pathname;

  if (pathname === "/") {
    return {
      href: safeHref,
      label: shellKey("controlCenter.label"),
      ctaLabel: shellKey("controlCenter.cta"),
      description: shellKey("controlCenter.description"),
    };
  }

  if (pathname === "/alerts") {
    return {
      href: safeHref,
      label: shellKey("alerts.label"),
      ctaLabel: shellKey("alerts.cta"),
      description: shellKey("alerts.description"),
    };
  }

  if (pathname.startsWith("/alerts/")) {
    return {
      href: safeHref,
      label: shellKey("alertDetail.label"),
      ctaLabel: shellKey("alertDetail.cta"),
      description: shellKey("alertDetail.description"),
    };
  }

  if (pathname === "/usage-events") {
    return describeUsageEventsTarget(safeHref, targetUrl);
  }

  if (pathname.startsWith("/usage-events/")) {
    return {
      href: safeHref,
      label: shellKey("usageEventDetail.label"),
      ctaLabel: shellKey("usageEventDetail.cta"),
      description: shellKey("usageEventDetail.description"),
    };
  }

  if (pathname === "/budgets") {
    return {
      href: safeHref,
      label: shellKey("budgets.label"),
      ctaLabel: shellKey("budgets.cta"),
      description: shellKey("budgets.description"),
    };
  }

  if (pathname === "/audit-logs") {
    return {
      href: safeHref,
      label: shellKey("auditLogs.label"),
      ctaLabel: shellKey("auditLogs.cta"),
      description: shellKey("auditLogs.description"),
    };
  }

  if (pathname === "/providers") {
    return {
      href: safeHref,
      label: shellKey("providers.label"),
      ctaLabel: shellKey("providers.cta"),
      description: shellKey("providers.description"),
    };
  }

  if (pathname === "/virtual-keys") {
    return {
      href: safeHref,
      label: shellKey("virtualKeys.label"),
      ctaLabel: shellKey("virtualKeys.cta"),
      description: shellKey("virtualKeys.description"),
    };
  }

  if (pathname === "/projects") {
    return {
      href: safeHref,
      label: shellKey("projects.label"),
      ctaLabel: shellKey("projects.cta"),
      description: shellKey("projects.description"),
    };
  }

  if (pathname === "/exports") {
    return {
      href: safeHref,
      label: shellKey("exports.label"),
      ctaLabel: shellKey("exports.cta"),
      description: shellKey("exports.description"),
    };
  }

  return {
    href: safeHref,
    label: shellKey("previous.label"),
    ctaLabel: shellKey("previous.cta"),
    description: shellKey("previous.description"),
  };
}

export function describeNavigationTrail(href?: string | null, maxDepth = 4) {
  const trail: NavigationTarget[] = [];
  let currentHref = getSafeReturnTo(href);
  const visited = new Set<string>();

  while (currentHref && trail.length < maxDepth && !visited.has(currentHref)) {
    visited.add(currentHref);

    const target = describeNavigationTarget(currentHref);
    if (!target) {
      break;
    }
    trail.push(target);

    const targetUrl = parseSafeHref(currentHref);
    currentHref = getSafeReturnTo(targetUrl?.searchParams.get("returnTo"));
  }

  return trail.reverse();
}

export function buildUsageEventHref(usageEventId: string, returnTo?: string | null) {
  const safeReturnTo = getStableReturnTo(returnTo);

  if (!safeReturnTo) {
    return `/usage-events/${usageEventId}`;
  }

  return `/usage-events/${usageEventId}?returnTo=${encodeURIComponent(safeReturnTo)}`;
}

export function buildAlertHref(alertId: string, returnTo?: string | null) {
  const safeReturnTo = getStableReturnTo(returnTo);

  if (!safeReturnTo) {
    return `/alerts/${alertId}`;
  }

  return `/alerts/${alertId}?returnTo=${encodeURIComponent(safeReturnTo)}`;
}

export function buildContextualHref(href: string, returnTo?: string | null) {
  const safeHref = getSafeReturnTo(href);
  if (!safeHref) {
    return href;
  }

  const targetUrl = parseSafeInternalHref(safeHref);
  if (!targetUrl) {
    return safeHref;
  }

  if (targetUrl.searchParams.has("returnTo")) {
    return formatSafeHref(targetUrl);
  }

  const safeReturnTo = getStableReturnTo(returnTo);
  if (!safeReturnTo) {
    return formatSafeHref(targetUrl);
  }

  targetUrl.searchParams.set("returnTo", safeReturnTo);
  return formatSafeHref(targetUrl);
}

export function buildUsageEventsBackHref(
  event: {
    workspaceId: string | null;
    requestId: string | null;
    providerRequestId: string | null;
  },
  requestedReturnTo?: string | null,
) {
  const safeReturnTo = getSafeReturnTo(requestedReturnTo);
  if (safeReturnTo) {
    return safeReturnTo;
  }

  const params = new URLSearchParams();

  if (event.workspaceId) {
    params.set("workspaceId", event.workspaceId);
  }

  if (event.requestId) {
    params.set("requestId", event.requestId);
  } else if (event.providerRequestId) {
    params.set("providerRequestId", event.providerRequestId);
  }

  const query = params.toString();
  return query ? `/usage-events?${query}` : "/usage-events";
}

export function buildUsageEventsScopedHref(args: {
  workspaceId: string | null;
  requestId?: string | null;
  providerRequestId?: string | null;
  virtualKeyId?: string | null;
  providerConnectionId?: string | null;
  savedViewId?: string | null;
  returnTo?: string | null;
}) {
  const params = new URLSearchParams();
  const safeReturnTo = getStableReturnTo(args.returnTo);

  if (args.workspaceId) {
    params.set("workspaceId", args.workspaceId);
  }
  if (args.requestId) {
    params.set("requestId", args.requestId);
  }
  if (args.providerRequestId) {
    params.set("providerRequestId", args.providerRequestId);
  }
  if (args.virtualKeyId) {
    params.set("virtualKeyId", args.virtualKeyId);
  }
  if (args.providerConnectionId) {
    params.set("providerConnectionId", args.providerConnectionId);
  }
  if (args.savedViewId) {
    params.set("savedViewId", args.savedViewId);
  }
  if (safeReturnTo) {
    params.set("returnTo", safeReturnTo);
  }

  const query = params.toString();
  return query ? `/usage-events?${query}` : "/usage-events";
}
