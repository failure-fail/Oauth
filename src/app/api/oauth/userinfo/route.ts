import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyAccessToken } from "@/lib/oauth-server";
import {
  connectionPublicView,
  ensureFreshConnection,
  exposeProviderCredentials,
} from "@/lib/providers";
import type { ProviderId } from "@/lib/config";

export async function GET(req: Request) {
  const header = req.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) {
    return NextResponse.json({ error: "invalid_token" }, { status: 401 });
  }
  try {
    const payload = await verifyAccessToken(token);
    const userId = String(payload.sub || "");
    const user = await db.findUserById(userId);
    if (!user) {
      return NextResponse.json({ error: "invalid_token" }, { status: 401 });
    }
    const scope = String(payload.scope || "");
    const userConnections = await db.listConnections(user.id);
    const connections = userConnections.map(connectionPublicView);

    if (!scope.includes("providers")) {
      return NextResponse.json({
        sub: user.id,
        email: user.email,
        name: user.name,
        providers: connections,
      });
    }

    const providers = [];
    for (const conn of userConnections) {
      const base = connectionPublicView(conn);
      try {
        const { secret } = await ensureFreshConnection(conn);
        providers.push({
          ...base,
          credentials: exposeProviderCredentials(
            conn.provider as ProviderId,
            secret,
          ),
        });
      } catch (error) {
        providers.push({
          ...base,
          credentials: {
            error:
              error instanceof Error
                ? error.message
                : "Failed to refresh provider credentials",
            reconnectRequired: true,
          },
        });
      }
    }

    return NextResponse.json({
      sub: user.id,
      email: user.email,
      name: user.name,
      providers,
    });
  } catch {
    return NextResponse.json({ error: "invalid_token" }, { status: 401 });
  }
}
