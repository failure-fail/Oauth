# Failure AI OAuth

Universal **PKCE OAuth** that any app can integrate. Users sign up with email and password, connect their AI providers once, then apps authenticate with a frosted-glass **Sign in with Failure** button.

## What users can connect

| Provider | Method |
|---|---|
| **Codex** | Official desktop OAuth (PKCE + `localhost:1455`, same as Codex CLI/Desktop) |
| **Antigravity** | Google OAuth PKCE (`localhost:51121`) — Cloud Code Assist / Antigravity IDE client |
| **GitHub Copilot** | Device-code OAuth (VS Code Copilot GitHub App) → session token |
| **Mistral** | API key from console.mistral.ai (Le Chat / Vibe / pay-as-you-go) |
| **Xiaomi MiMo** | API key from mimo.mi.com (`sk-` paygo or `tp-` Token Plan) |
| **Claude Code** | `claude setup-token` — **risk of account deletion** (Anthropic ToS) |
| **Grok Build** | Grok Build / xAI device-code OAuth |

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

Full guide: **[docs/INTEGRATION.md](./docs/INTEGRATION.md)** (PKCE, userinfo credential packages, Codex/Antigravity/Claude/Grok call shapes).

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
- **Mistral** → `protocol: "mistral_api"`
- **Xiaomi MiMo** → `protocol: "xiaomi_mimo"`
- Claude → Anthropic OAuth headers
- Grok → `cli-chat-proxy.grok.com`

### Cloudflare Workers note

`chatgpt.com` blocks Cloudflare Worker egress for Codex. For production Codex chat/models/images from Workers, run the included relay and set `FAILURE_CODEX_BASE_URL`:

```bash
pnpm relay:codex
```

## Security notes

- Provider secrets are encrypted at rest (AES-256-GCM).
- Claude Code connection requires explicit risk acknowledgement.
- Prefer public PKCE clients; confidential clients are supported via hashed client secrets.
- This project is not affiliated with OpenAI, Google, Anthropic, or xAI.
