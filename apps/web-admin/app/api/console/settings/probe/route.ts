import { NextRequest, NextResponse } from "next/server";

import {
  buildGatewayDirectUrl,
  type EditableConsoleRuntimeSettings,
  validateConsoleRuntimeSettings,
} from "@/app/lib/console-settings";

function buildErrorResponse(message: string, status = 400) {
  return NextResponse.json(
    {
      error: {
        code: "INVALID_SETTINGS_PROBE",
        message,
      },
    },
    { status },
  );
}

function parseSettingsBody(body: unknown): EditableConsoleRuntimeSettings {
  if (!body || typeof body !== "object") {
    throw new Error("Settings payload is required.");
  }

  const candidate = body as Record<string, unknown>;
  const fields = [
    "gatewayBaseUrl",
    "gatewayRequestBasePath",
    "gatewayChatCompletionsPath",
    "gatewayResponsesPath",
    "gatewayModelsPath",
    "gatewayHealthPath",
  ] as const;

  for (const field of fields) {
    if (typeof candidate[field] !== "string") {
      throw new Error(`Field "${field}" must be a string.`);
    }
  }

  if (
    typeof candidate.gatewayRequestTimeoutMs !== "number" &&
    typeof candidate.gatewayRequestTimeoutMs !== "string"
  ) {
    throw new Error('Field "gatewayRequestTimeoutMs" must be a number.');
  }

  return {
    gatewayBaseUrl: candidate.gatewayBaseUrl as string,
    gatewayRequestBasePath: candidate.gatewayRequestBasePath as string,
    gatewayChatCompletionsPath: candidate.gatewayChatCompletionsPath as string,
    gatewayResponsesPath: candidate.gatewayResponsesPath as string,
    gatewayModelsPath: candidate.gatewayModelsPath as string,
    gatewayHealthPath: candidate.gatewayHealthPath as string,
    gatewayRequestTimeoutMs: candidate.gatewayRequestTimeoutMs as number,
  };
}

async function readJson(response: Response) {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return buildErrorResponse("Settings payload must be valid JSON.");
  }

  let settings: EditableConsoleRuntimeSettings;

  try {
    settings = validateConsoleRuntimeSettings(parseSettingsBody(body));
  } catch (error) {
    return buildErrorResponse(
      error instanceof Error ? error.message : "Settings payload is invalid.",
    );
  }

  const url = buildGatewayDirectUrl(settings, settings.gatewayHealthPath);
  const startedAt = Date.now();

  try {
    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(settings.gatewayRequestTimeoutMs),
      headers: {
        accept: "application/json, text/plain;q=0.9, */*;q=0.8",
      },
    });
    const payload = await readJson(response);

    return NextResponse.json({
      ok: response.ok,
      url,
      durationMs: Date.now() - startedAt,
      httpStatus: response.status,
      service: typeof payload?.service === "string" ? payload.service : null,
      timestamp: typeof payload?.timestamp === "string" ? payload.timestamp : null,
      message:
        typeof payload?.message === "string"
          ? payload.message
          : response.ok
            ? null
            : `Gateway health probe returned ${response.status}.`,
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      url,
      durationMs: Date.now() - startedAt,
      httpStatus: null,
      service: null,
      timestamp: null,
      message:
        error instanceof Error ? error.message : "Gateway health probe failed.",
    });
  }
}
