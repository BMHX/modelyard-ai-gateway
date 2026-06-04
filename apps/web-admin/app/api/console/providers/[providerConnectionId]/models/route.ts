import { NextRequest } from "next/server";

import { buildControlApiHeaders, getControlApiBaseUrl } from "@/app/lib/control-api";
import {
  jsonWithPrivateWatermark,
  responseWithPrivateWatermark,
} from "@/app/lib/private-response-watermark";
import { runWithRequestTrace } from "@/app/lib/request-trace";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ providerConnectionId: string }> },
) {
  return runWithRequestTrace(request.headers, async () => {
    const { providerConnectionId } = await params;
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();

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
          surface: "console.providers.models",
        },
      );
    }

    const upstreamUrl = new URL(
      `/v1/provider-connections/${providerConnectionId}/models`,
      getControlApiBaseUrl(),
    );
    upstreamUrl.searchParams.set("workspaceId", workspaceId);

    const upstreamResponse = await fetch(upstreamUrl.toString(), {
      headers: await buildControlApiHeaders(),
      cache: "no-store",
    });
    const body = await upstreamResponse.text();

    return responseWithPrivateWatermark(request, body, {
      status: upstreamResponse.status,
      surface: "console.providers.models",
      workspaceId,
      headers: {
        "content-type":
          upstreamResponse.headers.get("content-type") ?? "application/json; charset=utf-8",
      },
    });
  });
}
