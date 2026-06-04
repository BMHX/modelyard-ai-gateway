import { NextRequest, NextResponse } from "next/server";
import type { ProviderConnection } from "@teamops/contracts";

import {
  listProviderConnections,
  loadWorkspaceSelectionWithOptimisticData,
  diagnoseControlApiIssue,
  pickFirstControlApiIssue,
} from "@/app/lib/control-api";
import { buildWorkspaceScopedConsoleResponse } from "@/app/lib/console-api-server";

export async function GET(request: NextRequest) {
  const workspaceSelection = await loadWorkspaceSelectionWithOptimisticData(
    request.nextUrl.searchParams.get("workspaceId"),
    listProviderConnections,
  );

  let issue = workspaceSelection.issue;
  let providerConnections: ProviderConnection[] = [];

  if (workspaceSelection.selectedWorkspaceId) {
    if (workspaceSelection.dataResult?.ok) {
      providerConnections = workspaceSelection.dataResult.data;
    } else if (workspaceSelection.dataResult) {
      issue = pickFirstControlApiIssue(
        issue,
        diagnoseControlApiIssue(workspaceSelection.dataResult.error),
      );
    }
  }

  return NextResponse.json(
    {
      ...buildWorkspaceScopedConsoleResponse({
        ...workspaceSelection,
        issue,
      }),
      providerConnections,
    },
    {
      headers: {
        "cache-control": "private, no-store, max-age=0",
      },
    },
  );
}
