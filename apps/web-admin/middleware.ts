import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getPathLocale, localeCookieName, stripLocalePrefix } from "@/app/lib/i18n";
import { controlPlaneSessionCookieName, getWebAdminAuthMode } from "@/app/lib/control-plane-auth";
import { getTrustedRequestHostname, getTrustedRequestOrigin, normalizeOrigin } from "@/app/lib/request-origin";
const publicFilePattern = /\.(?:avif|css|gif|ico|jpg|jpeg|js|json|map|png|svg|txt|webmanifest|webp|woff2?|xml)$/i;
const protectedVaryHeaders = ["authorization", "cookie", "x-teamops-web-admin-auth", "x-web-admin-auth"] as const;
const unsafeMethods = new Set(["DELETE", "PATCH", "POST", "PUT"]);
const crossSiteSensitiveGetPathPatterns = [/^\/exports\/[^/]+\/download$/u, /^\/saved-views\/[^/]+\/open$/u];
const nonLocalizedPathPatterns = [
  /^\/api(?:\/|$)/u,
  /^\/auth(?:\/|$)/u,
  /^\/exports\/[^/]+\/download$/u,
  /^\/saved-views\/[^/]+\/open$/u,
];
const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);
const devTrustedLocalHosts = new Set(["0.0.0.0", "192.168.2.1"]);
const middlewareContentSecurityPolicy = [
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");
const middlewareSecurityHeaders = {
  "content-security-policy": middlewareContentSecurityPolicy,
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "origin-agent-cluster": "?1",
  "permissions-policy":
    "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "x-robots-tag": "noindex, nofollow",
} as const;
const nextIntlLocaleHeader = "X-NEXT-INTL-LOCALE";
const sessionAuthErrorCodes = new Set(["AUTH_REQUIRED", "SESSION_EXPIRED", "SESSION_REVOKED"]);

function isPublicPath(pathname: string) {
  return (
    pathname === "/api/healthz" ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico" ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml" ||
    publicFilePattern.test(pathname)
  );
}

function isNonLocalizedPath(pathname: string) {
  return nonLocalizedPathPatterns.some((pattern) => pattern.test(pathname));
}

function isAuthenticationPublicPath(pathname: string) {
  const normalizedPathname = stripLocalePrefix(pathname);
  return normalizedPathname === "/login" || normalizedPathname.startsWith("/auth/");
}

function getAuthenticationPublicReturnToPath(request: NextRequest) {
  const returnTo = request.nextUrl.searchParams.get("returnTo")?.trim();
  if (!returnTo) {
    return null;
  }

  try {
    const returnToUrl = new URL(returnTo, request.nextUrl.origin);
    const normalizedReturnToPathname = stripLocalePrefix(returnToUrl.pathname);
    return normalizedReturnToPathname === "/login" || normalizedReturnToPathname.startsWith("/auth/")
      ? returnToUrl.pathname
      : null;
  } catch {
    return null;
  }
}

function maybeCleanAuthenticationPublicReturnTo(request: NextRequest) {
  if (!isAuthenticationPublicPath(request.nextUrl.pathname)) {
    return null;
  }

  if (!getAuthenticationPublicReturnToPath(request)) {
    return null;
  }

  const nextUrl = request.nextUrl.clone();
  nextUrl.searchParams.delete("returnTo");
  return NextResponse.redirect(nextUrl, 302);
}

function appendVaryHeaders(response: NextResponse, headerNames: readonly string[]) {
  const existing = response.headers.get("vary");
  const varyValues = new Set(
    (existing ? existing.split(",") : [])
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => value.toLowerCase()),
  );

  for (const headerName of headerNames) {
    varyValues.add(headerName.toLowerCase());
  }

  if (varyValues.size > 0) {
    response.headers.set("vary", [...varyValues].join(", "));
  }
}

function applySecurityHeaders(response: NextResponse) {
  for (const [name, value] of Object.entries(middlewareSecurityHeaders)) {
    response.headers.set(name, value);
  }

  response.headers.set("cache-control", "no-store");
  appendVaryHeaders(response, protectedVaryHeaders);
  return response;
}

function collectTrustedBrowserOrigins() {
  const trustedOrigins = new Set<string>();
  const rawOriginLists = [
    process.env.WEB_ADMIN_ALLOWED_BROWSER_ORIGINS,
    process.env.WEB_ADMIN_BASE_URL,
    process.env.WEB_ADMIN_PUBLIC_BASE_URL,
    process.env.APP_BASE_URL,
    process.env.PUBLIC_APP_BASE_URL,
  ];

  for (const rawOriginList of rawOriginLists) {
    if (!rawOriginList) {
      continue;
    }

    for (const candidate of rawOriginList.split(/[,\n]/)) {
      const normalized = normalizeOrigin(candidate.trim());
      if (normalized) {
        trustedOrigins.add(normalized);
      }
    }
  }

  if (process.env.NODE_ENV !== "production" || trustedOrigins.size === 0) {
    trustedOrigins.add("http://127.0.0.1:3001");
    trustedOrigins.add("http://localhost:3001");
    trustedOrigins.add("http://[::1]:3001");
  }

  return trustedOrigins;
}

