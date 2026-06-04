import { type NextRequest } from "next/server";

import { buildControlApiHeaders, getControlApiBaseUrl } from "../../../../lib/control-api";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    attestationBundleId: string;
  }>;
};

export async function GET(_request: NextRequest, context: RouteContext) {
  const { attestationBundleId } = await context.params;
  const upstreamResponse = await fetch(
    `${getControlApiBaseUrl()}/v1/attestation-bundles/${attestationBundleId}/download`,
    {
      headers: await buildControlApiHeaders(),
      cache: "no-store",
    },
  );

  const responseHeaders = new Headers();

  for (const headerName of [
    "content-type",
    "content-disposition",
    "content-length",
    "x-request-id",
    "x-correlation-id",
    "x-source-request-id",
    "x-teamops-private-attestation",
    "server-timing",
  ]) {
    const value = upstreamResponse.headers.get(headerName);
    if (value) {
      responseHeaders.set(headerName, value);
    }
  }

  responseHeaders.set("cache-control", "no-store");

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: responseHeaders,
  });
}
