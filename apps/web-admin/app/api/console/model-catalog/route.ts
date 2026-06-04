import { NextRequest } from "next/server";

import { buildControlApiHeadersForRequest, getControlApiBaseUrl } from "@/app/lib/control-api";
import {
  jsonWithPrivateWatermark,
  responseWithPrivateWatermark,
} from "@/app/lib/private-response-watermark";
import { runWithRequestTrace } from "@/app/lib/request-trace";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return runWithRequestTrace(request.headers, async () => {
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
          surface: "console.model-catalog.list",
        },
      );
    }

    const upstreamUrl = new URL(`/v1/workspaces/${workspaceId}/model-catalog`, getControlApiBaseUrl());
    const upstreamResponse = await fetch(upstreamUrl.toString(), {
      headers: await buildControlApiHeadersForRequest(request),
      cache: "no-store",
    });
    const body = await upstreamResponse.text();

    return responseWithPrivateWatermark(request, body, {
      status: upstreamResponse.status,
      surface: "console.model-catalog.list",
      workspaceId,
      headers: {
        "content-type":
          upstreamResponse.headers.get("content-type") ?? "application/json; charset=utf-8",
      },
    });
  });
}

export async function POST(request: NextRequest) {
  return runWithRequestTrace(request.headers, async () => {
    const payload = (await request.json().catch(() => null)) as
      | {
          workspaceId?: string;
          modelId?: string;
          label?: string;
          sourceProviderConnectionId?: string;
          status?: string;
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
          surface: "console.model-catalog.create",
        },
      );
    }

    const upstreamUrl = new URL(`/v1/workspaces/${workspaceId}/model-catalog/models`, getControlApiBaseUrl());
    const upstreamResponse = await fetch(upstreamUrl.toString(), {
      method: "POST",
      headers: await buildControlApiHeadersForRequest(request, {
        "content-type": "application/json",
      }),
      body: JSON.stringify({
        modelId: payload?.modelId,
        label: payload?.label,
        sourceProviderConnectionId: payload?.sourceProviderConnectionId,
        status: payload?.status,
      }),
      cache: "no-store",
    });
    const body = await upstreamResponse.text();

    return responseWithPrivateWatermark(request, body, {
      status: upstreamResponse.status,
      surface: "console.model-catalog.create",
      workspaceId,
      headers: {
        "content-type":
          upstreamResponse.headers.get("content-type") ?? "application/json; charset=utf-8",
      },
    });
  });
}
