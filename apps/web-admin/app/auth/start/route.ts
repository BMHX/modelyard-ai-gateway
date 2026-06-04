import { NextRequest, NextResponse } from "next/server";

import { AuthLoginStartResponseSchema } from "@teamops/contracts";

import { buildRequestScopedCurrentUrl } from "@/app/lib/auth-redirect";
import { buildControlApiHeaders, getControlApiBaseUrl } from "@/app/lib/control-api";
import { getSafeReturnTo } from "@/app/lib/navigation";

type LoginRedirectParams = {
  org?: string | null;
  returnTo?: string | null;
  error?: string | null;
  errorCode?: string | null;
  errorStage?: string | null;
  requestId?: string | null;
  correlationId?: string | null;
};

function buildLoginRedirect(request: NextRequest, params: LoginRedirectParams) {
  const loginUrl = buildRequestScopedCurrentUrl(request);
  loginUrl.pathname = "/login";
  loginUrl.searchParams.delete("org");
  loginUrl.searchParams.delete("returnTo");
  loginUrl.searchParams.delete("error");
  loginUrl.searchParams.delete("errorCode");
  loginUrl.searchParams.delete("errorStage");
  loginUrl.searchParams.delete("requestId");
  loginUrl.searchParams.delete("correlationId");

  if (params.org) {
    loginUrl.searchParams.set("org", params.org);
  }
  if (params.returnTo) {
    loginUrl.searchParams.set("returnTo", params.returnTo);
  }
  if (params.error) {
    loginUrl.searchParams.set("error", params.error);
  }
  if (params.errorCode) {
    loginUrl.searchParams.set("errorCode", params.errorCode);
  }
  if (params.errorStage) {
    loginUrl.searchParams.set("errorStage", params.errorStage);
  }
  if (params.requestId) {
    loginUrl.searchParams.set("requestId", params.requestId);
  }
  if (params.correlationId) {
    loginUrl.searchParams.set("correlationId", params.correlationId);
  }

  return NextResponse.redirect(loginUrl);
}

export async function GET(request: NextRequest) {
  const organizationSlug = request.nextUrl.searchParams.get("org")?.trim() ?? "";
  const returnTo = getSafeReturnTo(request.nextUrl.searchParams.get("returnTo")) ?? "/";

  if (!organizationSlug) {
    return buildLoginRedirect(request, {
      returnTo,
      error: "Organization slug is required.",
    });
  }

  let response: Response;
  try {
    response = await fetch(`${getControlApiBaseUrl()}/v1/auth/login/start`, {
      method: "POST",
      headers: await buildControlApiHeaders({
        accept: "application/json",
        "content-type": "application/json",
      }),
      cache: "no-store",
      body: JSON.stringify({
        organizationSlug,
        returnTo,
      }),
    });
  } catch {
    return buildLoginRedirect(request, {
      org: organizationSlug,
      returnTo,
      error: "Unable to reach the Control API. Start control-api and try again.",
    });
  }

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: {
        message?: string;
        code?: string;
        details?: {
          authStage?: string;
          organizationSlug?: string;
          returnTo?: string;
        };
      };
    } | null;
    return buildLoginRedirect(request, {
      org: payload?.error?.details?.organizationSlug ?? organizationSlug,
      returnTo: payload?.error?.details?.returnTo ?? returnTo,
      error: payload?.error?.message ?? "Unable to start OIDC sign-in.",
      errorCode: payload?.error?.code ?? null,
      errorStage: payload?.error?.details?.authStage ?? "oidc_start",
      requestId: response.headers.get("x-request-id"),
      correlationId: response.headers.get("x-correlation-id"),
    });
  }

  const payload = AuthLoginStartResponseSchema.parse(await response.json());
  return NextResponse.redirect(payload.authorizationUrl);
}
