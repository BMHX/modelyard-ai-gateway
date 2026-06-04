import { NextRequest, NextResponse } from "next/server";

import {
  saveConsoleWorkspaceDefaults,
  type EditableConsoleWorkspaceDefaults,
} from "@/app/lib/console-settings";

function buildErrorResponse(message: string, status = 400) {
  return NextResponse.json(
    {
      error: {
        code: "INVALID_WORKSPACE_DEFAULTS",
        message,
      },
    },
    { status },
  );
}

function parseWorkspaceDefaultsBody(body: unknown): {
  workspaceId: string;
  defaults: EditableConsoleWorkspaceDefaults;
} {
  if (!body || typeof body !== "object") {
    throw new Error("Workspace defaults payload is required.");
  }

  const candidate = body as Record<string, unknown>;

  if (typeof candidate.workspaceId !== "string") {
    throw new Error('Field "workspaceId" must be a string.');
  }

  return {
    workspaceId: candidate.workspaceId,
    defaults: {
      defaultProviderConnectionId:
        typeof candidate.defaultProviderConnectionId === "string"
          ? candidate.defaultProviderConnectionId
          : null,
      defaultModelCatalogSourceHint:
        typeof candidate.defaultModelCatalogSourceHint === "string"
          ? candidate.defaultModelCatalogSourceHint
          : null,
      defaultVirtualKeyTtlHours:
        typeof candidate.defaultVirtualKeyTtlHours === "number" ||
        typeof candidate.defaultVirtualKeyTtlHours === "string"
          ? Number(candidate.defaultVirtualKeyTtlHours)
          : 24,
      defaultVirtualKeyScopesTemplate: Array.isArray(
        candidate.defaultVirtualKeyScopesTemplate,
      )
        ? candidate.defaultVirtualKeyScopesTemplate.filter(
            (entry): entry is string => typeof entry === "string",
          )
        : [],
      defaultProjectId:
        typeof candidate.defaultProjectId === "string"
          ? candidate.defaultProjectId
          : null,
    },
  };
}

export async function POST(request: NextRequest) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return buildErrorResponse("Workspace defaults payload must be valid JSON.");
  }

  let payload: {
    workspaceId: string;
    defaults: EditableConsoleWorkspaceDefaults;
  };

  try {
    payload = parseWorkspaceDefaultsBody(body);
  } catch (error) {
    return buildErrorResponse(
      error instanceof Error
        ? error.message
        : "Workspace defaults payload is invalid.",
    );
  }

  try {
    const settings = await saveConsoleWorkspaceDefaults(
      payload.workspaceId,
      payload.defaults,
    );
    return NextResponse.json(settings, {
      headers: {
        "cache-control": "private, no-store, max-age=0",
      },
    });
  } catch (error) {
    return buildErrorResponse(
      error instanceof Error ? error.message : "Unable to save workspace defaults.",
      500,
    );
  }
}
