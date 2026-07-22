import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  createUserSession,
  publicUser,
  verifyPassword,
} from "@/lib/session";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(req: Request) {
  try {
    const body = schema.parse(await req.json());
    const user = await db.findUserByEmail(body.email);
    if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 },
      );
    }
    await createUserSession(user);
    return NextResponse.json({ user: publicUser(user) });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to sign in";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
