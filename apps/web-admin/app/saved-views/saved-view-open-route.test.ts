import assert from "node:assert/strict";
import test from "node:test";

import { NextRequest } from "next/server";

import { GET } from "./[savedViewId]/open/route";

test("saved view open route preserves next query params in the redirect target", async () => {
  const response = await GET(
    new NextRequest(
      "http://127.0.0.1:3001/saved-views/test-view/open?next=%2Fprompt-inspections%3FworkspaceId%3Dworkspace_1%26verdict%3Dreview%26savedViewId%3Dtest-view",
    ),
    {
      params: Promise.resolve({
        savedViewId: "test-view",
      }),
    },
  );

  assert.equal(response.status, 303);
  assert.equal(
    response.headers.get("location"),
    "http://localhost:3001/prompt-inspections?workspaceId=workspace_1&verdict=review&savedViewId=test-view",
  );
});