function isTrustedBrowserHostname(hostname: string) {
  return (
    loopbackHosts.has(hostname) ||
    (process.env.NODE_ENV !== "production" && devTrustedLocalHosts.has(hostname))
  );
}

function isTrustedBrowserEntry(request: NextRequest, trustedOrigins: ReadonlySet<string>) {
  const requestOrigin = getTrustedRequestOrigin(request);
  if (requestOrigin) {
    for (const trustedOrigin of trustedOrigins) {
      if (areEquivalentOrigins(requestOrigin, trustedOrigin)) {
        return true;
      }
    }

    try {
      const requestUrl = new URL(requestOrigin);
      if (requestUrl.protocol === "https:" && !loopbackHosts.has(requestUrl.hostname)) {
        return true;
      }
    } catch {
      // Fall through to hostname-based checks.
    }
  }

  return isTrustedBrowserHostname(getTrustedRequestHostname(request));
}

function getEffectivePort(url: URL) {
  if (url.port) {
    return url.port;
  }

  return url.protocol === "https:" ? "443" : "80";
}

function areEquivalentOrigins(left: string, right: string) {
  try {
    const leftUrl = new URL(left);
    const rightUrl = new URL(right);

    if (leftUrl.origin === rightUrl.origin) {
      return true;
    }

    return (
      leftUrl.protocol === rightUrl.protocol &&
      getEffectivePort(leftUrl) === getEffectivePort(rightUrl) &&
      loopbackHosts.has(leftUrl.hostname) &&
      loopbackHosts.has(rightUrl.hostname)
    );
  } catch {
    return false;
  }
}

function isCrossSiteProtectedRequest(request: NextRequest) {
  if (unsafeMethods.has(request.method)) {
    return true;
  }

  return crossSiteSensitiveGetPathPatterns.some((pattern) => pattern.test(request.nextUrl.pathname));
}

function getCrossSiteRejectionReason(request: NextRequest) {
  if (!isCrossSiteProtectedRequest(request)) {
    return null;
  }

  const expectedOrigin = getTrustedRequestOrigin(request);
  if (!expectedOrigin) {
    return "Cross-site browser requests are blocked for this control-plane route.";
  }

  const origin = normalizeOrigin(request.headers.get("origin"));
  if (origin && !areEquivalentOrigins(origin, expectedOrigin)) {
    return "Cross-site browser requests are blocked for this control-plane route.";
  }

  const referer = normalizeOrigin(request.headers.get("referer"));
  if (!origin && referer && !areEquivalentOrigins(referer, expectedOrigin)) {
    return "Cross-site browser requests are blocked for this control-plane route.";
  }

  const secFetchSite = request.headers.get("sec-fetch-site")?.trim().toLowerCase();
  if (secFetchSite === "cross-site") {
    return "Cross-site browser requests are blocked for this control-plane route.";
  }

  return null;
}

