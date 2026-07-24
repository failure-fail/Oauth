import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { mintAccessToken } from "@/lib/oauth-server";
import { config } from "@/lib/config";

/** Short-lived Failure access token for dashboard OpenAI /v1 testing. */
export async function POST() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const accessToken = await mintAccessToken({
    userId: user.id,
    clientId: "fail_dashboard",
    scope: "openid profile email providers",
    email: user.email,
    name: user.name,
  });
  return NextResponse.json({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: config.accessTokenTtlSec,
    scope: "openid profile email providers",
    base_url: `${config.baseUrl.replace(/\/$/, "")}/v1`,
    note: "Dashboard test token — use as OPENAI_API_KEY against /v1. Not a refresh token.",
  });
}
