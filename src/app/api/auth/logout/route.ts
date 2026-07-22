import { NextResponse } from "next/server";
import { destroyUserSession } from "@/lib/session";

export async function POST() {
  await destroyUserSession();
  return NextResponse.json({ ok: true });
}
