import { NextResponse } from "next/server";
import { z } from "zod";
import {
  completeCodexDesktopOAuth,
  connectionPublicView,
} from "@/lib/providers";

const schema = z.object({
  flowId: z.string().min(1),
  bridgeToken: z.string().min(1),
  callbackUrlOrCode: z.string().min(1),
});

export async function POST(req: Request) {
  try {
    const body = schema.parse(await req.json());
    const conn = await completeCodexDesktopOAuth({
      flowId: body.flowId,
      bridgeToken: body.bridgeToken,
      callbackUrlOrCode: body.callbackUrlOrCode,
    });
    return NextResponse.json({
      ok: true,
      connection: connectionPublicView(conn),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Codex bridge failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
