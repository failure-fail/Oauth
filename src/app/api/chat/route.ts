import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { db } from "@/lib/db";
import { runProviderChat } from "@/lib/chat";
import type { ProviderId } from "@/lib/config";

const chatSchema = z.object({
  provider: z.enum(["codex", "chatgpt", "claude", "grok"]),
  prompt: z.string().min(1).max(4000),
  model: z.string().min(1).optional(),
});

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const body = chatSchema.parse(await req.json());
    const conn = await db.getConnection(user.id, body.provider as ProviderId);
    if (!conn || conn.status !== "connected") {
      return NextResponse.json(
        { error: `${body.provider} is not connected` },
        { status: 400 },
      );
    }
    const result = await runProviderChat({
      provider: body.provider,
      connection: conn,
      prompt: body.prompt,
      model: body.model,
    });
    return NextResponse.json({
      provider: body.provider,
      model: result.model,
      models: result.models,
      text: result.text,
      providerLabel: result.providerLabel,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Chat failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
