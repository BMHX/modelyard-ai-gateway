import { type NextRequest } from "next/server";

import { buildControlApiHeaders, getControlApiBaseUrl } from "@/app/lib/control-api";
import { responseWithPrivateWatermark } from "@/app/lib/private-response-watermark";
import { runWithRequestTrace } from "@/app/lib/request-trace";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return runWithRequestTrace(request.headers, async () => {
    const upstreamUrl = new URL("/v1/prompt-inspections/export", getControlApiBaseUrl());
    request.nextUrl.searchParams.forEach((value, key) => {
      upstreamUrl.searchParams.set(key, value);
    });

    const upstreamResponse = await fetch(upstreamUrl.toString(), {
      headers: await buildControlApiHeaders(),
      cache: "no-store",
    });

    if (!upstreamResponse.ok) {
      const errorBody = await upstreamResponse.text();
      return responseWithPrivateWatermark(request, errorBody, {
        status: upstreamResponse.status,
        surface: "console.prompt-inspections.export",
        headers: {
          "content-type":
            upstreamResponse.headers.get("content-type") ?? "text/plain; charset=utf-8",
        },
      });
    }

    const responseHeaders = new Headers();
    const contentType = upstreamResponse.headers.get("content-type");
    const contentDisposition = upstreamResponse.headers.get("content-disposition");
    const contentLength = upstreamResponse.headers.get("content-length");

    if (contentType) {
      responseHeaders.set("content-type", contentType);
    }
    if (contentDisposition) {
      responseHeaders.set("content-disposition", contentDisposition);
    }
    if (contentLength) {
      responseHeaders.set("content-length", contentLength);
    }

    return responseWithPrivateWatermark(request, upstreamResponse.body, {
      status: upstreamResponse.status,
      surface: "console.prompt-inspections.export",
      headers: responseHeaders,
    });
  });
}
