import { NextRequest, NextResponse } from "next/server";
import { getControlApiBaseUrl, buildControlApiHeadersForRequest } from "@/app/lib/control-api";
import { AuthSelectIdentityInputSchema } from "@/app/lib/auth-identities";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const input = AuthSelectIdentityInputSchema.parse(body);

    const response = await fetch(`${getControlApiBaseUrl()}/v1/auth/session/active-identity`, {
      method: "POST",
      headers: await buildControlApiHeadersForRequest(request, {
        "content-type": "application/json",
      }),
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return NextResponse.json(errorData, { status: response.status });
    }

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
