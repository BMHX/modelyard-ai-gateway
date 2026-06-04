import { buildActionRedirectPath } from "./action-redirect";

function withHash(path: string, hash: string | null | undefined) {
  if (!hash) {
    return path;
  }

  const url = new URL(path, "http://localhost");
  url.hash = hash.startsWith("#") ? hash : `#${hash}`;
  return `${url.pathname}${url.search}${url.hash}`;
}

export function buildClientActionNoticeHref(
  currentPath: string,
  params?: Record<string, string | undefined>,
  hash?: string | null,
) {
  const targetPath = withHash(currentPath, hash);
  return buildActionRedirectPath(targetPath, targetPath, params);
}
