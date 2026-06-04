import { NextRequest, NextResponse } from "next/server";
import { getControlApiBaseUrl, buildControlApiHeaders } from "@/app/lib/control-api";
import { z } from "zod";

import { AuthIdentityOptionSchema } from "@/app/lib/auth-identities";

export async function GET(request: NextRequest) {
  try {
    const response = await fetch(`${getControlApiBaseUrl()}/v1/auth/session/identities`, {
      headers: await buildControlApiHeaders({
        accept: "application/json",
      }),
    });

    if (!response.ok) {
      return NextResponse.json({ error: "Failed to fetch identities" }, { status: response.status });
    }

    const data = z.array(AuthIdentityOptionSchema).parse(await response.json());
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
