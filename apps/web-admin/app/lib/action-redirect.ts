import { getSafeReturnTo } from "./navigation";

export function buildActionRedirectPath(
  fallbackPath: string,
  requestedPath: string | undefined,
  params?: Record<string, string | undefined>,
) {
  const safeFallbackPath = getSafeReturnTo(fallbackPath) ?? fallbackPath;
  const safePath = getSafeReturnTo(requestedPath) ?? safeFallbackPath;
  const targetUrl = new URL(safePath, "http://localhost");

  for (const [key, value] of Object.entries(params ?? {})) {
    if (!value) {
      continue;
    }

    targetUrl.searchParams.set(key, value);
  }

  return `${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`;
}
