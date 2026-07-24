#!/usr/bin/env node
/**
 * Kimi Code upstream relay for Failure AI OAuth.
 *
 * Cloudflare Worker egress to api.kimi.com/coding is blocked by Cloudflare
 * bot challenges ("Attention Required!"), even with correct KimiCLI headers.
 * auth.kimi.com (OAuth) still works from Workers; only the coding API needs
 * this relay.
 *
 * Run on any normal Node host (VPS, laptop, Fly, Railway, cloudflared tunnel):
 *
 *   FAILURE_KIMI_BASE_URL=https://your-relay.example.com
 *
 * Usage:
 *   PORT=8788 node scripts/kimi-relay.mjs
 */
import http from "node:http";

const PORT = Number(process.env.PORT || 8788);
const UPSTREAM = (
  process.env.KIMI_UPSTREAM || "https://api.kimi.com/coding/v1"
).replace(/\/$/, "");

const ALLOW_HEADERS = new Set([
  "authorization",
  "content-type",
  "accept",
  "user-agent",
  "x-msh-platform",
  "x-msh-version",
  "x-msh-device-name",
  "x-msh-device-model",
  "x-msh-os-version",
  "x-msh-device-id",
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
    Accept: req.headers.accept || "application/json",
  };
  for (const [key, value] of Object.entries(req.headers)) {
    if (!value) continue;
    const lower = key.toLowerCase();
    if (!ALLOW_HEADERS.has(lower)) continue;
    headers[key] = Array.isArray(value) ? value.join(",") : value;
  }
  if (!Object.keys(headers).some((k) => k.toLowerCase() === "user-agent")) {
    headers["User-Agent"] = "KimiCLI/1.49.0";
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
  console.log(`Kimi relay listening on :${PORT} → ${UPSTREAM}`);
});
