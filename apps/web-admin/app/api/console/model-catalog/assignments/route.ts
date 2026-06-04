import { NextRequest } from "next/server";

import { buildControlApiHeadersForRequest, getControlApiBaseUrl } from "@/app/lib/control-api";
import {
  jsonWithPrivateWatermark,
  responseWithPrivateWatermark,
} from "@/app/lib/private-response-watermark";
import { runWithRequestTrace } from "@/app/lib/request-trace";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return runWithRequestTrace(request.headers, async () => {
    const payload = (await request.json().catch(() => null)) as
      | {
          workspaceId?: string;
          modelIds?: string[];
        }
      | null;
    const workspaceId = payload?.workspaceId?.trim();
    if (!workspaceId) {
      return jsonWithPrivateWatermark(
        request,
        {
          error: {
            message: "workspaceId is required",
          },
        },
        {
          status: 400,
          surface: "console.model-catalog.assignments",
        },
      );
    }

    const upstreamUrl = new URL(`/v1/workspaces/${workspaceId}/model-catalog/assignments`, getControlApiBaseUrl());
    const upstreamResponse = await fetch(upstreamUrl.toString(), {
      method: "POST",
      headers: await buildControlApiHeadersForRequest(request, {
        "content-type": "application/json",
      }),
      body: JSON.stringify({
        modelIds: Array.isArray(payload?.modelIds) ? payload?.modelIds : [],
      }),
      cache: "no-store",
    });
    const body = await upstreamResponse.text();

    return responseWithPrivateWatermark(request, body, {
      status: upstreamResponse.status,
      surface: "console.model-catalog.assignments",
      workspaceId,
      headers: {
        "content-type":
          upstreamResponse.headers.get("content-type") ?? "application/json; charset=utf-8",
      },
    });
  });
}
