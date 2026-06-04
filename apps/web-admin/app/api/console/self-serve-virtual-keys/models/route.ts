import { NextRequest } from "next/server";

import {
  missingSelfServeParamResponse,
  proxySelfServeRequest,
  runSelfServeRoute,
} from "../proxy";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return runSelfServeRoute(request, async () => {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    const providerConnectionId = request.nextUrl.searchParams.get("providerConnectionId")?.trim();

    if (!workspaceId) {
      return missingSelfServeParamResponse({
        request,
        surface: "console.self-serve-virtual-keys.models",
        name: "workspaceId",
      });
    }

    if (!providerConnectionId) {
      return missingSelfServeParamResponse({
        request,
        workspaceId,
        surface: "console.self-serve-virtual-keys.models",
        name: "providerConnectionId",
      });
    }

    return proxySelfServeRequest({
      request,
      workspaceId,
      surface: "console.self-serve-virtual-keys.models",
      upstreamPath:
        `/v1/workspaces/${workspaceId}/self-serve-virtual-keys/models?providerConnectionId=${encodeURIComponent(providerConnectionId)}`,
    });
  });
}
