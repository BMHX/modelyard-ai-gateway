import { NextResponse, type NextRequest } from "next/server";

import { markSavedViewOpened } from "../../../lib/control-api";
import { getSafeReturnTo } from "../../../lib/navigation";
import { getTrustedRequestOrigin } from "../../../lib/request-origin";

export const dynamic = "force-dynamic";

const REDIRECT_RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
} as const;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ savedViewId: string }> },
) {
  const { savedViewId } = await params;
  const nextHref = getSafeReturnTo(request.nextUrl.searchParams.get("next"));
  const redirectTarget = nextHref ?? "/";
  const redirectUrl = new URL(redirectTarget, getTrustedRequestOrigin(request) ?? request.nextUrl.origin);

  return NextResponse.redirect(redirectUrl, {
    status: 303,
    headers: REDIRECT_RESPONSE_HEADERS,
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ savedViewId: string }> },
) {
  const { savedViewId } = await params;

  try {
    await markSavedViewOpened(savedViewId);
  } catch (error) {
    console.error("[saved-view-open] Unable to mark saved view as opened", {
      savedViewId,
      redirectTarget: request.nextUrl.searchParams.get("next") ?? "/",
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return new NextResponse(null, {
    status: 204,
    headers: REDIRECT_RESPONSE_HEADERS,
  });
}
