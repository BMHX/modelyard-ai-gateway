import { NextRequest } from "next/server";

import { proxySelfServeRequest, runSelfServeRoute } from "../proxy";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return runSelfServeRoute(request, async () => {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();

    return proxySelfServeRequest({
      request,
      workspaceId,
      surface: "console.self-serve-virtual-keys.bootstrap",
      upstreamPath:
        `/v1/workspaces/${workspaceId}/self-serve-virtual-keys/bootstrap`,
    });
  });
}
