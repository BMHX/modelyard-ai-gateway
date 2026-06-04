import assert from "node:assert/strict";
import test from "node:test";

import { getModelCatalogErrorCopy } from "./[locale]/access/model-catalog-error";

test("placeholder credential error copy is productized in Chinese", () => {
  const copy = getModelCatalogErrorCopy({
    locale: "zh",
    errorCode: "SELF_SERVE_PROVIDER_CONNECTION_PLACEHOLDER_CREDENTIAL",
    fallbackMessage: "raw placeholder message",
  });

  assert.equal(copy.title, "该接入目标未配置真实上游密钥");
  assert.match(copy.inlineMessage, /Providers/);
  assert.match(copy.description, /占位凭据/);
  assert.equal(copy.providersCtaLabel, "去更新 Providers");
});

test("generic model catalog failures preserve the fallback message", () => {
  const copy = getModelCatalogErrorCopy({
    locale: "en",
    errorCode: "SELF_SERVE_MODEL_CATALOG_UNAVAILABLE",
    fallbackMessage: "Upstream provider unavailable",
  });

  assert.equal(copy.inlineMessage, "Upstream provider unavailable");
  assert.equal(copy.title, "Model catalog unavailable");
  assert.match(copy.description, /Retry/);
  assert.equal(copy.providersCtaLabel, "Open Providers");
});

test("credential key mismatch error copy is productized in Chinese", () => {
  const copy = getModelCatalogErrorCopy({
    locale: "zh",
    errorCode: "SELF_SERVE_PROVIDER_CONNECTION_CREDENTIAL_KEY_MISMATCH",
    fallbackMessage: "raw mismatch message",
  });

  assert.match(copy.title, /重新录入/);
  assert.match(copy.inlineMessage, /加密密钥/);
  assert.equal(copy.providersCtaLabel, "去重新填写密钥");
});
