# Failure AI OAuth

Universal **PKCE OAuth** that any app can integrate. Users sign up with email and password, connect their AI providers once, then apps authenticate with a frosted-glass **Sign in with Failure** button.

## What users can connect

| Provider | Method |
|---|---|
| **Codex** | Official desktop OAuth (PKCE + `localhost:1455`, same as Codex CLI/Desktop) |
| **ChatGPT** | Tokens from [openai-oauth](https://github.com/EvanZhouDev/openai-oauth) |
| **Claude Code** | `claude setup-token` — **risk of account deletion** (Anthropic ToS) |
| **Grok Build** | Grok Build / xAI device-code OAuth |

## Quick start

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

Account providers config lives at `/account/providers` — stylized connect buttons for every provider. **ChatGPT is automated** via [`@openai-oauth/react`](https://github.com/EvanZhouDev/openai-oauth) (Sign in with ChatGPT); tokens sync into Failure on success.

## Deploy (Cloudflare Workers)

Production: **https://oauth.failure.fail**

```bash
pnpm run deploy
# or
pnpm exec opennextjs-cloudflare build && pnpm exec opennextjs-cloudflare deploy
```

Requires Wrangler auth (`CLOUDFLARE_API_TOKEN`). Data is stored in Cloudflare KV (`FAILURE_KV`). Secrets: `FAILURE_SESSION_SECRET`, `FAILURE_ENCRYPTION_KEY`.

## Integrate as an app

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

Or use the React component:

```tsx
import { SignInWithFailure } from "@/sdk/button";

<SignInWithFailure href="/oauth/authorize?..." />
```

### OAuth endpoints

- Discovery: `GET /.well-known/openid-configuration`
- Authorize: `GET /oauth/authorize`
- Token: `POST /api/oauth/token`
- UserInfo: `GET /api/oauth/userinfo`
- UI format: `GET /api/ui-format`

### PKCE token exchange

```bash
curl -X POST https://YOUR_HOST/api/oauth/token \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d 'grant_type=authorization_code' \
  -d 'client_id=YOUR_CLIENT_ID' \
  -d 'code=AUTH_CODE' \
  -d 'redirect_uri=https://yourapp.com/callback' \
  -d 'code_verifier=PKCE_VERIFIER'
```

UserInfo (with `providers` scope) returns linked Codex / ChatGPT / Claude / Grok credential packages for the signed-in user. Each package includes refreshed tokens plus the live endpoints and required headers for that provider (Codex/ChatGPT → `chatgpt.com/backend-api/codex` or a `FAILURE_CODEX_BASE_URL` relay, Claude → Anthropic OAuth headers, Grok → `cli-chat-proxy.grok.com`).

Codex/ChatGPT packages also advertise:
- GPT Image 2 generate/edit endpoints
- Thinking levels (`reasoning.effort`) and think-block response shape (`reasoning` items + `reasoning.encrypted_content`)

### Cloudflare Workers note

`chatgpt.com` blocks Cloudflare Worker egress. For production chat/models/images from Workers, run the included relay and set `FAILURE_CODEX_BASE_URL`:

```bash
pnpm relay:codex
# then expose that host and set FAILURE_CODEX_BASE_URL to it
```

## Universal UI format

`GET /api/ui-format` returns the canonical button theme, OAuth URLs, and card copy so every app can render Failure consistently.

## Security notes

- Provider secrets are encrypted at rest (AES-256-GCM).
- Claude Code connection requires explicit risk acknowledgement.
- Prefer public PKCE clients; confidential clients are supported via hashed client secrets.
- This project is not affiliated with OpenAI, Anthropic, xAI,.
