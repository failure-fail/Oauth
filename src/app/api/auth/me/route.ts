import { NextResponse } from "next/server";
import { getCurrentUser, publicUser } from "@/lib/session";
import { db } from "@/lib/db";
import { connectionPublicView } from "@/lib/providers";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ user: null }, { status: 401 });
  }
  const connections = (await db.listConnections(user.id)).map(
    connectionPublicView,
  );
  return NextResponse.json({
    user: publicUser(user),
    connections,
  });
}
