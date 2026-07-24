import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { db } from "@/lib/db";
import { hashToken } from "@/lib/oauth-server";
import { config, randomToken } from "@/lib/config";

const createSchema = z.object({
  name: z.string().min(1).max(80).optional(),
});

function mintRawKey() {
  // fsk_ + 32 bytes hex-ish from randomToken
  const body = randomToken(24).replace(/[^a-zA-Z0-9]/g, "");
  return `fsk_${body}`;
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const keys = await db.listApiKeys(user.id);
  return NextResponse.json({ keys });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let name = "Default";
  try {
    const json = await req.json();
    const parsed = createSchema.safeParse(json);
    if (parsed.success && parsed.data.name) name = parsed.data.name;
  } catch {
    // empty body ok
  }

  const existing = await db.listApiKeys(user.id);
  if (existing.length >= 10) {
    return NextResponse.json(
      { error: "Key limit reached (10). Revoke an unused key first." },
      { status: 400 },
    );
  }

  const raw = mintRawKey();
  const prefix = `${raw.slice(0, 10)}…`;
  const record = await db.createApiKey({
    userId: user.id,
    name,
    tokenHash: hashToken(raw),
    prefix,
  });

  return NextResponse.json({
    id: record.id,
    name: record.name,
    prefix: record.prefix,
    createdAt: record.createdAt,
    key: raw,
    base_url: `${config.baseUrl.replace(/\/$/, "")}/v1`,
    note: "Copy this key now. Failure stores only a hash and cannot show it again.",
  });
}

export async function DELETE(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const id = url.searchParams.get("id") || "";
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }
  await db.revokeApiKey(id, user.id);
  return NextResponse.json({ ok: true });
}
