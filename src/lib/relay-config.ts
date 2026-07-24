/**
 * Resolve Codex/Kimi relay bases.
 *
 * Prefer KV keys written by `scripts/start-provider-relays.mjs` so quick-tunnel
 * hostname rotations do not require a Worker redeploy. Env vars are a local/dev
 * override when KV is unavailable.
 */

const CODEX_KV_KEY = "failure-oauth:relay:codex";
const KIMI_KV_KEY = "failure-oauth:relay:kimi";

type KvLike = { get: (key: string) => Promise<string | null> };

async function getKv(): Promise<KvLike | null> {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const ctx = await getCloudflareContext({ async: true });
    const kv = (ctx.env as { FAILURE_KV?: KvLike }).FAILURE_KV;
    return kv ?? null;
  } catch {
    return null;
  }
}

function clean(url: string | null | undefined): string | null {
  const value = url?.trim();
  return value ? value.replace(/\/$/, "") : null;
}

export async function resolveCodexRelayBase(): Promise<string | null> {
  const kv = await getKv();
  if (kv) {
    const fromKv = clean(await kv.get(CODEX_KV_KEY));
    if (fromKv) return fromKv;
  }
  return clean(process.env.FAILURE_CODEX_BASE_URL);
}

export async function resolveKimiRelayBase(): Promise<string | null> {
  const kv = await getKv();
  if (kv) {
    const fromKv = clean(await kv.get(KIMI_KV_KEY));
    if (fromKv) return fromKv;
  }
  return clean(process.env.FAILURE_KIMI_BASE_URL);
}
