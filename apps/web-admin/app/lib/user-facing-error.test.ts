import assert from "node:assert/strict";
import test from "node:test";

import { getUserErrorMessage } from "./user-facing-error";

test("getUserErrorMessage returns an actionable provider migration hint", () => {
  const error = Object.assign(
    new Error("Provider connections are unavailable until database migrations are up to date"),
    {
      errorCode: "TEAMOPS_MISSING_TABLE",
      errorResource: "provider_connections",
    },
  );

  assert.equal(
    getUserErrorMessage(error, "Can't save right now. Please try again."),
    "Providers can't be saved until database migrations are up to date.",
  );
});

test("getUserErrorMessage returns an actionable workspace model migration hint", () => {
  const error = Object.assign(
    new Error("Workspace model assignments are unavailable until database migrations are up to date"),
    {
      errorCode: "TEAMOPS_MISSING_TABLE",
      errorResource: "workspace_model_catalog",
    },
  );

  assert.equal(
    getUserErrorMessage(error, "Can't load access state right now."),
    "Developer access models aren't ready until database migrations are up to date.",
  );
});

test("getUserErrorMessage uses the caller fallback for invalid request errors", () => {
  const error = Object.assign(new Error("Invalid request"), {
    errorCode: "INVALID_REQUEST",
  });

  assert.equal(
    getUserErrorMessage(error, "Can't load access state right now."),
    "Can't load access state right now.",
  );
});

test("getUserErrorMessage uses the caller fallback for unexpected control api errors", () => {
  const error = Object.assign(new Error("Unexpected control API error"), {
    errorCode: "UNEXPECTED_ERROR",
  });

  assert.equal(
    getUserErrorMessage(error, "Can't load access state right now."),
    "Can't load access state right now.",
  );
});
