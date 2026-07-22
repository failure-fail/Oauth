import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { db } from "@/lib/db";
import { editCodexImage, generateCodexImage } from "@/lib/codex-client";
import { ensureFreshConnection } from "@/lib/providers";
import type { ProviderId } from "@/lib/config";

const generateSchema = z.object({
  action: z.literal("generate"),
  provider: z.enum(["codex", "chatgpt"]),
  prompt: z.string().min(1).max(4000),
  size: z.string().optional(),
  quality: z.enum(["low", "medium", "high"]).optional(),
  background: z.enum(["transparent", "opaque", "auto"]).optional(),
  n: z.number().int().min(1).max(4).optional(),
});

const editSchema = z.object({
  action: z.literal("edit"),
  provider: z.enum(["codex", "chatgpt"]),
  prompt: z.string().min(1).max(4000),
  images: z
    .array(z.object({ dataUrl: z.string().min(32) }))
    .min(1)
    .max(5),
  size: z.string().optional(),
  quality: z.enum(["low", "medium", "high"]).optional(),
  background: z.enum(["transparent", "opaque", "auto"]).optional(),
  n: z.number().int().min(1).max(4).optional(),
});

const schema = z.discriminatedUnion("action", [generateSchema, editSchema]);

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const body = schema.parse(await req.json());
    const conn = await db.getConnection(user.id, body.provider as ProviderId);
    if (!conn || conn.status !== "connected") {
      return NextResponse.json(
        { error: `${body.provider} is not connected` },
        { status: 400 },
      );
    }
    const { secret } = await ensureFreshConnection(conn);
    const flavor = body.provider === "chatgpt" ? "chatgpt" : "codex";
    const result =
      body.action === "generate"
        ? await generateCodexImage(secret, { ...body, flavor })
        : await editCodexImage(secret, { ...body, flavor });
    return NextResponse.json({
      provider: body.provider,
      action: body.action,
      model: result.model,
      images: result.images,
      transport: result.transport,
      hostModel: "hostModel" in result ? result.hostModel : undefined,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Image request failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
