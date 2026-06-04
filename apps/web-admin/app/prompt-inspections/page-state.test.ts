import assert from "node:assert/strict";
import test from "node:test";

import {
  appendSavedViewId,
  buildCompactPageNumbers,
  buildPromptInspectionPolicyHref,
  buildPromptInspectionSavedViewOpenHref,
  buildPromptInspectionsPageHref,
  getNextPromptInspectionSort,
  getPromptInspectionSortIndicator,
  shouldDefaultToPendingQueue,
} from "./page-state";

test("prompt inspections href builder preserves only populated query params", () => {
  const href = buildPromptInspectionsPageHref({
    workspaceId: "workspace_1",
    reviewStatus: "pending",
    sortBy: "score_desc",
    savedViewId: "view_1",
    offset: null,
  });

  assert.equal(
    href,
    "/prompt-inspections?workspaceId=workspace_1&reviewStatus=pending&sortBy=score_desc&savedViewId=view_1",
  );
});

test("appendSavedViewId injects the saved view id into an existing prompt inspections href", () => {
  const href = appendSavedViewId("/prompt-inspections?workspaceId=workspace_1&reviewStatus=pending", "view_1");

  assert.equal(
    href,
    "/prompt-inspections?workspaceId=workspace_1&reviewStatus=pending&savedViewId=view_1",
  );
});

test("saved view open href preserves the queue target", () => {
  const href = buildPromptInspectionSavedViewOpenHref(
    "view_1",
    "/prompt-inspections?workspaceId=workspace_1&reviewStatus=pending",
  );

  assert.equal(
    href,
    "/saved-views/view_1/open?next=%2Fprompt-inspections%3FworkspaceId%3Dworkspace_1%26reviewStatus%3Dpending",
  );
});

test("prompt inspection policy href builder preserves populated params", () => {
  const href = buildPromptInspectionPolicyHref({
    workspaceId: "workspace_1",
    returnTo: "/prompt-inspections?workspaceId=workspace_1&reviewStatus=pending",
    notice: null,
  });

  assert.equal(
    href,
    "/prompt-inspections/policy?workspaceId=workspace_1&returnTo=%2Fprompt-inspections%3FworkspaceId%3Dworkspace_1%26reviewStatus%3Dpending",
  );
});

test("pending queue defaulting only applies to naked workspace visits", () => {
  assert.equal(
    shouldDefaultToPendingQueue({
      workspaceId: "workspace_1",
    }),
    true,
  );

  assert.equal(
    shouldDefaultToPendingQueue({
      workspaceId: "workspace_1",
      savedViewId: "view_1",
    }),
    false,
  );

  assert.equal(
    shouldDefaultToPendingQueue({
      workspaceId: "workspace_1",
      verdict: "block",
    }),
    false,
  );

  assert.equal(
    shouldDefaultToPendingQueue({
      workspaceId: "workspace_1",
      inspectionId: "inspection_1",
    }),
    false,
  );
});

test("compact page numbers include boundaries and the current window", () => {
  assert.deepEqual(buildCompactPageNumbers(6, 12), [1, 4, 5, 6, 7, 8, 12]);
  assert.deepEqual(buildCompactPageNumbers(1, 3), [1, 2, 3]);
});

test("prompt inspection column sort toggles and indicators stay deterministic", () => {
  assert.equal(getNextPromptInspectionSort("newest", "time"), "oldest");
  assert.equal(getNextPromptInspectionSort("score_desc", "score"), "score_asc");
  assert.equal(getNextPromptInspectionSort("verdict_priority", "verdict"), "newest");
  assert.equal(getNextPromptInspectionSort("newest", "provider"), "provider_asc");

  assert.equal(getPromptInspectionSortIndicator("newest", "time"), "desc");
  assert.equal(getPromptInspectionSortIndicator("score_asc", "score"), "asc");
  assert.equal(getPromptInspectionSortIndicator("review_status_priority", "review"), "priority");
  assert.equal(getPromptInspectionSortIndicator("newest", "model"), null);
});
