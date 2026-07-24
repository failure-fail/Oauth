import { NextResponse } from "next/server";
import { discoveryDocument } from "@/lib/oauth-server";

export async function GET() {
  return NextResponse.json(discoveryDocument(), {
    headers: {
      "Cache-Control": "public, max-age=3600",
    },
  });
}

export async function HEAD() {
  return new NextResponse(null, { status: 200 });
}
