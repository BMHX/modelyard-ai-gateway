import { NextRequest } from "next/server";

import {
  missingSelfServeParamResponse,
  proxySelfServeRequest,
  runSelfServeRoute,
} from "../proxy";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return runSelfServeRoute(request, async () => {
    const payload = (await request.json().catch(() => null)) as
      | {
          workspaceId?: string;
          projectId?: string;
          protocol?: string;
        }
      | null;

    const workspaceId = payload?.workspaceId?.trim();
    if (!workspaceId) {
      return missingSelfServeParamResponse({
        request,
        surface: "console.self-serve-virtual-keys.issue",
        name: "workspaceId",
      });
    }

    return proxySelfServeRequest({
      request,
      workspaceId,
      surface: "console.self-serve-virtual-keys.issue",
      upstreamPath:
        `/v1/workspaces/${workspaceId}/self-serve-virtual-keys/issue`,
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        projectId: payload?.projectId,
        protocol: payload?.protocol,
      }),
    });
  });
}
