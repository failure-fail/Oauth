#!/usr/bin/env node
/**
 * Keep the unified provider relay + cloudflared quick tunnel alive, and publish
 * live URLs into Cloudflare KV so the Worker can reach Codex/Kimi without a
 * redeploy when the trycloudflare hostname rotates.
 *
 * Continuously pings the public tunnel. On CF 1016/1033 / timeouts / bad
 * healthz, kills cloudflared, starts a fresh quick tunnel, and re-publishes KV.
 *
 * Requires:
 *   - CLOUDFLARE_API_TOKEN (or wrangler auth)
 *   - /tmp/cloudflared or `cloudflared` on PATH
 *   - FAILURE_KV namespace id (default matches wrangler.jsonc)
 *
 * Usage:
 *   node scripts/start-provider-relays.mjs
 *   # or: pnpm relay:providers
 *
 * Env:
 *   PORT                 local relay port (default 8787)
 *   PING_INTERVAL_MS     public tunnel ping interval (default 15000)
 *   PING_FAILS_BEFORE_REFRESH  consecutive failures before refresh (default 2)
 *   LOCAL_PING_INTERVAL_MS     local relay check (default 5000)
 */
import { spawn } from "node:child_process";
import dns from "node:dns";
import { createWriteStream, existsSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

// Local resolvers often lag on brand-new trycloudflare hostnames; CF/Google DNS
// usually see them sooner (and matches what the Worker edge uses).
dns.setServers(
  (process.env.RELAY_DNS_SERVERS || "1.1.1.1,1.0.0.1,8.8.8.8")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

const PORT = Number(process.env.PORT || 8787);
const NS =
  process.env.FAILURE_KV_NAMESPACE_ID || "cf4106dc63c04e379e93f2252d5a367a";
const CLOUDFLARED =
  process.env.CLOUDFLARED_BIN ||
  (existsSync("/tmp/cloudflared") ? "/tmp/cloudflared" : "cloudflared");
const ROOT = new URL("..", import.meta.url).pathname;
const PING_INTERVAL_MS = Number(process.env.PING_INTERVAL_MS || 15_000);
const PING_FAILS_BEFORE_REFRESH = Number(
  process.env.PING_FAILS_BEFORE_REFRESH || 2,
);
const LOCAL_PING_INTERVAL_MS = Number(
  process.env.LOCAL_PING_INTERVAL_MS || 5_000,
);
const TUNNEL_URL_TIMEOUT_MS = Number(
  process.env.TUNNEL_URL_TIMEOUT_MS || 90_000,
);
const WORKER_HEALTH_URL =
  process.env.WORKER_RELAY_HEALTH_URL ||
  "https://oauth.failure.fail/api/relay/health";

const state = {
  relay: null,
  tunnel: null,
  currentUrl: null,
  consecutiveFails: 0,
  refreshing: false,
  lastOkAt: null,
  lastFailReason: null,
  publishedAt: null,
  lastRefreshAt: 0,
};

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

function run(cmd, args, opts = {}) {
  return spawn(cmd, args, {
    cwd: ROOT,
    stdio: opts.stdio || ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...(opts.env || {}) },
  });
}

function killTree(child, label) {
  if (!child || child.killed || child.exitCode != null) return;
  try {
    child.kill("SIGTERM");
  } catch {
    // ignore
  }
  setTimeout(() => {
    if (child.exitCode == null && !child.killed) {
      try {
        child.kill("SIGKILL");
        log(`force-killed ${label}`);
      } catch {
        // ignore
      }
    }
  }, 2500);
}

async function kvPut(key, value) {
  await new Promise((resolve, reject) => {
    const child = run(
      "npx",
      [
        "--yes",
        "wrangler@4.113.0",
        "kv",
        "key",
        "put",
        "--namespace-id",
        NS,
        key,
        value,
        "--remote",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let err = "";
    child.stderr.on("data", (d) => {
      err += d.toString();
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(err || `kv put failed (${code})`));
    });
  });
  log(`KV ${key} = ${value}`);
}

async function waitForLocalHealth(timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/healthz`, {
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) return true;
    } catch {
      // retry
    }
    await sleep(400);
  }
  return false;
}

function startRelay() {
  log(`Starting provider-relay on :${PORT}`);
  const child = run("node", ["scripts/provider-relay.mjs"], {
    env: { PORT: String(PORT) },
  });
  child.stdout.on("data", (d) => process.stdout.write(`[relay] ${d}`));
  child.stderr.on("data", (d) => process.stderr.write(`[relay] ${d}`));
  child.on("exit", (code, signal) => {
    log(`relay exited (code=${code} signal=${signal})`);
  });
  return child;
}

function startTunnel() {
  const logPath = "/tmp/failure-provider-tunnel.log";
  const logStream = createWriteStream(logPath, { flags: "a" });
  log(`Starting cloudflared → :${PORT} (log ${logPath})`);
  const child = run(CLOUDFLARED, [
    "tunnel",
    "--url",
    `http://127.0.0.1:${PORT}`,
    "--no-autoupdate",
  ]);
  let announced = false;
  const onData = (buf) => {
    const text = buf.toString();
    logStream.write(text);
    process.stdout.write(`[tunnel] ${text}`);
    const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (match && !announced) {
      announced = true;
      child.emit("tunnel-url", match[0]);
    }
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  child.on("exit", (code, signal) => {
    log(`tunnel exited (code=${code} signal=${signal})`);
  });
  return child;
}

async function publish(url) {
  const base = url.replace(/\/$/, "");
  await kvPut("failure-oauth:relay:codex", `${base}/codex`);
  await kvPut("failure-oauth:relay:kimi", `${base}/kimi`);
  await kvPut("failure-oauth:relay:root", base);
  state.publishedAt = Date.now();
  log("Relay URLs published to KV. Worker picks them up on next request.");
}

function isCloudflareEdgeDead(status, body) {
  if (status === 530 || status === 502 || status === 503 || status === 504) {
    return true;
  }
  return /error code:\s*(1016|1033|1000|1001|1020)/i.test(body || "");
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

async function pingDirectHealthz(url) {
  const healthz = `${url.replace(/\/$/, "")}/healthz`;
  const res = await fetch(healthz, {
    signal: AbortSignal.timeout(10_000),
    headers: { Accept: "application/json" },
  });
  const text = await res.text();
  if (!res.ok || isCloudflareEdgeDead(res.status, text)) {
    return {
      ok: false,
      reason: `direct_http_${res.status}:${text.slice(0, 80).replace(/\s+/g, " ")}`,
      status: res.status,
      via: "direct",
    };
  }
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    return {
      ok: false,
      reason: "direct_non_json_healthz",
      status: res.status,
      via: "direct",
    };
  }
  if (!json?.ok) {
    return {
      ok: false,
      reason: "direct_healthz_not_ok",
      status: res.status,
      via: "direct",
    };
  }
  return { ok: true, status: res.status, via: "direct" };
}

/**
 * Prefer the live Worker probe (production path). Fall back to direct
 * trycloudflare /healthz using Cloudflare DNS servers.
 */
async function pingPublicTunnel(url) {
  if (!url) return { ok: false, reason: "no_url" };
  const wantHost = hostOf(url);

  // 1) Worker → KV → tunnel (what Codex actually uses)
  try {
    const res = await fetch(WORKER_HEALTH_URL, {
      signal: AbortSignal.timeout(15_000),
      headers: { Accept: "application/json", "Cache-Control": "no-store" },
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      // fall through to direct
    }
    if (json && typeof json === "object") {
      if (json.ok === true) {
        const codexHost = hostOf(json.codex?.base || "");
        const kimiHost = hostOf(json.kimi?.base || "");
        if (
          !wantHost ||
          codexHost === wantHost ||
          kimiHost === wantHost ||
          !codexHost
        ) {
          return { ok: true, status: res.status, via: "worker" };
        }
        // Worker is healthy on a different tunnel hostname (stale local state)
        return {
          ok: true,
          status: res.status,
          via: "worker_other_host",
          reason: `worker_ok_host=${codexHost || kimiHost}`,
        };
      }
      const detail = [
        json.codex?.error || json.codex?.body || json.codex?.status,
        json.kimi?.error || json.kimi?.body || json.kimi?.status,
      ]
        .filter(Boolean)
        .join("|");
      // Worker sees failure — trust it as the source of truth for refresh
      return {
        ok: false,
        reason: `worker_unhealthy:${detail || text.slice(0, 120)}`,
        status: res.status,
        via: "worker",
      };
    }
  } catch (error) {
    // Worker probe failed (network) — try direct
    const msg = error instanceof Error ? error.message : String(error);
    log(`Worker health probe error, trying direct: ${msg}`);
  }

  // 2) Direct tunnel healthz
  try {
    return await pingDirectHealthz(url);
  } catch (error) {
    const cause =
      error && typeof error === "object" && "cause" in error
        ? error.cause
        : null;
    const detail = [
      error instanceof Error ? error.message : String(error),
      cause instanceof Error ? cause.message : cause ? String(cause) : null,
    ]
      .filter(Boolean)
      .join(": ");
    return { ok: false, reason: detail || "fetch_failed", via: "direct" };
  }
}

async function ensureRelay() {
  if (state.relay && state.relay.exitCode == null) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/healthz`, {
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) return;
    } catch {
      // fall through to restart
    }
    log("Local relay unhealthy — restarting");
    killTree(state.relay, "relay");
    state.relay = null;
    await sleep(500);
  } else if (state.relay) {
    state.relay = null;
  }
  state.relay = startRelay();
  if (!(await waitForLocalHealth())) {
    throw new Error("Relay failed to become healthy");
  }
}

async function waitForTunnelUrl(child, timeoutMs = TUNNEL_URL_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.off("tunnel-url", onUrl);
      reject(new Error(`Timed out waiting for trycloudflare URL (${timeoutMs}ms)`));
    }, timeoutMs);
    const onUrl = (url) => {
      clearTimeout(timer);
      resolve(url);
    };
    child.once("tunnel-url", onUrl);
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Tunnel exited before URL (code=${code})`));
    });
  });
}

