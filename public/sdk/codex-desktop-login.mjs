#!/usr/bin/env node
/**
 * Failure AI OAuth — Codex desktop OAuth bridge
 *
 * Mirrors Codex CLI/Desktop login: listens on http://localhost:1455/auth/callback,
 * opens the authorize URL, then posts the callback back to Failure.
 *
 * Usage:
 *   node codex-desktop-login.mjs \
 *     --flow-id=... \
 *     --bridge-token=... \
 *     --authorize-url='https://auth.openai.com/oauth/authorize?...' \
 *     --api-base=https://oauth.failure.fail
 */

import http from "node:http";
import { spawn } from "node:child_process";
import { platform } from "node:os";

function arg(name) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : "";
}

const flowId = arg("flow-id");
const bridgeToken = arg("bridge-token");
const authorizeUrl = arg("authorize-url");
const apiBase = (arg("api-base") || "https://oauth.failure.fail").replace(
  /\/$/,
  "",
);
const port = Number(arg("port") || 1455);

if (!flowId || !bridgeToken || !authorizeUrl) {
  console.error(
    "Missing required args: --flow-id --bridge-token --authorize-url [--api-base] [--port]",
  );
  process.exit(1);
}

function openBrowser(url) {
  const cmd =
    platform() === "darwin"
      ? "open"
      : platform() === "win32"
        ? "start"
        : "xdg-open";
  try {
    if (platform() === "win32") {
      spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" });
    } else {
      spawn(cmd, [url], { detached: true, stdio: "ignore" });
    }
  } catch {
    console.log(`Open this URL manually:\n${url}`);
  }
}

function html(title, body) {
  return `<!doctype html><html><head><meta charset="utf-8"/><title>${title}</title>
  <style>body{font-family:ui-sans-serif,system-ui;background:#0c0b0a;color:#f4ebe3;display:grid;place-items:center;min-height:100vh;margin:0}
  main{max-width:32rem;padding:2rem;border:1px solid rgba(255,255,255,.12);border-radius:1.2rem;background:rgba(255,255,255,.04)}
  h1{font-size:1.4rem;margin:0 0 .6rem}p{color:#8a7b6e;line-height:1.5}</style></head>
  <body><main><h1>${title}</h1><p>${body}</p></main></body></html>`;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://localhost:${port}`);
    if (url.pathname !== "/auth/callback") {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
      return;
    }

    const callbackUrl = `http://localhost:${port}${url.pathname}${url.search}`;
    console.log("Captured Codex desktop OAuth callback…");

    const complete = await fetch(`${apiBase}/api/providers/codex/bridge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        flowId,
        bridgeToken,
        callbackUrlOrCode: callbackUrl,
      }),
    });
    const data = await complete.json();
    if (!complete.ok) {
      throw new Error(data.error || `Bridge complete failed (${complete.status})`);
    }

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(
      html(
        "Codex connected",
        "Desktop OAuth finished. You can close this tab and return to Failure.",
      ),
    );
    console.log("Codex desktop OAuth connected. You can close this terminal.");
    setTimeout(() => process.exit(0), 250);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(message);
    res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html("Codex connect failed", message));
    setTimeout(() => process.exit(1), 250);
  }
});

server.on("error", (err) => {
  console.error(
    `Could not bind localhost:${port} (Codex desktop callback). ${err.message}`,
  );
  console.error(
    "Close any Codex CLI/Desktop login already using 1455, or paste the callback URL in Failure as a fallback.",
  );
  process.exit(1);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Codex desktop OAuth bridge listening on http://localhost:${port}/auth/callback`);
  console.log("Opening authorize URL…");
  openBrowser(authorizeUrl);
  console.log(authorizeUrl);
});
