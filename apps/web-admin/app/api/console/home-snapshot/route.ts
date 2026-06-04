import { NextRequest, NextResponse } from "next/server";

import { getWorkspaceHomeSnapshot } from "@/app/lib/control-api";

export async function GET(request: NextRequest) {
  const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();

  if (!workspaceId) {
    return NextResponse.json(
      {
        error: {
          message: "workspaceId is required",
        },
      },
      {
        status: 400,
      },
    );
  }

  const payload = await getWorkspaceHomeSnapshot(workspaceId);
  return NextResponse.json(payload, {
    headers: {
      "cache-control": "private, no-store, max-age=0",
    },
  });
}
