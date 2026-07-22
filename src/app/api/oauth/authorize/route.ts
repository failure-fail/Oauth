import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import {
  issueAuthorizationCode,
  validateRedirectUri,
} from "@/lib/oauth-server";

const schema = z.object({
  client_id: z.string(),
  redirect_uri: z.string().url(),
  response_type: z.literal("code"),
  scope: z.string().default("openid profile email providers offline_access"),
  state: z.string().optional(),
  code_challenge: z.string().min(43).max(128),
  code_challenge_method: z.enum(["S256", "plain"]).default("S256"),
});

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "login_required" }, { status: 401 });
  }
  try {
    const body = schema.parse(await req.json());
    const client = db.findClientByClientId(body.client_id);
    if (!client) {
      return NextResponse.json({ error: "invalid_client" }, { status: 400 });
    }
    if (!validateRedirectUri(client.redirectUris, body.redirect_uri)) {
      return NextResponse.json(
        { error: "invalid_request", error_description: "redirect_uri mismatch" },
        { status: 400 },
      );
    }
    const code = issueAuthorizationCode({
      clientId: client.clientId,
      userId: user.id,
      redirectUri: body.redirect_uri,
      codeChallenge: body.code_challenge,
      codeChallengeMethod: body.code_challenge_method,
      scope: body.scope,
    });
    const url = new URL(body.redirect_uri);
    url.searchParams.set("code", code);
    if (body.state) url.searchParams.set("state", body.state);
    return NextResponse.json({
      redirectTo: url.toString(),
      code,
      appName: client.name,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Authorization failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
