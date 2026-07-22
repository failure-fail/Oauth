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
  thinkingLevel: z
    .enum(["none", "minimal", "low", "medium", "high", "xhigh", "max"])
    .optional(),
  includeThinking: z.boolean().optional(),
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
      thinkingLevel: body.thinkingLevel,
      includeThinking: body.includeThinking,
    });
    return NextResponse.json({
      provider: body.provider,
      model: result.model,
      models: result.models,
      text: result.text,
      thinking: "thinking" in result ? result.thinking : undefined,
      providerLabel: result.providerLabel,
      transport: "transport" in result ? result.transport : undefined,
      warning: "warning" in result ? result.warning : undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Chat failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