function buildRejectedBody(request: NextRequest, message: string) {
  const acceptHeader = request.headers.get("accept") || "";
  const expectsHtml = acceptHeader.includes("text/html");

  if (!expectsHtml) {
    return {
      body: JSON.stringify({
        error: {
          message,
        },
      }),
      contentType: "application/json; charset=utf-8",
    };
  }

  return {
    body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Request blocked</title></head><body><main><h1>Request blocked</h1><p>${message}</p></main></body></html>`,
    contentType: "text/html; charset=utf-8",
  };
}

function buildRejectedResponse(
  request: NextRequest,
  args: {
    status: number;
    message: string;
  },
) {
  const body = buildRejectedBody(request, args.message);
  const response = new NextResponse(request.method === "HEAD" ? null : body.body, {
    status: args.status,
    headers: {
      "content-type": body.contentType,
    },
  });

  return applySecurityHeaders(response);
}

function getControlApiBaseUrl() {
  return process.env.CONTROL_API_BASE_URL ?? process.env.NEXT_PUBLIC_CONTROL_API_BASE_URL ?? "http://127.0.0.1:4001";
}

async function validateSessionHandle(sessionHandle: string) {
  const response = await fetch(`${getControlApiBaseUrl()}/v1/auth/session`, {
    method: "GET",
    headers: {
      accept: "application/json",
      "x-teamops-web-admin-auth": `session ${sessionHandle}`,
    },
    cache: "no-store",
  });

  if (response.ok) {
    return {
      ok: true as const,
    };
  }

  const payload = (await response.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
  return {
    ok: false as const,
    code: payload?.error?.code ?? null,
    message: payload?.error?.message ?? "Authentication is required",
  };
}

function buildSessionAuthResponse(
  request: NextRequest,
  args: {
    code: string;
    message: string;
  },
) {
  const normalizedPathname = stripLocalePrefix(request.nextUrl.pathname);
  if (normalizedPathname.startsWith("/api/")) {
    return applySecurityHeaders(
      NextResponse.json(
        {
          error: {
            code: args.code,
            message: args.message,
          },
        },
        {
          status: 401,
        },
      ),
    );
  }

  const locale = getPathLocale(request.nextUrl.pathname);
  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = locale === "zh" ? "/zh/login" : "/login";
  loginUrl.search = "";
  const returnTo = `${stripLocalePrefix(request.nextUrl.pathname)}${request.nextUrl.search}`;
  loginUrl.searchParams.set("returnTo", returnTo || "/");
  if (args.code !== "AUTH_REQUIRED") {
    loginUrl.searchParams.set("error", args.message);
  }

  const response = NextResponse.redirect(loginUrl, { status: 302 });
  response.cookies.set(controlPlaneSessionCookieName, "", {
    httpOnly: true,
    maxAge: 0,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  return applySecurityHeaders(response);
}

function maybeNormalizeLegacyLocale(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (pathname === "/en" || pathname.startsWith("/en/")) {
    const nextUrl = request.nextUrl.clone();
    const normalizedPathname = pathname.replace(/^\/en(?=\/|$)/u, "") || "/";
    nextUrl.pathname = normalizedPathname;
    nextUrl.search = search;
    return NextResponse.redirect(nextUrl, 302);
  }

  if (pathname === "/zh-CN" || pathname.startsWith("/zh-CN/")) {
    const nextUrl = request.nextUrl.clone();
    nextUrl.pathname = pathname.replace(/^\/zh-CN(?=\/|$)/u, "/zh");
    return NextResponse.redirect(nextUrl, 302);
  }

  const localeCookie = request.cookies.get(localeCookieName)?.value?.toLowerCase();
  const wantsZh = localeCookie === "zh" || localeCookie === "zh-cn";
  const alreadyLocalized = pathname === "/zh" || pathname.startsWith("/zh/");

  if (wantsZh && !alreadyLocalized && !isNonLocalizedPath(pathname) && !isPublicPath(pathname)) {
    const nextUrl = request.nextUrl.clone();
    nextUrl.pathname = pathname === "/" ? "/zh" : `/zh${pathname}`;
    nextUrl.search = search;
    return NextResponse.redirect(nextUrl, 302);
  }

  return null;
}

function buildLocaleAwareResponse(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  const locale = getPathLocale(request.nextUrl.pathname);
  requestHeaders.set(nextIntlLocaleHeader, locale);

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
  response.cookies.set(localeCookieName, locale, {
    path: "/",
    sameSite: "lax",
  });
  return response;
}

export async function middleware(request: NextRequest) {
  if (isPublicPath(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  const trustedOrigins = collectTrustedBrowserOrigins();
  if (!isTrustedBrowserEntry(request, trustedOrigins)) {
    return buildRejectedResponse(request, {
      status: 403,
      message:
        "This development control-plane surface only accepts browser traffic from trusted local or explicitly allowed origins.",
    });
  }

  const crossSiteRejectionReason = getCrossSiteRejectionReason(request);
  if (crossSiteRejectionReason) {
    return buildRejectedResponse(request, {
      status: 403,
      message: crossSiteRejectionReason,
    });
  }

  const legacyNormalization = maybeNormalizeLegacyLocale(request);
  if (legacyNormalization) {
    return applySecurityHeaders(legacyNormalization);
  }

  const cleanAuthenticationReturnTo = maybeCleanAuthenticationPublicReturnTo(request);
  if (cleanAuthenticationReturnTo) {
    return applySecurityHeaders(cleanAuthenticationReturnTo);
  }

  if (getWebAdminAuthMode() === "session" && !isAuthenticationPublicPath(request.nextUrl.pathname)) {
    const sessionHandle = request.cookies.get(controlPlaneSessionCookieName)?.value?.trim();
    if (!sessionHandle) {
      return buildSessionAuthResponse(request, {
        code: "AUTH_REQUIRED",
        message: "Authentication is required for this route",
      });
    }

    try {
      const sessionValidation = await validateSessionHandle(sessionHandle);
      if (!sessionValidation.ok && sessionAuthErrorCodes.has(sessionValidation.code ?? "")) {
        return buildSessionAuthResponse(request, {
          code: sessionValidation.code ?? "AUTH_REQUIRED",
          message: sessionValidation.message,
        });
      }
    } catch {
      return applySecurityHeaders(NextResponse.next());
    }
  }

  if (isNonLocalizedPath(request.nextUrl.pathname)) {
    return applySecurityHeaders(NextResponse.next());
  }

  return applySecurityHeaders(buildLocaleAwareResponse(request));
}

export const config = {
  matcher: ["/:path*"],
};
