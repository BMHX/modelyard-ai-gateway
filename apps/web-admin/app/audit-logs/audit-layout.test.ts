import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAuditActiveFilterChips,
  buildAuditFrontSavedViewSections,
  buildAuditResultSummaryItems,
} from "./audit-layout";

const tr = (text: string, values?: Record<string, string | number>) =>
  values
    ? text.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? `{${key}}`))
    : text;

test("buildAuditActiveFilterChips keeps action search and advanced filters only", () => {
  const chips = buildAuditActiveFilterChips([
    { label: "Workspace", value: "demo", href: "/audit-logs" },
    { label: "Project", value: "Core API", href: "/audit-logs?projectId=1" },
    { label: "Action", value: "workspace.created", href: "/audit-logs?action=" },
    { label: "Actor type", value: "service", href: "/audit-logs?actorType=" },
    { label: "From", value: "2026-04-01T00:00", href: "/audit-logs?from=" },
  ]);

  assert.deepEqual(
    chips.map((chip) => chip.label),
    ["Action", "Actor type", "From"],
  );
});

test("buildAuditFrontSavedViewSections keeps default and recent views on the first screen", () => {
  const sections = buildAuditFrontSavedViewSections({
    tr,
    defaultViews: [
      {
        label: "Current scope",
        hint: "23 visible entries",
        href: "/audit-logs",
        active: true,
      },
    ],
    recentViews: [
      {
        id: "sv_123",
        label: "Service review",
        hint: "Opened Apr 18",
        href: "/audit-logs?savedViewId=sv_123",
        active: false,
      },
    ],
    savedViewsUnavailable: false,
  });

  assert.equal(sections.length, 2);
  assert.deepEqual(
    sections.map((section) => section.key),
    ["default", "recent"],
  );
});

test("buildAuditFrontSavedViewSections drops recent saved views when the saved view service is unavailable", () => {
  const sections = buildAuditFrontSavedViewSections({
    tr,
    defaultViews: [],
    recentViews: [
      {
        id: "sv_123",
        label: "Service review",
        hint: "Opened Apr 18",
        href: "/audit-logs?savedViewId=sv_123",
        active: false,
      },
    ],
    savedViewsUnavailable: true,
  });

  assert.deepEqual(
    sections.map((section) => section.key),
    ["default"],
  );
});

test("buildAuditFrontSavedViewSections omits empty recent views from the first screen", () => {
  const sections = buildAuditFrontSavedViewSections({
    tr,
    defaultViews: [
      {
        label: "Current scope",
        hint: "23 visible entries",
        href: "/audit-logs",
        active: true,
      },
    ],
    recentViews: [],
    savedViewsUnavailable: false,
  });

  assert.deepEqual(
    sections.map((section) => section.key),
    ["default"],
  );
});

test("buildAuditResultSummaryItems highlights the visible range and saved view state", () => {
  const items = buildAuditResultSummaryItems({
    tr,
    pageStart: 1,
    pageEnd: 23,
    total: 23,
    visibleActorCount: 8,
    visibleActionCount: 6,
    serviceActorCount: 22,
    activeSavedViewName: "Service review",
  });

  assert.equal(items[0]?.value, "23");
  assert.equal(items[0]?.meta, "1-23");
  assert.equal(items[3]?.meta, "Service review");
});
