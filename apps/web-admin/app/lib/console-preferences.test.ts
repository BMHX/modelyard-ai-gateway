import assert from "node:assert/strict";
import test from "node:test";

import {
  getConsoleFontSizePx,
  getConsoleLandingHref,
  getConsoleSidebarWidth,
  isRememberedFilterEligiblePath,
  normalizeConsolePreferences,
  stripRememberedFilterParams,
} from "./console-preferences";

test("normalizeConsolePreferences falls back to defaults for invalid values", () => {
  const preferences = normalizeConsolePreferences({
    themeMode: "invalid" as never,
    fontSize: "large",
  });

  assert.equal(preferences.themeMode, "system");
  assert.equal(preferences.fontSize, "large");
  assert.equal(preferences.showSupportPanelsByDefault, true);
});

test("getConsoleLandingHref scopes non-home landing pages by workspace", () => {
  assert.equal(
    getConsoleLandingHref("providers", "11111111-1111-4111-8111-111111111111"),
    "/providers?workspaceId=11111111-1111-4111-8111-111111111111",
  );
});

test("stripRememberedFilterParams keeps page-specific filters and removes workspace context", () => {
  const params = new URLSearchParams(
    "workspaceId=11111111-1111-4111-8111-111111111111&q=search&view=attention&returnTo=%2F",
  );

  assert.equal(stripRememberedFilterParams(params).toString(), "q=search&view=attention");
});

test("stripRememberedFilterParams drops transient member detail state", () => {
  const params = new URLSearchParams(
    "workspaceId=ws_123&q=search&focusMemberId=member_123&task=assign-projects&projectId=project_123&notice=created&message=member.created",
  );

  assert.equal(stripRememberedFilterParams(params).toString(), "q=search");
});

test("preference helpers expose runtime values", () => {
  assert.equal(getConsoleFontSizePx("small"), 15);
  assert.equal(getConsoleSidebarWidth("wide"), "280px");
  assert.equal(isRememberedFilterEligiblePath("/providers"), true);
  assert.equal(isRememberedFilterEligiblePath("/settings"), false);
});
