const virtualKeyTokenPattern = /^teamops_vk_[A-Za-z0-9_-]+$/;

export function getBearerToken(authorization?: string) {
  if (!authorization) {
    return null;
  }

  const [scheme, token] = authorization.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return null;
  }

  return token.trim();
}

export function isVirtualKeyTokenCandidate(token: string) {
  return virtualKeyTokenPattern.test(token);
}
