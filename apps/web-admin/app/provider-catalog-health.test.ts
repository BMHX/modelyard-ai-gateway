import assert from "node:assert/strict";
import test from "node:test";

import {
  getProviderCatalogCredentialIssue,
  getProviderCatalogCredentialIssueCopy,
} from "./providers/provider-catalog-health";

test("provider catalog health detects unreadable credentials", () => {
  const issue = getProviderCatalogCredentialIssue({
    providerConnectionId: "11111111-1111-4111-8111-111111111111",
    fetchedAt: "2026-04-28T00:00:00.000Z",
    status: "error",
    errorCode: "credential_unreadable",
    message: "unreadable",
    items: [],
  });

  assert.equal(issue, "credential_unreadable");
});

test("provider catalog health detects credential key mismatch", () => {
  const issue = getProviderCatalogCredentialIssue({
    providerConnectionId: "11111111-1111-4111-8111-111111111111",
    fetchedAt: "2026-04-28T00:00:00.000Z",
    status: "error",
    errorCode: "credential_key_mismatch",
    message: "mismatch",
    items: [],
  });

  assert.equal(issue, "credential_key_mismatch");
  assert.match(
    getProviderCatalogCredentialIssueCopy("en", "credential_key_mismatch").message,
    /different runtime encryption key/i,
  );
});
