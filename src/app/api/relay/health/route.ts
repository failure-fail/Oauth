import { NextResponse } from "next/server";
import {
  resolveCodexRelayBase,
  resolveKimiRelayBase,
} from "@/lib/relay-config";

async function check(url: string | null) {
  if (!url) return { ok: false, error: "missing_relay_url" as const };
  const healthz = `${new URL(url).origin}/healthz`;
  try {
    const res = await fetch(healthz, { signal: AbortSignal.timeout(10000) });
    const text = (await res.text()).slice(0, 300);
    return {
      ok: res.ok,
      status: res.status,
      healthz,
      body: text,
    };
  } catch (error) {
    return {
      ok: false,
      healthz,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Public readiness probe for Codex/Kimi Node relays (KV-published tunnels). */
export async function GET() {
  const codex = await resolveCodexRelayBase();
  const kimi = await resolveKimiRelayBase();
  const [codexCheck, kimiCheck] = await Promise.all([
    check(codex),
    check(kimi),
  ]);
  const ok = Boolean(codexCheck.ok && kimiCheck.ok);
  return NextResponse.json(
    {
      ok,
      codex: { base: codex, ...codexCheck },
      kimi: { base: kimi, ...kimiCheck },
    },
    { status: ok ? 200 : 503 },
  );
}
