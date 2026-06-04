import { NextRequest } from "next/server";

import {
  missingSelfServeParamResponse,
  proxySelfServeRequest,
  runSelfServeRoute,
} from "../../proxy";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: {
    params: Promise<{
      virtualKeyId: string;
    }>;
  },
) {
  return runSelfServeRoute(request, async () => {
    const payload = (await request.json().catch(() => null)) as
      | {
          workspaceId?: string;
        }
      | null;
    const workspaceId = payload?.workspaceId?.trim();
    const { virtualKeyId } = await context.params;

    if (!workspaceId) {
      return missingSelfServeParamResponse({
        request,
        surface: "console.self-serve-virtual-keys.revoke",
        name: "workspaceId",
      });
    }

    return proxySelfServeRequest({
      request,
      workspaceId,
      surface: "console.self-serve-virtual-keys.revoke",
      upstreamPath:
        `/v1/workspaces/${workspaceId}/self-serve-virtual-keys/${virtualKeyId}/revoke`,
      method: "POST",
    });
  });
}
