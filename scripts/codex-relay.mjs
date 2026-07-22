#!/usr/bin/env node
/**
 * Codex upstream relay for Failure AI OAuth.
 *
 * Cloudflare Workers cannot call chatgpt.com (zone blocks CF-Worker egress).
 * Run this relay on any normal Node host (VPS, laptop, Fly, Railway), then set:
 *
 *   FAILURE_CODEX_BASE_URL=https://your-relay.example.com
 *
 * Usage:
 *   PORT=8787 node scripts/codex-relay.mjs
 */
import http from "node:http";

const PORT = Number(process.env.PORT || 8787);
const UPSTREAM = (
  process.env.CODEX_UPSTREAM || "https://chatgpt.com/backend-api/codex"
).replace(/\/$/, "");

const ALLOW_HEADERS = new Set([
  "authorization",
  "chatgpt-account-id",
  "content-type",
  "accept",
  "originator",
  "openai-beta",
  "x-openai-fedramp",
  "x-openai-internal-codex-responses-lite",
]);

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

  if (req.url === "/healthz") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, upstream: UPSTREAM }));
    return;
  }

  const target = new URL(req.url, "http://relay.local");
  const upstreamUrl = `${UPSTREAM}${target.pathname}${target.search}`;

  const headers = {
    "User-Agent": "codex_cli_rs/0.144.1",
    Accept: req.headers.accept || "application/json",
  };
  for (const [key, value] of Object.entries(req.headers)) {
    if (!value) continue;
    const lower = key.toLowerCase();
    if (!ALLOW_HEADERS.has(lower)) continue;
    headers[key] = Array.isArray(value) ? value.join(",") : value;
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
        message: error instanceof Error ? error.message : String(error),
      }),
    );
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Codex relay listening on :${PORT} → ${UPSTREAM}`);
});
