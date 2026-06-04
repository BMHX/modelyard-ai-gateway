import { NextRequest, NextResponse } from "next/server";

import {
  saveConsoleRuntimeSettings,
  type EditableConsoleRuntimeSettings,
} from "@/app/lib/console-settings";

function buildErrorResponse(message: string, status = 400) {
  return NextResponse.json(
    {
      error: {
        code: "INVALID_RUNTIME_SETTINGS",
        message,
      },
    },
    { status },
  );
}

function parseRuntimeBody(body: unknown): EditableConsoleRuntimeSettings {
  if (!body || typeof body !== "object") {
    throw new Error("Runtime settings payload is required.");
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
    gatewayRequestTimeoutMs: Number(candidate.gatewayRequestTimeoutMs),
  };
}

export async function POST(request: NextRequest) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return buildErrorResponse("Runtime settings payload must be valid JSON.");
  }

  let input: EditableConsoleRuntimeSettings;

  try {
    input = parseRuntimeBody(body);
  } catch (error) {
    return buildErrorResponse(
      error instanceof Error ? error.message : "Runtime settings payload is invalid.",
    );
  }

  try {
    const payload = await saveConsoleRuntimeSettings(input);
    return NextResponse.json(payload, {
      headers: {
        "cache-control": "private, no-store, max-age=0",
      },
    });
  } catch (error) {
    return buildErrorResponse(
      error instanceof Error ? error.message : "Unable to save runtime settings.",
      500,
    );
  }
}
