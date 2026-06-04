import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMembersPageHref,
  buildMembersRedirect,
  stripMembersTaskState,
} from "./routing";

test("buildMembersPageHref preserves members filters and assignment drawer state", () => {
  const href = buildMembersPageHref({
    workspaceId: "ws_123",
    q: "demo",
    status: "active",
    role: "developer",
    section: "access-reviews",
    focus: "scope_gaps",
    focusMemberId: "member_123",
    task: "assign-projects",
    projectId: "project_123",
    returnTo: "/setup?workspaceId=ws_123",
  });

  assert.equal(
    href,
    "/members/reviews?workspaceId=ws_123&q=demo&status=active&role=developer&focus=scope_gaps&focusMemberId=member_123&task=assign-projects&projectId=project_123&returnTo=%2Fsetup%3FworkspaceId%3Dws_123",
  );
});

test("stripMembersTaskState removes assignment drawer params and preserves list context", () => {
  const href = stripMembersTaskState(
    "/members/reviews?workspaceId=ws_123&q=demo&status=active&focus=scope_gaps&focusMemberId=member_123&task=assign-projects&projectId=project_123&returnTo=%2Fsetup%3FworkspaceId%3Dws_123#assign-projects",
  );

  assert.equal(
    href,
    "/members/reviews?workspaceId=ws_123&q=demo&status=active&focus=scope_gaps&returnTo=%2Fsetup%3FworkspaceId%3Dws_123",
  );
});

test("buildMembersRedirect clears assignment drawer state after a successful save", () => {
  const href = buildMembersRedirect(
    "ws_123",
    "/members/offboarding?workspaceId=ws_123&status=disabled&focusMemberId=member_123&task=assign-projects&projectId=project_123&returnTo=%2Fsetup%3FworkspaceId%3Dws_123",
    {
      clearTaskState: true,
      notice: "updated",
      message: "message.updated",
      focusMemberId: "member_123",
    },
  );

  assert.equal(
    href,
    "/members/offboarding?workspaceId=ws_123&status=disabled&returnTo=%2Fsetup%3FworkspaceId%3Dws_123&notice=updated&message=message.updated&focusMemberId=member_123#member-member_123",
  );
});

test("buildMembersRedirect keeps assignment drawer state when save fails", () => {
  const href = buildMembersRedirect(
    "ws_123",
    "/members?workspaceId=ws_123&status=active&focusMemberId=member_123&task=assign-projects&projectId=project_123",
    {
      notice: "error",
      message: "members.save.error",
      focusMemberId: "member_123",
      task: "assign-projects",
      projectId: "project_123",
    },
  );

  assert.equal(
    href,
    "/members?workspaceId=ws_123&status=active&focusMemberId=member_123&task=assign-projects&projectId=project_123&notice=error&message=members.save.error#member-member_123",
  );
});
