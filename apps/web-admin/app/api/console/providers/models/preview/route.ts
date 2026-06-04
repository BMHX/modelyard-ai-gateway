import { NextRequest } from "next/server";

import { buildControlApiHeaders, getControlApiBaseUrl } from "@/app/lib/control-api";
import {
  jsonWithPrivateWatermark,
  responseWithPrivateWatermark,
} from "@/app/lib/private-response-watermark";
import { runWithRequestTrace } from "@/app/lib/request-trace";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return runWithRequestTrace(request.headers, async () => {
    const payload = await request.text();
    if (!payload.trim()) {
      return jsonWithPrivateWatermark(
        request,
        {
          error: {
            message: "Request body is required",
          },
        },
        {
          status: 400,
          surface: "console.providers.models.preview",
        },
      );
    }

    const upstreamResponse = await fetch(
      new URL("/v1/provider-connections/models/preview", getControlApiBaseUrl()),
      {
        method: "POST",
        headers: await buildControlApiHeaders({
          accept: "application/json",
          "content-type": "application/json",
        }),
        body: payload,
        cache: "no-store",
      },
    );
    const body = await upstreamResponse.text();

    return responseWithPrivateWatermark(request, body, {
      status: upstreamResponse.status,
      surface: "console.providers.models.preview",
      headers: {
        "content-type":
          upstreamResponse.headers.get("content-type") ?? "application/json; charset=utf-8",
      },
    });
  });
}
