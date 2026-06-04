import assert from "node:assert/strict";
import test from "node:test";

import { getWebAdminAuthMode } from "./control-plane-auth";

const originalNodeEnv = process.env.NODE_ENV;
const originalAuthMode = process.env.WEB_ADMIN_AUTH_MODE;
const originalAdminToken = process.env.CONTROL_API_ADMIN_TOKEN;
const originalMemberEmail = process.env.CONTROL_API_MEMBER_EMAIL;

function setNodeEnv(value: string | undefined) {
  if (value === undefined) {
    Reflect.deleteProperty(process.env, "NODE_ENV");
    return;
  }

  Reflect.set(process.env, "NODE_ENV", value);
}

function restoreEnv() {
  setNodeEnv(originalNodeEnv);
  process.env.WEB_ADMIN_AUTH_MODE = originalAuthMode;
  process.env.CONTROL_API_ADMIN_TOKEN = originalAdminToken;
  process.env.CONTROL_API_MEMBER_EMAIL = originalMemberEmail;
}

test.afterEach(() => {
  restoreEnv();
});

test.after(() => {
  restoreEnv();
});

test("getWebAdminAuthMode defaults to bootstrap admin in development when an admin token is present", () => {
  setNodeEnv("development");
  delete process.env.WEB_ADMIN_AUTH_MODE;
  process.env.CONTROL_API_ADMIN_TOKEN = "demo-admin-token";
  delete process.env.CONTROL_API_MEMBER_EMAIL;

  assert.equal(getWebAdminAuthMode(), "bootstrap_admin");
});

test("getWebAdminAuthMode prefers member-email bootstrap mode in development when no explicit mode is set", () => {
  setNodeEnv("development");
  delete process.env.WEB_ADMIN_AUTH_MODE;
  process.env.CONTROL_API_ADMIN_TOKEN = "demo-admin-token";
  process.env.CONTROL_API_MEMBER_EMAIL = "alice@example.com";

  assert.equal(getWebAdminAuthMode(), "bootstrap_member_email");
});

test("getWebAdminAuthMode keeps session mode as the production fallback", () => {
  setNodeEnv("production");
  delete process.env.WEB_ADMIN_AUTH_MODE;
  process.env.CONTROL_API_ADMIN_TOKEN = "demo-admin-token";
  delete process.env.CONTROL_API_MEMBER_EMAIL;

  assert.equal(getWebAdminAuthMode(), "session");
});

test("getWebAdminAuthMode honors an explicitly configured mode", () => {
  setNodeEnv("development");
  process.env.WEB_ADMIN_AUTH_MODE = "session";
  process.env.CONTROL_API_ADMIN_TOKEN = "demo-admin-token";
  process.env.CONTROL_API_MEMBER_EMAIL = "alice@example.com";

  assert.equal(getWebAdminAuthMode(), "session");
});
