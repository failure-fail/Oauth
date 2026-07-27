import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";

export const dynamic = "force-dynamic";

type KvLike = {
  get: (key: string) => Promise<string | null>;
  put: (key: string, value: string) => Promise<void>;
};

async function getKv(): Promise<KvLike | null> {
  try {
    const ctx = await getCloudflareContext({ async: true });
    return ((ctx.env as { FAILURE_KV?: KvLike }).FAILURE_KV ?? null) as KvLike | null;
  } catch {
    return null;
  }
}

function cleanRoot(url: unknown): string | null {
  if (typeof url !== "string") return null;
  const value = url.trim().replace(/\/$/, "");
  if (!/^https?:\/\//i.test(value)) return null;
  try {
    const parsed = new URL(value);
    if (!["http:", "https:"].includes(parsed.protocol)) return null;
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}

/**
 * Register a live Codex/Kimi relay tunnel into KV.
 *
 * Auth is challenge-based (no shared secret): the Worker fetches the claimed
 * tunnel root and requires the Node relay to echo a nonce. That proves the
 * caller controls the tunnel before KV is updated.
 *
 * Body: { "root": "https://your-tunnel.example", "nonce": "random-string" }
 */
export async function POST(req: Request) {
  let body: { root?: string; nonce?: string };
  try {
    body = (await req.json()) as { root?: string; nonce?: string };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const root = cleanRoot(body.root);
  const nonce = typeof body.nonce === "string" ? body.nonce.trim() : "";
  if (!root || nonce.length < 16 || nonce.length > 200) {
    return NextResponse.json(
      { error: "invalid_request", message: "Need root https URL and nonce (16-200 chars)" },
      { status: 400 },
    );
  }

  // 1) healthz must be healthy
  try {
    const health = await fetch(`${root}/healthz`, {
      signal: AbortSignal.timeout(10000),
      headers: { Accept: "application/json" },
    });
    const text = await health.text();
    if (!health.ok || !/"ok"\s*:\s*true/.test(text)) {
      return NextResponse.json(
        {
          error: "health_failed",
          status: health.status,
          body: text.slice(0, 200),
        },
        { status: 400 },
      );
    }
  } catch (error) {
    return NextResponse.json(
      {
        error: "health_unreachable",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 400 },
    );
  }

  // 2) challenge echo proves caller controls the relay process
  try {
    const challenge = await fetch(`${root}/.failure-relay-challenge`, {
      signal: AbortSignal.timeout(10000),
      headers: {
        Accept: "application/json",
        "X-Failure-Relay-Nonce": nonce,
      },
    });
    const text = await challenge.text();
    let json: { ok?: boolean; nonce?: string } | null = null;
    try {
      json = JSON.parse(text) as { ok?: boolean; nonce?: string };
    } catch {
      json = null;
    }
    if (!challenge.ok || !json?.ok || json.nonce !== nonce) {
      return NextResponse.json(
        {
          error: "challenge_failed",
          status: challenge.status,
          body: text.slice(0, 200),
        },
        { status: 401 },
      );
    }
  } catch (error) {
    return NextResponse.json(
      {
        error: "challenge_unreachable",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 401 },
    );
  }

  const kv = await getKv();
  if (!kv) {
    return NextResponse.json({ error: "kv_unavailable" }, { status: 500 });
  }

  await kv.put("failure-oauth:relay:codex", `${root}/codex`);
  await kv.put("failure-oauth:relay:kimi", `${root}/kimi`);
  await kv.put("failure-oauth:relay:root", root);

  return NextResponse.json({
    ok: true,
    root,
    codex: `${root}/codex`,
    kimi: `${root}/kimi`,
  });
}