async function refreshTunnel(reason) {
  if (state.refreshing) {
    log(`Refresh already in progress (skip: ${reason})`);
    return;
  }
  const since = Date.now() - state.lastRefreshAt;
  const minGap = Number(process.env.REFRESH_COOLDOWN_MS || 20_000);
  if (state.lastRefreshAt && since < minGap && reason !== "startup") {
    log(
      `Refresh cooldown (${Math.round((minGap - since) / 1000)}s left) — skip: ${reason}`,
    );
    return;
  }
  state.refreshing = true;
  state.lastRefreshAt = Date.now();
  log(`Refreshing tunnel — ${reason}`);
  try {
    await ensureRelay();

    if (state.tunnel) {
      killTree(state.tunnel, "tunnel");
      state.tunnel = null;
      await sleep(800);
    }

    state.currentUrl = null;
    state.consecutiveFails = 0;
    state.tunnel = startTunnel();

    const url = await waitForTunnelUrl(state.tunnel);
    state.currentUrl = url;
    // Publish first so the Worker probe can see the new hostname.
    await publish(url);

    let ok = false;
    let last = null;
    const warmAttempts = Number(process.env.TUNNEL_WARM_ATTEMPTS || 30);
    for (let i = 0; i < warmAttempts; i++) {
      await sleep(i < 5 ? 1000 : 2000);
      last = await pingPublicTunnel(url);
      if (last.ok) {
        ok = true;
        break;
      }
      log(
        `Tunnel warm-up ping failed (${i + 1}/${warmAttempts}) via=${last.via || "?"}: ${last.reason}`,
      );
    }

    state.lastFailReason = ok ? null : last?.reason || "warm_up_failed";
    if (ok) {
      state.lastOkAt = Date.now();
      state.consecutiveFails = 0;
      log(`Tunnel ready: ${url} (via ${last?.via || "unknown"})`);
    } else {
      log(
        `Tunnel still unhealthy after warm-up (${last?.reason}). Ping loop will keep refreshing.`,
      );
    }
  } finally {
    state.refreshing = false;
  }
}

