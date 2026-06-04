import assert from "node:assert/strict";
import test from "node:test";

import { resolveLoginErrorMessage } from "./login-error";

test("resolveLoginErrorMessage localizes missing membership errors for Chinese login pages", () => {
  assert.equal(
    resolveLoginErrorMessage({
      locale: "zh",
      errorCode: "OIDC_NO_ACTIVE_MEMBERSHIP",
      errorMessage: "No active workspace membership was found for this login",
    }),
    "当前账号没有可用的工作区成员身份，无法登录控制台。",
  );
});

test("resolveLoginErrorMessage localizes no-role login blocks for Chinese login pages", () => {
  assert.equal(
    resolveLoginErrorMessage({
      locale: "zh",
      errorCode: "OIDC_MEMBERSHIP_NO_ROLES",
      errorMessage: "No permission is assigned to this account",
    }),
    "当前账号未分配任何角色，暂无权限登录控制台。",
  );
});
