import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { db } from "@/lib/db";
import { listProviderModels } from "@/lib/chat";
import type { ProviderId } from "@/lib/config";

const schema = z.object({
  provider: z.enum(["codex", "chatgpt", "claude", "grok"]),
});

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const provider = new URL(req.url).searchParams.get("provider");
    const body = schema.parse({ provider });
    const conn = await db.getConnection(user.id, body.provider as ProviderId);
    if (!conn || conn.status !== "connected") {
      return NextResponse.json(
        { error: `${body.provider} is not connected` },
        { status: 400 },
      );
    }
    const models = await listProviderModels({
      provider: body.provider,
      encryptedPayload: conn.encryptedPayload,
    });
    return NextResponse.json({
      provider: body.provider,
      models,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to list models";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
