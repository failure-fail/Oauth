# Failure AI OAuth

Universal **PKCE OAuth** that any app can integrate. Users sign up with email and password, connect their AI providers once, then apps authenticate with a frosted-glass **Sign in with Failure** button.

## What users can connect

| Provider | Method |
|---|---|
| **Codex** | Desktop OAuth (OpenAI Codex PKCE / localhost callback) |
| **ChatGPT** | Tokens from [openai-oauth](https://github.com/EvanZhouDev/openai-oauth) |
| **Claude Code** | `claude setup-token` — **risk of account deletion** (Anthropic ToS) |
| **Grok Build** | Grok Build / xAI device-code OAuth |
| **Cursor** | Account API key from Dashboard → Integrations |

## Quick start

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

### Env (optional)

```bash
FAILURE_OAUTH_BASE_URL=http://localhost:3000
FAILURE_OAUTH_ISSUER=http://localhost:3000
FAILURE_SESSION_SECRET=replace-me
FAILURE_ENCRYPTION_KEY=replace-me
```

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

UserInfo (with `providers` scope) returns linked Codex / ChatGPT / Claude / Grok / Cursor credentials for the signed-in user.

## Universal UI format

`GET /api/ui-format` returns the canonical button theme, OAuth URLs, and card copy so every app can render Failure consistently.

## Security notes

- Provider secrets are encrypted at rest (AES-256-GCM).
- Claude Code connection requires explicit risk acknowledgement.
- Prefer public PKCE clients; confidential clients are supported via hashed client secrets.
- This project is not affiliated with OpenAI, Anthropic, xAI, or Cursor.
