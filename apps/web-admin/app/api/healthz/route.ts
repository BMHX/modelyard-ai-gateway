import { randomUUID } from "node:crypto";

import { buildControlApiHeaders, getControlApiBaseUrl } from "../../lib/control-api";

async function readJson(response: Response) {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function GET() {
  const requestId = `web-admin_${randomUUID()}`;
  const correlationId = requestId;
  const timestamp = new Date().toISOString();
  const responseHeaders = new Headers({
    "cache-control": "no-store",
    "x-request-id": requestId,
    "x-correlation-id": correlationId,
  });

  const payload: Record<string, unknown> = {
    service: "web-admin",
    status: "ok",
    timestamp,
    requestId,
    correlationId,
  };

  try {
    const controlApiResponse = await fetch(`${getControlApiBaseUrl()}/healthz`, {
      headers: await buildControlApiHeaders({
        "x-source-request-id": requestId,
        "x-correlation-id": correlationId,
      }),
      cache: "no-store",
    });
    const controlApiPayload = await readJson(controlApiResponse);
    const controlApiRequestId =
      controlApiResponse.headers.get("x-request-id")?.trim() ||
      (typeof controlApiPayload?.requestId === "string" ? controlApiPayload.requestId : null);
    const controlApiCorrelationId =
      controlApiResponse.headers.get("x-correlation-id")?.trim() ||
      (typeof controlApiPayload?.correlationId === "string" ? controlApiPayload.correlationId : null);

    if (controlApiRequestId) {
      responseHeaders.set("x-upstream-request-id", controlApiRequestId);
    }

    if (controlApiCorrelationId) {
      responseHeaders.set("x-upstream-correlation-id", controlApiCorrelationId);
    }

    payload.controlApi = {
      service: "control-api",
      status: controlApiResponse.ok ? "ok" : "error",
      httpStatus: controlApiResponse.status,
      requestId: controlApiRequestId,
      correlationId: controlApiCorrelationId,
      timestamp: typeof controlApiPayload?.timestamp === "string" ? controlApiPayload.timestamp : null,
    };
  } catch (error) {
    payload.controlApi = {
      service: "control-api",
      status: "unavailable",
      message: error instanceof Error ? error.message : "Unable to reach control-api",
    };
  }

  return Response.json(payload, {
    headers: responseHeaders,
  });
}