async function pingLoop() {
  for (;;) {
    try {
      if (state.refreshing) {
        await sleep(PING_INTERVAL_MS);
        continue;
      }

      // Process died → refresh immediately
      if (!state.tunnel || state.tunnel.exitCode != null) {
        await refreshTunnel("tunnel process exited");
        await sleep(PING_INTERVAL_MS);
        continue;
      }

      if (!state.currentUrl) {
        await refreshTunnel("missing public URL");
        await sleep(PING_INTERVAL_MS);
        continue;
      }

      const result = await pingPublicTunnel(state.currentUrl);
      if (result.ok) {
        if (state.consecutiveFails > 0) {
          log(`Tunnel recovered after ${state.consecutiveFails} fail(s)`);
        }
        state.consecutiveFails = 0;
        state.lastOkAt = Date.now();
        state.lastFailReason = null;
      } else {
        state.consecutiveFails += 1;
        state.lastFailReason = result.reason;
        log(
          `Tunnel ping FAIL ${state.consecutiveFails}/${PING_FAILS_BEFORE_REFRESH}: ${result.reason}`,
        );
        if (state.consecutiveFails >= PING_FAILS_BEFORE_REFRESH) {
          await refreshTunnel(`ping failed: ${result.reason}`);
        }
      }
    } catch (error) {
      log(
        "Ping loop error:",
        error instanceof Error ? error.message : String(error),
      );
      try {
        await refreshTunnel(
          `ping loop error: ${error instanceof Error ? error.message : error}`,
        );
      } catch (refreshError) {
        log(
          "Refresh failed:",
          refreshError instanceof Error
            ? refreshError.message
            : String(refreshError),
        );
      }
    }
    await sleep(PING_INTERVAL_MS);
  }
}

