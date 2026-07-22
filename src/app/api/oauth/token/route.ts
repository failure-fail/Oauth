import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import {
  hashToken,
  issueRefreshToken,
  mintAccessToken,
  verifyPkce,
} from "@/lib/oauth-server";
import { config } from "@/lib/config";

async function authenticateClient(
  req: Request,
  form: URLSearchParams,
): Promise<{ clientId: string; ok: boolean; publicClient: boolean } | null> {
  const basic = req.headers.get("authorization");
  let clientId = form.get("client_id") || "";
  let clientSecret = form.get("client_secret") || "";
  if (basic?.startsWith("Basic ")) {
    const decoded = Buffer.from(basic.slice(6), "base64").toString("utf8");
    const [id, secret] = decoded.split(":");
    clientId = id || clientId;
    clientSecret = secret || clientSecret;
  }
  if (!clientId) return null;
  const client = await db.findClientByClientId(clientId);
  if (!client) return null;
  if (client.public) {
    return { clientId, ok: true, publicClient: true };
  }
  if (!client.clientSecretHash || !clientSecret) {
    return { clientId, ok: false, publicClient: false };
  }
  const ok = await bcrypt.compare(clientSecret, client.clientSecretHash);
  return { clientId, ok, publicClient: false };
}

export async function POST(req: Request) {
  const form = new URLSearchParams(await req.text());
  const grantType = form.get("grant_type");
  const auth = await authenticateClient(req, form);
  if (!auth?.ok) {
    return NextResponse.json(
      { error: "invalid_client" },
      { status: 401 },
    );
  }
  const client = await db.findClientByClientId(auth.clientId);
  if (!client) {
    return NextResponse.json({ error: "invalid_client" }, { status: 401 });
  }

  if (grantType === "authorization_code") {
    const code = form.get("code") || "";
    const redirectUri = form.get("redirect_uri") || "";
    const codeVerifier = form.get("code_verifier") || "";
    if (!code || !redirectUri || !codeVerifier) {
      return NextResponse.json(
        { error: "invalid_request", error_description: "Missing required params" },
        { status: 400 },
      );
    }
    const authCode = await db.consumeAuthCode(code);
    if (!authCode) {
      return NextResponse.json({ error: "invalid_grant" }, { status: 400 });
    }
    if (
      authCode.clientId !== client.clientId ||
      authCode.redirectUri !== redirectUri
    ) {
      return NextResponse.json({ error: "invalid_grant" }, { status: 400 });
    }
    if (
      !verifyPkce(
        codeVerifier,
        authCode.codeChallenge,
        authCode.codeChallengeMethod,
      )
    ) {
      return NextResponse.json(
        { error: "invalid_grant", error_description: "PKCE verification failed" },
        { status: 400 },
      );
    }
    const user = await db.findUserById(authCode.userId);
    if (!user) {
      return NextResponse.json({ error: "invalid_grant" }, { status: 400 });
    }
    const accessToken = await mintAccessToken({
      userId: user.id,
      clientId: client.clientId,
      scope: authCode.scope,
      email: user.email,
      name: user.name,
    });
    const refreshToken = authCode.scope.includes("offline_access")
      ? await issueRefreshToken({
          clientId: client.clientId,
          userId: user.id,
          scope: authCode.scope,
        })
      : undefined;
    return NextResponse.json({
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: config.accessTokenTtlSec,
      refresh_token: refreshToken,
      scope: authCode.scope,
    });
  }

  if (grantType === "refresh_token") {
    const refresh = form.get("refresh_token") || "";
    const row = await db.findRefreshToken(hashToken(refresh));
    if (!row || row.clientId !== client.clientId) {
      return NextResponse.json({ error: "invalid_grant" }, { status: 400 });
    }
    const user = await db.findUserById(row.userId);
    if (!user) {
      return NextResponse.json({ error: "invalid_grant" }, { status: 400 });
    }
    await db.revokeRefreshToken(hashToken(refresh));
    const accessToken = await mintAccessToken({
      userId: user.id,
      clientId: client.clientId,
      scope: row.scope,
      email: user.email,
      name: user.name,
    });
    const newRefresh = await issueRefreshToken({
      clientId: client.clientId,
      userId: user.id,
      scope: row.scope,
    });
    return NextResponse.json({
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: config.accessTokenTtlSec,
      refresh_token: newRefresh,
      scope: row.scope,
    });
  }

  return NextResponse.json(
    { error: "unsupported_grant_type" },
    { status: 400 },
  );
}

export async function GET() {
  return NextResponse.json({
    message: "POST with grant_type=authorization_code|refresh_token",
  });
}
