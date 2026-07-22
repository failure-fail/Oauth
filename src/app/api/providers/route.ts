import { NextResponse } from "next/server";
import { z } from "zod";
import { PROVIDERS, type ProviderId } from "@/lib/config";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import {
  completeCodexDesktopOAuth,
  connectChatGptTokens,
  connectClaudeSetupToken,
  connectionPublicView,
  pollGrokDeviceOAuth,
  startCodexDesktopOAuth,
  startGrokDeviceOAuth,
} from "@/lib/providers";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const connections = (await db.listConnections(user.id)).map(
    connectionPublicView,
  );
  return NextResponse.json({
    providers: PROVIDERS,
    connections,
  });
}

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("codex_start"),
  }),
  z.object({
    action: z.literal("codex_complete"),
    flowId: z.string(),
    callbackUrlOrCode: z.string().min(1),
  }),
  z.object({
    action: z.literal("chatgpt_connect"),
    accessToken: z.string().min(1),
    refreshToken: z.string().optional(),
    expiresAt: z.number().optional(),
    accountId: z.string().optional(),
  }),
  z.object({
    action: z.literal("claude_connect"),
    setupToken: z.string().min(1),
    acknowledgeRisk: z.literal(true),
  }),
  z.object({
    action: z.literal("grok_start"),
  }),
  z.object({
    action: z.literal("grok_poll"),
    flowId: z.string(),
  }),
  z.object({
    action: z.literal("disconnect"),
    provider: z.enum(["codex", "chatgpt", "claude", "grok"]),
  }),
]);

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const body = actionSchema.parse(await req.json());
    switch (body.action) {
      case "codex_start": {
        const flow = await startCodexDesktopOAuth(user.id);
        return NextResponse.json(flow);
      }
      case "codex_complete": {
        const conn = await completeCodexDesktopOAuth({
          userId: user.id,
          flowId: body.flowId,
          callbackUrlOrCode: body.callbackUrlOrCode,
        });
        return NextResponse.json({ connection: connectionPublicView(conn) });
      }
      case "chatgpt_connect": {
        const conn = await connectChatGptTokens(user.id, body);
        return NextResponse.json({ connection: connectionPublicView(conn) });
      }
      case "claude_connect": {
        const conn = await connectClaudeSetupToken(user.id, body.setupToken);
        return NextResponse.json({ connection: connectionPublicView(conn) });
      }
      case "grok_start": {
        const flow = await startGrokDeviceOAuth(user.id);
        return NextResponse.json(flow);
      }
      case "grok_poll": {
        const result = await pollGrokDeviceOAuth({
          userId: user.id,
          flowId: body.flowId,
        });
        return NextResponse.json(result);
      }
      case "disconnect": {
        await db.deleteConnection(user.id, body.provider as ProviderId);
        return NextResponse.json({ ok: true });
      }
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Provider action failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
