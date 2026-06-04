import { NextRequest } from "next/server";

import { buildControlApiHeadersForRequest, getControlApiBaseUrl } from "@/app/lib/control-api";
import {
  jsonWithPrivateWatermark,
  responseWithPrivateWatermark,
} from "@/app/lib/private-response-watermark";
import { runWithRequestTrace } from "@/app/lib/request-trace";

type SelfServeProxyArgs = {
  request: NextRequest;
  workspaceId: string | null | undefined;
  surface: string;
  upstreamPath: string;
  method?: "GET" | "POST";
  body?: BodyInit | null;
  headers?: ConstructorParameters<typeof Headers>[0];
};

type RequiredParamArgs = {
  request: NextRequest;
  workspaceId?: string | null;
  surface: string;
  name: string;
};

export function missingSelfServeParamResponse({
  request,
  workspaceId,
  surface,
  name,
}: RequiredParamArgs) {
  return jsonWithPrivateWatermark(
    request,
    {
      error: {
        message: `${name} is required`,
      },
    },
    {
      status: 400,
      surface,
      workspaceId: workspaceId ?? undefined,
    },
  );
}

export function runSelfServeRoute(
  request: NextRequest,
  handler: () => Promise<Response>,
) {
  return runWithRequestTrace(request.headers, handler);
}

export async function proxySelfServeRequest({
  request,
  workspaceId,
  surface,
  upstreamPath,
  method = "GET",
  body,
  headers,
}: SelfServeProxyArgs) {
  if (!workspaceId) {
    return missingSelfServeParamResponse({
      request,
      surface,
      name: "workspaceId",
    });
  }

  const upstreamUrl = new URL(upstreamPath, getControlApiBaseUrl());
  const upstreamResponse = await fetch(upstreamUrl.toString(), {
    method,
    headers: await buildControlApiHeadersForRequest(request, headers),
    body,
    cache: "no-store",
  });

  const responseBody = await upstreamResponse.text();

  return responseWithPrivateWatermark(request, responseBody, {
    status: upstreamResponse.status,
    surface,
    workspaceId,
    headers: {
      "content-type":
        upstreamResponse.headers.get("content-type") ?? "application/json; charset=utf-8",
    },
  });
}
