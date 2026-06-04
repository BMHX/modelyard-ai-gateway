import { NextRequest, NextResponse } from "next/server";

import { AuthLoginCallbackResponseSchema } from "@teamops/contracts";

import { controlPlaneSessionCookieName } from "@/app/lib/control-plane-auth";
import { buildControlApiHeaders, getControlApiBaseUrl } from "@/app/lib/control-api";
import { buildRequestScopedCurrentUrl, buildRequestScopedUrl } from "@/app/lib/auth-redirect";
import { getSafeReturnTo } from "@/app/lib/navigation";

function buildLoginRedirect(
  request: NextRequest,
  args: {
    org?: string | null;
    error: string;
    returnTo?: string | null;
  },
) {
  const loginUrl = buildRequestScopedCurrentUrl(request);
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  if (args.org) {
    loginUrl.searchParams.set("org", args.org);
  }
  if (args.returnTo) {
    loginUrl.searchParams.set("returnTo", args.returnTo);
  }
  loginUrl.searchParams.set("error", args.error);
  return NextResponse.redirect(loginUrl, { status: 303 });
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const organizationSlug = String(formData.get("org") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const returnTo = getSafeReturnTo(String(formData.get("returnTo") ?? "")) ?? "/";

  if (!organizationSlug || !email) {
    return buildLoginRedirect(request, {
      org: organizationSlug,
      returnTo,
      error: "Test login requires both organization slug and email.",
    });
  }

  const response = await fetch(`${getControlApiBaseUrl()}/v1/auth/test-login`, {
    method: "POST",
    headers: await buildControlApiHeaders({
      accept: "application/json",
      "content-type": "application/json",
    }),
    cache: "no-store",
    body: JSON.stringify({
      organizationSlug,
      email,
      returnTo,
    }),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
    return buildLoginRedirect(request, {
      org: organizationSlug,
      returnTo,
      error: payload?.error?.message ?? "Test login failed.",
    });
  }

  const payload = AuthLoginCallbackResponseSchema.parse(await response.json());
  const redirectUrl = buildRequestScopedUrl(request, payload.returnTo);
  const nextResponse = NextResponse.redirect(redirectUrl, { status: 303 });
  nextResponse.cookies.set(controlPlaneSessionCookieName, payload.sessionHandle, {
    httpOnly: true,
    maxAge: 12 * 60 * 60,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });

  return nextResponse;
}
