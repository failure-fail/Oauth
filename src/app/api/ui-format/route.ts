import { NextResponse } from "next/server";
import { universalUiFormat } from "@/lib/oauth-server";

export async function GET() {
  return NextResponse.json(universalUiFormat());
}
