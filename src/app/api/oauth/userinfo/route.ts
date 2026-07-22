import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyAccessToken } from "@/lib/oauth-server";
import { connectionPublicView, readProviderSecret } from "@/lib/providers";

export async function GET(req: Request) {
  const header = req.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) {
    return NextResponse.json({ error: "invalid_token" }, { status: 401 });
  }
  try {
    const payload = await verifyAccessToken(token);
    const userId = String(payload.sub || "");
    const user = db.findUserById(userId);
    if (!user) {
      return NextResponse.json({ error: "invalid_token" }, { status: 401 });
    }
    const scope = String(payload.scope || "");
    const connections = db.listConnections(user.id).map(connectionPublicView);
    const providersDetailed = scope.includes("providers")
      ? db.listConnections(user.id).map((c) => {
          const secret = readProviderSecret(c.encryptedPayload);
          return {
            ...connectionPublicView(c),
            credentials: {
              type: secret.type,
              hasAccessToken: Boolean(secret.accessToken),
              hasRefreshToken: Boolean(secret.refreshToken),
              hasAccountKey: Boolean(secret.accountKey),
              hasSetupToken: Boolean(secret.setupToken),
              expiresAt: secret.expiresAt ?? null,
              // Apps receive usable credentials when providers scope is granted
              accessToken: secret.accessToken ?? null,
              refreshToken: secret.refreshToken ?? null,
              accountKey: secret.accountKey ?? null,
              setupToken: secret.setupToken ?? null,
            },
          };
        })
      : connections;

    return NextResponse.json({
      sub: user.id,
      email: user.email,
      name: user.name,
      providers: providersDetailed,
    });
  } catch {
    return NextResponse.json({ error: "invalid_token" }, { status: 401 });
  }
}
