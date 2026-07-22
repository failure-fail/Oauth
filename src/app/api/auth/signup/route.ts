import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  createUserSession,
  hashPassword,
  publicUser,
} from "@/lib/session";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(80),
});

export async function POST(req: Request) {
  try {
    const body = schema.parse(await req.json());
    const user = db.createUser({
      email: body.email,
      name: body.name,
      passwordHash: await hashPassword(body.password),
    });
    await createUserSession(user);
    return NextResponse.json({ user: publicUser(user) });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to create account";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
