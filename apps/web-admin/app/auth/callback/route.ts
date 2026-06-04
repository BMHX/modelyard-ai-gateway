import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { AuthLoginCallbackResponseSchema } from "@teamops/contracts";

import { AuthIdentityOptionSchema, getIdentityRoleOptions } from "@/app/lib/auth-identities";
import { controlPlaneSessionCookieName } from "@/app/lib/control-plane-auth";
import { buildRequestScopedCurrentUrl, buildRequestScopedUrl } from "@/app/lib/auth-redirect";
import { buildControlApiHeaders, getControlApiBaseUrl } from "@/app/lib/control-api";

type LoginRedirectParams = {
  error: string;
  errorCode?: string | null;
  errorStage?: string | null;
  organizationSlug?: string | null;
  returnTo?: string | null;
  requestId?: string | null;
  correlationId?: string | null;
};

function buildLoginRedirect(request: NextRequest, params: LoginRedirectParams) {
  const loginUrl = buildRequestScopedCurrentUrl(request);
  loginUrl.pathname = "/login";
  loginUrl.searchParams.delete("code");
  loginUrl.searchParams.delete("state");
  loginUrl.searchParams.set("error", params.error);
  if (params.errorCode) {
    loginUrl.searchParams.set("errorCode", params.errorCode);
  }
  if (params.errorStage) {
    loginUrl.searchParams.set("errorStage", params.errorStage);
  }
  if (params.organizationSlug) {
    loginUrl.searchParams.set("org", params.organizationSlug);
  }
  if (params.returnTo) {
    loginUrl.searchParams.set("returnTo", params.returnTo);
  }
  if (params.requestId) {
    loginUrl.searchParams.set("requestId", params.requestId);
  }
  if (params.correlationId) {
    loginUrl.searchParams.set("correlationId", params.correlationId);
  }
  return NextResponse.redirect(loginUrl);
}

async function shouldPromptForIdentitySelection(sessionHandle: string) {
  try {
    const response = await fetch(`${getControlApiBaseUrl()}/v1/auth/session/identities`, {
      headers: await buildControlApiHeaders({
        accept: "application/json",
        "x-teamops-web-admin-auth": `session ${sessionHandle}`,
      }),
      cache: "no-store",
    });

    if (!response.ok) {
      return false;
    }

    const identities = z.array(AuthIdentityOptionSchema).parse(await response.json());
    return getIdentityRoleOptions(identities).length > 1;
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code")?.trim() ?? "";
  const state = request.nextUrl.searchParams.get("state")?.trim() ?? "";

  if (!code || !state) {
    return buildLoginRedirect(request, {
      error: "The OIDC callback is incomplete.",
      errorCode: "OIDC_CALLBACK_INCOMPLETE",
      errorStage: "oidc_callback",
    });
  }

  let response: Response;
  try {
    response = await fetch(`${getControlApiBaseUrl()}/v1/auth/login/callback`, {
      method: "POST",
      headers: await buildControlApiHeaders({
        accept: "application/json",
        "content-type": "application/json",
      }),
      cache: "no-store",
      body: JSON.stringify({
        code,
        state,
      }),
    });
  } catch {
    return buildLoginRedirect(request, {
      error: "Unable to reach the Control API. Start control-api and try again.",
      errorCode: "AUTH_CALLBACK_UNAVAILABLE",
      errorStage: "oidc_callback",
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
      error: payload?.error?.message ?? "OIDC sign-in failed.",
      errorCode: payload?.error?.code ?? null,
      errorStage: payload?.error?.details?.authStage ?? "oidc_callback",
      organizationSlug: payload?.error?.details?.organizationSlug ?? null,
      returnTo: payload?.error?.details?.returnTo ?? null,
      requestId: response.headers.get("x-request-id"),
      correlationId: response.headers.get("x-correlation-id"),
    });
  }

  const payload = AuthLoginCallbackResponseSchema.parse(await response.json());
  const requiresIdentitySelection = await shouldPromptForIdentitySelection(
    payload.sessionHandle,
  );
  const redirectUrl = requiresIdentitySelection
    ? buildRequestScopedUrl(
        request,
        `/auth/select-identity?returnTo=${encodeURIComponent(payload.returnTo)}`,
      )
    : buildRequestScopedUrl(request, payload.returnTo);
  const nextResponse = NextResponse.redirect(redirectUrl);
  nextResponse.cookies.set(controlPlaneSessionCookieName, payload.sessionHandle, {
    httpOnly: true,
    maxAge: 12 * 60 * 60,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });

  return nextResponse;
}
