import { NextRequest, NextResponse } from "next/server";

import {
  buildConsoleBootstrapResponse,
  getWorkspacePreferenceFromCookieHeader,
} from "@/app/lib/console-api-server";

export async function GET(request: NextRequest) {
  const requestedWorkspaceId = request.nextUrl.searchParams.get("workspaceId");
  const preferredWorkspaceId = getWorkspacePreferenceFromCookieHeader(
    request.headers.get("cookie"),
  );
  const payload = await buildConsoleBootstrapResponse({
    requestedWorkspaceId,
    preferredWorkspaceId,
  });

  return NextResponse.json(payload, {
    headers: {
      "cache-control": "private, no-store, max-age=0",
    },
  });
}
