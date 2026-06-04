import { NextRequest } from "next/server";

import {
  getPreferredWorkspaceIdFromCookieHeader,
  resolveAdminSurfaceAccess,
} from "@/app/lib/admin-surface";
import { loadWorkspacesPageData } from "@/app/workspaces/workspaces-page-data";
import { jsonWithPrivateWatermark } from "@/app/lib/private-response-watermark";
import { runWithRequestTrace } from "@/app/lib/request-trace";

function getOptionalFilter(value: string | null) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export async function GET(request: NextRequest) {
  return runWithRequestTrace(request.headers, async () => {
    const organizationId = getOptionalFilter(request.nextUrl.searchParams.get("organizationId"));
    const requestedWorkspaceId = getOptionalFilter(request.nextUrl.searchParams.get("workspaceId"));
    const surfaceAccess = await resolveAdminSurfaceAccess({
      requestedWorkspaceId,
      preferredWorkspaceId: getPreferredWorkspaceIdFromCookieHeader(request.headers.get("cookie")),
    });

    if (!surfaceAccess.capabilities.canAccessAdminSurfaces) {
      return jsonWithPrivateWatermark(
        request,
        {
          error: {
            code: "FORBIDDEN",
            message: "Admin surface access is required for this route",
          },
        },
        {
          status: 403,
          surface: "console.workspaces",
          extraContext: {
            organizationId,
          },
        },
      );
    }

    const payload = await loadWorkspacesPageData(organizationId);

    return jsonWithPrivateWatermark(request, payload, {
      surface: "console.workspaces",
      extraContext: {
        organizationId,
      },
    });
  });
}