async function localWatchLoop() {
  for (;;) {
    try {
      if (!state.refreshing) {
        if (!state.relay || state.relay.exitCode != null) {
          log("Relay process missing — restarting");
          await ensureRelay();
        } else {
          const res = await fetch(`http://127.0.0.1:${PORT}/healthz`, {
            signal: AbortSignal.timeout(2000),
          }).catch(() => null);
          if (!res?.ok) {
            log("Local relay ping failed — restarting relay");
            killTree(state.relay, "relay");
            state.relay = null;
            await ensureRelay();
          }
        }
      }
    } catch (error) {
      log(
        "Local watch error:",
        error instanceof Error ? error.message : String(error),
      );
    }
    await sleep(LOCAL_PING_INTERVAL_MS);
  }
}

async function statusLoop() {
  for (;;) {
    await sleep(60_000);
    const age = state.lastOkAt
      ? `${Math.round((Date.now() - state.lastOkAt) / 1000)}s ago`
      : "never";
    log(
      `status url=${state.currentUrl || "none"} fails=${state.consecutiveFails} lastOk=${age} refreshing=${state.refreshing}${
        state.lastFailReason ? ` lastFail=${state.lastFailReason}` : ""
      }`,
    );
  }
}

async function main() {
  // Never exit on a bad first tunnel — keep refreshing until one sticks.
  for (;;) {
    try {
      await ensureRelay();
      await refreshTunnel("startup");
      break;
    } catch (error) {
      log(
        "Startup refresh failed, retrying in 5s:",
        error instanceof Error ? error.message : String(error),
      );
      await sleep(5000);
    }
  }
  log(
    `Supervisor running — ping every ${PING_INTERVAL_MS}ms, refresh after ${PING_FAILS_BEFORE_REFRESH} fails. Ctrl+C to stop.`,
  );
  void pingLoop();
  void localWatchLoop();
  void statusLoop();
}

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    log(`Caught ${sig}, shutting down…`);
    killTree(state.tunnel, "tunnel");
    killTree(state.relay, "relay");
    process.exit(0);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
