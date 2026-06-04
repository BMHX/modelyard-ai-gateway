import assert from "node:assert/strict";
import test from "node:test";

import { formatMemberCreateErrorMessage } from "./member-create-error";

test("formatMemberCreateErrorMessage parses raw validation issue arrays for Chinese", () => {
  const message =
    '[{"code":"too_small","minimum":2,"type":"string","inclusive":true,"exact":false,"message":"String must contain at least 2 character(s)","path":["name"]}]';

  assert.equal(formatMemberCreateErrorMessage("zh", message), "名称至少填写 2 个字符。");
});

test("formatMemberCreateErrorMessage parses raw validation issue arrays for English", () => {
  const message =
    '[{"code":"too_small","minimum":2,"type":"string","inclusive":true,"exact":false,"message":"String must contain at least 2 character(s)","path":["name"]}]';

  assert.equal(formatMemberCreateErrorMessage("en", message), "Name must contain at least 2 characters.");
});

test("formatMemberCreateErrorMessage localizes known member save failures", () => {
  assert.equal(
    formatMemberCreateErrorMessage("zh", "Can't save this member right now."),
    "当前无法保存成员，请稍后重试。",
  );
});

test("formatMemberCreateErrorMessage localizes email validation copy", () => {
  assert.equal(
    formatMemberCreateErrorMessage("zh", "Please enter a valid email address."),
    "请输入有效的邮箱地址。",
  );
});

test("formatMemberCreateErrorMessage localizes no-role permission copy", () => {
  assert.equal(
    formatMemberCreateErrorMessage("zh", "No permission is assigned to this membership"),
    "该成员当前未分配任何角色，暂无任何权限。",
  );
});
