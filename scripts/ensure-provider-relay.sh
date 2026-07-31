#!/usr/bin/env bash
# Bring the Codex/Kimi relay + tunnel back up and register with the Worker.
# Safe to re-run after VM recycle. Prefers POST /api/relay/register (no token).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-8787}"
CLOUDFLARED="${CLOUDFLARED_BIN:-/tmp/cloudflared}"
WORKER_REGISTER_URL="${WORKER_RELAY_REGISTER_URL:-https://oauth.failure.fail/api/relay/register}"
WORKER_HEALTH_URL="${WORKER_RELAY_HEALTH_URL:-https://oauth.failure.fail/api/relay/health}"
TMUX_CONF="/exec-daemon/tmux.portal.conf"

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

if ! curl -fsS -m 3 "http://127.0.0.1:${PORT}/healthz" >/dev/null 2>&1; then
  log "Starting local relay on :${PORT}"
  if [ -f "$TMUX_CONF" ]; then
    tmux -f "$TMUX_CONF" has-session -t '=provider-relay' 2>/dev/null \
      || tmux -f "$TMUX_CONF" new-session -d -s provider-relay -c "$ROOT" -- bash -l
    tmux -f "$TMUX_CONF" send-keys -t 'provider-relay:0.0' \
      "PORT=${PORT} node ${ROOT}/scripts/provider-relay.mjs 2>&1 | tee /tmp/provider-relay.log" C-m
  else
    PORT="$PORT" nohup node "$ROOT/scripts/provider-relay.mjs" \
      >/tmp/provider-relay.log 2>&1 &
  fi
  for _ in $(seq 1 30); do
    curl -fsS -m 2 "http://127.0.0.1:${PORT}/healthz" >/dev/null 2>&1 && break
    sleep 0.4
  done
fi

if [ ! -x "$CLOUDFLARED" ]; then
  log "Downloading cloudflared → $CLOUDFLARED"
  curl -fsSL -o "$CLOUDFLARED" \
    https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
  chmod +x "$CLOUDFLARED"
fi

# If Worker already healthy, done.
if curl -fsS -m 15 "$WORKER_HEALTH_URL" | grep -q '"ok":true'; then
  log "Worker relay already healthy"
  exit 0
fi

log "Starting cloudflared quick tunnel"
: >/tmp/cf-tunnel-live.log
if [ -f "$TMUX_CONF" ]; then
  tmux -f "$TMUX_CONF" has-session -t '=cloudflared-relay' 2>/dev/null \
    || tmux -f "$TMUX_CONF" new-session -d -s cloudflared-relay -c "$ROOT" -- bash -l
  # Restart tunnel session command
  tmux -f "$TMUX_CONF" send-keys -t 'cloudflared-relay:0.0' C-c 2>/dev/null || true
  sleep 1
  tmux -f "$TMUX_CONF" send-keys -t 'cloudflared-relay:0.0' \
    "${CLOUDFLARED} tunnel --url http://127.0.0.1:${PORT} --no-autoupdate 2>&1 | tee /tmp/cf-tunnel-live.log" C-m
else
  pkill -f 'cloudflared tunnel --url' 2>/dev/null || true
  nohup "$CLOUDFLARED" tunnel --url "http://127.0.0.1:${PORT}" --no-autoupdate \
    >/tmp/cf-tunnel-live.log 2>&1 &
fi

TUN=""
for _ in $(seq 1 60); do
  TUN="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' /tmp/cf-tunnel-live.log | head -1 || true)"
  if [ -n "$TUN" ]; then
    if curl -fsS -m 8 "${TUN}/healthz" | grep -q '"ok":true'; then
      break
    fi
  fi
  sleep 1
done
if [ -z "$TUN" ]; then
  log "Failed to obtain trycloudflare URL"
  exit 1
fi
log "Tunnel ready: $TUN"

NONCE="$(python3 -c 'import secrets; print(secrets.token_hex(24))')"
curl -fsS -m 20 -X POST "$WORKER_REGISTER_URL" \
  -H 'content-type: application/json' \
  -d "{\"root\":\"${TUN}\",\"nonce\":\"${NONCE}\"}" >/tmp/relay-register.json
log "Registered: $(cat /tmp/relay-register.json)"

curl -fsS -m 15 "$WORKER_HEALTH_URL" | tee /tmp/relay-health.json
grep -q '"ok":true' /tmp/relay-health.json
log "Worker relay healthy"
