import assert from "node:assert/strict";
import test from "node:test";

import {
  ConsoleAuthRedirectError,
  ConsoleHttpError,
} from "./lib/console-api-client";
import {
  getIssueKeyFeedback,
  resolveIssueKeyFailure,
} from "./[locale]/access/issue-key-state";

test("issue key feedback returns a success panel after issuance", () => {
  const feedback = getIssueKeyFeedback("zh", {
    status: "success",
    message: null,
  });

  assert.deepEqual(feedback, {
    tone: "success",
    title: "个人开发密钥已就绪",
    message:
      "当前个人开发密钥已显示在下方，并已同步到代码片段。该密钥只会显示在本次会话中。",
  });
});

test("issue key feedback returns the provided error message for failed issuance", () => {
  const feedback = getIssueKeyFeedback("en", {
    status: "error",
    message: "The selected item is outside the current allowed scope.",
  });

  assert.deepEqual(feedback, {
    tone: "error",
    title: "Couldn't issue personal key",
    message: "The selected item is outside the current allowed scope.",
  });
});

test("resolveIssueKeyFailure maps self-serve scope errors to user-facing copy", () => {
  const resolution = resolveIssueKeyFailure(
    new ConsoleHttpError(
      "This project is outside the current assigned project scope",
      403,
      "SELF_SERVE_PROJECT_SCOPE_FORBIDDEN",
    ),
    "Failed to issue key",
  );

  assert.deepEqual(resolution, {
    kind: "error",
    message: "The selected item is outside the current allowed scope.",
    shouldRefreshBootstrap: false,
  });
});

test("resolveIssueKeyFailure requests bootstrap refresh when the provider target disappeared", () => {
  const resolution = resolveIssueKeyFailure(
    new ConsoleHttpError(
      "The selected provider connection is not available for this workspace",
      404,
      "SELF_SERVE_PROVIDER_CONNECTION_NOT_FOUND",
    ),
    "Failed to issue key",
  );

  assert.deepEqual(resolution, {
    kind: "error",
    message: "The selected item is no longer available.",
    shouldRefreshBootstrap: true,
  });
});

test("resolveIssueKeyFailure preserves auth redirect flow", () => {
  const resolution = resolveIssueKeyFailure(
    new ConsoleAuthRedirectError("Your session expired. Please sign in again."),
    "Failed to issue key",
  );

  assert.deepEqual(resolution, {
    kind: "redirect",
    message: null,
    shouldRefreshBootstrap: false,
  });
});
