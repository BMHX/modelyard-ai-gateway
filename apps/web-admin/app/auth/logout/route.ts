import { NextRequest, NextResponse } from "next/server";

import { controlPlaneSessionCookieName } from "@/app/lib/control-plane-auth";
import { buildRequestScopedUrl } from "@/app/lib/auth-redirect";
import { buildControlApiHeaders, getControlApiBaseUrl } from "@/app/lib/control-api";

export async function POST(request: NextRequest) {
  await fetch(`${getControlApiBaseUrl()}/v1/auth/logout`, {
    method: "POST",
    headers: await buildControlApiHeaders({
      accept: "application/json",
    }),
    cache: "no-store",
  }).catch(() => null);

  const loginUrl = buildRequestScopedUrl(request, "/login");

  const response = NextResponse.redirect(loginUrl, { status: 303 });
  response.cookies.set(controlPlaneSessionCookieName, "", {
    httpOnly: true,
    maxAge: 0,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });

  return response;
}
