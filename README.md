# Failure AI OAuth

Universal **PKCE OAuth** that any app can integrate. Users sign up with email and password, connect their AI providers once, then apps authenticate with a frosted-glass **Sign in with Failure** button.

## What users can connect

| Provider | Method |
|---|---|
| **Codex** | Official desktop OAuth (PKCE + `localhost:1455`, same as Codex CLI/Desktop) |
| **Antigravity** | Google OAuth PKCE (`localhost:51121`) — Cloud Code Assist / Antigravity IDE client |
| **GitHub Copilot** | Device-code OAuth (VS Code Copilot GitHub App) → session token |
| **Xiaomi MiMo** | Platform OAuth (`platform.xiaomimimo.com`, same as MiMo Code CLI) |
| **Claude Code** | `claude setup-token` — **risk of account deletion** (Anthropic ToS) |
| **Grok Build** | Grok Build / xAI device-code OAuth |
| **Kimi Code** | Device OAuth (same public client as MoonshotAI/kimi-cli) or API key |

## Quick start

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

Account providers config lives at `/account/providers`.

## Deploy (Cloudflare Workers)

Production: **https://oauth.failure.fail**

```bash
pnpm run deploy
```

Requires Wrangler auth (`CLOUDFLARE_API_TOKEN`). Data is stored in Cloudflare KV (`FAILURE_KV`). Secrets: `FAILURE_SESSION_SECRET`, `FAILURE_ENCRYPTION_KEY`.

## Integrate as an app

Full guide: **[docs/INTEGRATION.md](./docs/INTEGRATION.md)** (PKCE, OpenAI-compatible `/v1` chat, userinfo credential packages, Codex/Antigravity/Claude/Grok call shapes).

### OpenAI-compatible API

Point any OpenAI SDK at Failure with a user access token (`providers` scope):

```bash
export OPENAI_BASE_URL=https://oauth.failure.fail/v1
export OPENAI_API_KEY=fsk_…   # Dashboard → OpenAI API
```

Model ids are `provider/model` (e.g. `codex/gpt-5.6-sol`, `kimi/kimi-for-coding`). Multimodal user messages with OpenAI `image_url` content parts are supported (https or `data:image/…`). See INTEGRATION.md § OpenAI-compatible proxy.

Quick path:

1. Create a Failure account and open **Dashboard → Your apps**.
2. Register a public PKCE client + redirect URI.
3. Drop in the universal button:

```html
<link rel="stylesheet" href="https://YOUR_HOST/sdk/sign-in-with-failure.css" />
<script src="https://YOUR_HOST/sdk/sign-in-with-failure.js"></script>
<div
  data-failure-signin
  data-client-id="YOUR_CLIENT_ID"
  data-redirect-uri="https://yourapp.com/callback"
  data-failure-origin="https://YOUR_HOST"
></div>
```

### OAuth endpoints

- Discovery: `GET /.well-known/openid-configuration`
- Authorize: `GET /oauth/authorize`
- Token: `POST /api/oauth/token`
- UserInfo: `GET /api/oauth/userinfo`
- UI format: `GET /api/ui-format`

UserInfo (with `providers` scope) returns linked credential packages:

- **Codex** → `protocol: "codex_backend"` with `originator: codex_cli_rs`
- **Antigravity** → `protocol: "antigravity_cloudcode"` (Google Cloud Code Assist)
- **GitHub Copilot** → `protocol: "github_copilot"` (session `tid=` token + GitHub refresh)
- **Xiaomi MiMo** → `protocol: "xiaomi_mimo"` (platform OAuth → managed API key)
- Claude → Anthropic OAuth headers
- Grok → `cli-chat-proxy.grok.com`

### Cloudflare Workers note

`chatgpt.com` and `api.kimi.com/coding` block Cloudflare Worker egress. Run the unified Node relay + cloudflared supervisor; it publishes live tunnel URLs into KV (`failure-oauth:relay:codex` / `failure-oauth:relay:kimi`) so hostname rotations do not need a Worker redeploy:

```bash
pnpm relay:providers
```

The supervisor pings the public tunnel every ~15s. On CF 1016/1033, timeouts, or bad `/healthz`, it kills cloudflared, starts a fresh quick tunnel, and re-publishes KV automatically.

Optional local overrides: `FAILURE_CODEX_BASE_URL` / `FAILURE_KIMI_BASE_URL` (used only when KV has no relay URL).
## Security notes

- Provider secrets are encrypted at rest (AES-256-GCM).
- Claude Code connection requires explicit risk acknowledgement.
- Prefer public PKCE clients; confidential clients are supported via hashed client secrets.
- This project is not affiliated with OpenAI, Google, Anthropic, or xAI.
