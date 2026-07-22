import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { randomToken } from "@/lib/config";

const createSchema = z.object({
  name: z.string().min(1).max(80),
  redirectUris: z.array(z.string().url()).min(1),
  publicClient: z.boolean().default(true),
});

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const apps = (await db.listClients(user.id)).map((c) => ({
    id: c.id,
    name: c.name,
    clientId: c.clientId,
    redirectUris: c.redirectUris,
    public: c.public,
    createdAt: c.createdAt,
  }));
  return NextResponse.json({ apps });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const body = createSchema.parse(await req.json());
    const clientSecret = body.publicClient ? null : randomToken(24);
    const client = await db.createClient({
      userId: user.id,
      name: body.name,
      redirectUris: body.redirectUris,
      public: body.publicClient,
      clientSecretHash: clientSecret
        ? await bcrypt.hash(clientSecret, 10)
        : null,
    });
    return NextResponse.json({
      app: {
        id: client.id,
        name: client.name,
        clientId: client.clientId,
        redirectUris: client.redirectUris,
        public: client.public,
        createdAt: client.createdAt,
        clientSecret,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to create app";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }
  await db.deleteClient(id, user.id);
  return NextResponse.json({ ok: true });
}
