#!/usr/bin/env node
/**
 * Keep the unified provider relay + cloudflared quick tunnel alive, and publish
 * live URLs into Cloudflare KV so the Worker can reach Codex/Kimi without a
 * redeploy when the trycloudflare hostname rotates.
 *
 * Requires:
 *   - CLOUDFLARE_API_TOKEN (or wrangler auth)
 *   - /tmp/cloudflared or `cloudflared` on PATH
 *   - FAILURE_KV namespace id (default matches wrangler.jsonc)
 *
 * Usage:
 *   node scripts/start-provider-relays.mjs
 */
import { spawn } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = Number(process.env.PORT || 8787);
const NS =
  process.env.FAILURE_KV_NAMESPACE_ID || "cf4106dc63c04e379e93f2252d5a367a";
const CLOUDFLARED =
  process.env.CLOUDFLARED_BIN ||
  (existsSync("/tmp/cloudflared") ? "/tmp/cloudflared" : "cloudflared");
const ROOT = new URL("..", import.meta.url).pathname;

function run(cmd, args, opts = {}) {
  const child = spawn(cmd, args, {
    cwd: ROOT,
    stdio: opts.stdio || ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...(opts.env || {}) },
  });
  return child;
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
  console.log(`KV ${key} = ${value}`);
}

async function waitForHealth(timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/healthz`);
      if (res.ok) return true;
    } catch {
      // retry
    }
    await sleep(400);
  }
  return false;
}

function startRelay() {
  console.log(`Starting provider-relay on :${PORT}`);
  const child = run("node", ["scripts/provider-relay.mjs"], {
    env: { PORT: String(PORT) },
  });
  child.stdout.on("data", (d) => process.stdout.write(`[relay] ${d}`));
  child.stderr.on("data", (d) => process.stderr.write(`[relay] ${d}`));
  child.on("exit", (code) => {
    console.error(`relay exited (${code})`);
  });
  return child;
}

function startTunnel() {
  const logPath = "/tmp/failure-provider-tunnel.log";
  const log = createWriteStream(logPath, { flags: "a" });
  console.log(`Starting cloudflared → :${PORT} (log ${logPath})`);
  const child = run(CLOUDFLARED, [
    "tunnel",
    "--url",
    `http://127.0.0.1:${PORT}`,
    "--no-autoupdate",
  ]);
  let url = null;
  const onData = (buf) => {
    const text = buf.toString();
    log.write(text);
    process.stdout.write(`[tunnel] ${text}`);
    const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (match && !url) {
      url = match[0];
      child.emit("tunnel-url", url);
    }
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  child.on("exit", (code) => {
    console.error(`tunnel exited (${code})`);
  });
  return child;
}

async function publish(url) {
  const base = url.replace(/\/$/, "");
  await kvPut("failure-oauth:relay:codex", `${base}/codex`);
  await kvPut("failure-oauth:relay:kimi", `${base}/kimi`);
  await kvPut("failure-oauth:relay:root", base);
  console.log("Relay URLs published to KV. Worker will pick them up on next request.");
}

async function main() {
  let relay = startRelay();
  if (!(await waitForHealth())) {
    console.error("Relay failed to become healthy");
    process.exit(1);
  }

  let tunnel = startTunnel();
  let currentUrl = null;

  const onUrl = async (url) => {
    if (url === currentUrl) return;
    currentUrl = url;
    try {
      await publish(url);
    } catch (error) {
      console.error("Failed to publish relay URLs:", error);
    }
  };
  tunnel.on("tunnel-url", (url) => {
    void onUrl(url);
  });

  // Supervise: restart crashed processes
  setInterval(() => {
    if (relay.exitCode != null) {
      console.log("Restarting relay…");
      relay = startRelay();
    }
    if (tunnel.exitCode != null) {
      console.log("Restarting tunnel…");
      currentUrl = null;
      tunnel = startTunnel();
      tunnel.on("tunnel-url", (url) => {
        void onUrl(url);
      });
    }
  }, 5000);

  // Periodic health publish / re-check
  setInterval(async () => {
    if (!currentUrl) return;
    try {
      const res = await fetch(`${currentUrl}/healthz`, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) console.warn("Public tunnel health check failed", res.status);
    } catch (error) {
      console.warn("Public tunnel unreachable:", error instanceof Error ? error.message : error);
    }
  }, 60000);

  console.log("Provider relay supervisor running. Ctrl+C to stop.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
