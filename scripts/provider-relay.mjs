#!/usr/bin/env node
/**
 * Unified Codex + Kimi upstream relay for Failure AI OAuth.
 *
 * Cloudflare Workers cannot call chatgpt.com or api.kimi.com/coding directly
 * (CF challenges Worker egress). Run this on a normal Node host and expose it
 * (cloudflared quick tunnel is fine). The Worker reads relay URLs from KV:
 *
 *   failure-oauth:relay:codex → https://<tunnel>/codex
 *   failure-oauth:relay:kimi  → https://<tunnel>/kimi
 *
 * Usage:
 *   PORT=8787 node scripts/provider-relay.mjs
 *   # or: pnpm relay:providers
 */
import http from "node:http";

const PORT = Number(process.env.PORT || 8787);

const UPSTREAMS = {
  codex: (
    process.env.CODEX_UPSTREAM || "https://chatgpt.com/backend-api/codex"
  ).replace(/\/$/, ""),
  kimi: (
    process.env.KIMI_UPSTREAM || "https://api.kimi.com/coding/v1"
  ).replace(/\/$/, ""),
};

const ALLOW_HEADERS = new Set([
  "authorization",
  "chatgpt-account-id",
  "content-type",
  "accept",
  "originator",
  "user-agent",
  "openai-beta",
  "x-openai-fedramp",
  "x-openai-internal-codex-responses-lite",
  "x-msh-platform",
  "x-msh-version",
  "x-msh-device-name",
  "x-msh-device-model",
  "x-msh-os-version",
  "x-msh-device-id",
]);

function pickService(pathname) {
  if (pathname === "/codex" || pathname.startsWith("/codex/")) {
    return {
      name: "codex",
      upstream: UPSTREAMS.codex,
      rest: pathname === "/codex" ? "" : pathname.slice("/codex".length),
    };
  }
  if (pathname === "/kimi" || pathname.startsWith("/kimi/")) {
    return {
      name: "kimi",
      upstream: UPSTREAMS.kimi,
      rest: pathname === "/kimi" ? "" : pathname.slice("/kimi".length),
    };
  }
  return null;
}

const server = http.createServer(async (req, res) => {
  if (!req.url || !req.method) {
    res.writeHead(400).end("Bad request");
    return;
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "*",
    });
    res.end();
    return;
  }

  const target = new URL(req.url, "http://relay.local");

  if (target.pathname === "/healthz") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        services: {
          codex: `${UPSTREAMS.codex} (mount /codex)`,
          kimi: `${UPSTREAMS.kimi} (mount /kimi)`,
        },
      }),
    );
    return;
  }

  const service = pickService(target.pathname);
  if (!service) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: "not_found",
        message: "Use /codex/... or /kimi/... (or /healthz)",
      }),
    );
    return;
  }

  const upstreamUrl = `${service.upstream}${service.rest}${target.search}`;
  const headers = {
    Accept: req.headers.accept || "application/json",
  };
  for (const [key, value] of Object.entries(req.headers)) {
    if (!value) continue;
    const lower = key.toLowerCase();
    if (!ALLOW_HEADERS.has(lower)) continue;
    headers[key] = Array.isArray(value) ? value.join(",") : value;
  }
  if (!Object.keys(headers).some((k) => k.toLowerCase() === "user-agent")) {
    headers["User-Agent"] =
      service.name === "kimi" ? "KimiCLI/1.49.0" : "failure-ai-oauth-relay/1.1";
  }

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;

  try {
    const upstream = await fetch(upstreamUrl, {
      method: req.method,
      headers,
      body:
        body && req.method !== "GET" && req.method !== "HEAD" ? body : undefined,
    });
    const outHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
      "X-Failure-Relay": service.name,
    };
    const ctype = upstream.headers.get("content-type");
    if (ctype) outHeaders["Content-Type"] = ctype;
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.writeHead(upstream.status, outHeaders);
    res.end(buf);
  } catch (error) {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: "relay_upstream_failed",
        service: service.name,
        message: error instanceof Error ? error.message : String(error),
      }),
    );
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(
    `Provider relay on :${PORT} → /codex → ${UPSTREAMS.codex} | /kimi → ${UPSTREAMS.kimi}`,
  );
});
