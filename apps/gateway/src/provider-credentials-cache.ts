import {
  decryptProviderConnectionCandidate,
  type ProviderConnectionCandidate,
} from "@teamops/database";

import type { ResolvedProviderCredentials } from "./provider-selection.js";

const PROVIDER_CREDENTIAL_CACHE_TTL_MS = 5 * 60_000;
const PROVIDER_CREDENTIAL_CACHE_MAX_ENTRIES = 512;

type ProviderCredentialCacheEntry = {
  expiresAt: number;
  value: ResolvedProviderCredentials;
};

const providerCredentialCache = new Map<string, ProviderCredentialCacheEntry>();

function buildCacheKey(candidate: ProviderConnectionCandidate) {
  return `${candidate.connection.id}:${candidate.connection.updatedAt}:${candidate.encryptedApiKey}`;
}

function evictExpiredEntries(now: number) {
  for (const [key, entry] of providerCredentialCache) {
    if (entry.expiresAt > now) {
      continue;
    }

    providerCredentialCache.delete(key);
  }
}

function enforceCacheLimit() {
  while (providerCredentialCache.size > PROVIDER_CREDENTIAL_CACHE_MAX_ENTRIES) {
    const oldestKey = providerCredentialCache.keys().next().value;
    if (!oldestKey) {
      break;
    }

    providerCredentialCache.delete(oldestKey);
  }
}

export function getDecryptedProviderCredential(
  candidate: ProviderConnectionCandidate,
  encryptionKeyBase64: string,
  options?: {
    now?: number;
    ttlMs?: number;
  },
) {
  const now = options?.now ?? Date.now();
  const ttlMs = options?.ttlMs ?? PROVIDER_CREDENTIAL_CACHE_TTL_MS;

  evictExpiredEntries(now);

  const cacheKey = buildCacheKey(candidate);
  const cachedEntry = providerCredentialCache.get(cacheKey);
  if (cachedEntry && cachedEntry.expiresAt > now) {
    return cachedEntry.value;
  }

  const decrypted = decryptProviderConnectionCandidate(candidate, encryptionKeyBase64);
  providerCredentialCache.set(cacheKey, {
    expiresAt: now + ttlMs,
    value: decrypted,
  });
  enforceCacheLimit();
  return decrypted;
}

export function clearProviderCredentialCache() {
  providerCredentialCache.clear();
}
