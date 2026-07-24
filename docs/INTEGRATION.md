# Integrate Failure AI OAuth into your app

Failure is a **PKCE OAuth 2.0** authorization server. Users create a Failure account, connect AI providers once, then sign into your app with **Sign in with Failure**. Your app receives tokens and (with the `providers` scope) live credential packages for Codex, Antigravity, Copilot, MiMo, Claude Code, Grok Build, and Kimi Code.

**Production**

| | |
|---|---|
| Base URL | `https://oauth.failure.fail` |
| Issuer | `https://oauth.failure.fail` |
| Developers | https://oauth.failure.fail/developers |
| Discovery | https://oauth.failure.fail/.well-known/openid-configuration |

Unaffiliated with OpenAI, Anthropic, or xAI.

---

## 1. Register your app

1. Sign up at https://oauth.failure.fail/signup
2. Open **Dashboard → Your apps**
3. Create a client:
   - **Public PKCE client** (recommended) — no client secret
   - Or confidential — secret shown once at creation
4. Add an exact **redirect URI** (e.g. `https://yourapp.com/callback`)

You get a `client_id` like `fail_…`.

---

## 2. OAuth endpoints

| Step | Method | URL |
|---|---|---|
| Discovery | `GET` | `https://oauth.failure.fail/.well-known/openid-configuration` |
| Authorize | `GET` | `https://oauth.failure.fail/oauth/authorize` |
| Token | `POST` | `https://oauth.failure.fail/api/oauth/token` |
| UserInfo | `GET` | `https://oauth.failure.fail/api/oauth/userinfo` |
| OpenAI models | `GET` | `https://oauth.failure.fail/v1/models` |
| OpenAI chat | `POST` | `https://oauth.failure.fail/v1/chat/completions` |
| UI format | `GET` | `https://oauth.failure.fail/api/ui-format` |

### Scopes

| Scope | What you get |
|---|---|
| `openid` | Subject (`sub`) |
| `profile` | `name` |
| `email` | `email` |
| `offline_access` | `refresh_token` (rotating, ~30 days) |
| `providers` | Linked provider **credential packages** in userinfo |

Recommended scope string:

```text
openid profile email providers offline_access
```

There is **no OIDC `id_token`**. Use the access token JWT + userinfo.

---

## 3. Sign-in flow (PKCE)

### A. Drop-in button (fastest)

```html
<link
  rel="stylesheet"
  href="https://oauth.failure.fail/sdk/sign-in-with-failure.css"
/>
<script src="https://oauth.failure.fail/sdk/sign-in-with-failure.js"></script>

<div
  data-failure-signin
  data-client-id="fail_YOUR_CLIENT_ID"
  data-redirect-uri="https://yourapp.com/callback"
  data-failure-origin="https://oauth.failure.fail"
></div>
```

Optional: `data-scope="openid profile email providers offline_access"`.

The SDK:

1. Generates `code_verifier` + S256 `code_challenge` + `state`
2. Stores `{ verifier, state }` in `sessionStorage` under `failure_oauth_<clientId>`
3. Redirects to `/oauth/authorize`

On your callback page:

```js
const params = new URLSearchParams(window.location.search);
const code = params.get("code");
const state = params.get("state");
const stored = window.FailureOAuth.getStoredPkce("fail_YOUR_CLIENT_ID");

if (!stored || stored.state !== state) throw new Error("Invalid state");

const body = new URLSearchParams({
  grant_type: "authorization_code",
  client_id: "fail_YOUR_CLIENT_ID",
  code,
  redirect_uri: "https://yourapp.com/callback",
  code_verifier: stored.verifier,
});

const tokenRes = await fetch("https://oauth.failure.fail/api/oauth/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body,
});
const tokens = await tokenRes.json();
// tokens.access_token, tokens.refresh_token, tokens.expires_in, tokens.scope
```

### B. Manual authorize URL

```text
https://oauth.failure.fail/oauth/authorize
  ?response_type=code
  &client_id=fail_YOUR_CLIENT_ID
  &redirect_uri=https://yourapp.com/callback
  &scope=openid%20profile%20email%20providers%20offline_access
  &code_challenge=<S256_CHALLENGE>
  &code_challenge_method=S256
  &state=<RANDOM_STATE>
```

User logs into Failure (if needed), consents, then returns to your `redirect_uri` with `?code=&state=`.

### C. Token exchange

`POST application/x-www-form-urlencoded` → `/api/oauth/token`

**Authorization code**

| Field | Required |
|---|---|
| `grant_type` | `authorization_code` |
| `client_id` | yes |
| `code` | yes |
| `redirect_uri` | yes (exact match) |
| `code_verifier` | yes (PKCE) |
| `client_secret` | confidential clients only |

**Refresh**

| Field | Required |
|---|---|
| `grant_type` | `refresh_token` |
| `client_id` | yes |
| `refresh_token` | yes |
| `client_secret` | confidential clients only |

Example response:

```json
{
  "access_token": "<JWT>",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "frt_...",
  "scope": "openid profile email providers offline_access"
}
```

Public clients use auth method `none`. Confidential clients may use `client_secret_post` or `client_secret_basic`.

---

## 4. UserInfo — profile + provider credentials

```http
GET /api/oauth/userinfo
Authorization: Bearer <access_token>
```

### Without `providers` scope

```json
{
  "sub": "user_…",
  "email": "you@example.com",
  "name": "You",
  "providers": [
    {
      "provider": "codex",
      "status": "connected",
      "label": "…",
      "connectedAt": "…",
      "updatedAt": "…",
      "meta": {}
    }
  ]
}
```

### With `providers` scope

Each connected provider includes a `credentials` object (tokens refreshed by Failure when possible):

```json
{
  "sub": "user_…",
  "email": "you@example.com",
  "name": "You",
  "providers": [
    {
      "provider": "codex",
      "status": "connected",
      "credentials": {
        "protocol": "codex_backend",
        "accessToken": "…",
        "refreshToken": "…",
        "expiresAt": 0,
        "accountId": "…",
        "models": [{ "id": "…", "name": "…", "kind": "chat" }],
        "modelsSource": "live",
        "capabilities": { "…": "…" },
        "endpoints": { "…": "…" },
        "requiredHeaders": { "…": "…" }
      }
    }
  ]
}
```

If refresh fails for a provider:

```json
{
  "credentials": {
    "error": "…",
    "reconnectRequired": true
  }
}
```

> Prefer calling upstream providers yourself with the credential package when you need streaming, tools, or images. For a drop-in OpenAI SDK path, see the next section.

---

## 4.1 OpenAI-compatible proxy (`/v1`)

Failure exposes a thin **OpenAI Chat Completions** surface so you can point the official OpenAI SDK (or any compatible client) at connected providers.

Auth is a Failure **API key** (`fsk_…` from the dashboard) or an OAuth access
token with the `providers` scope.

| | |
|---|---|
| Base URL | `https://oauth.failure.fail/v1` |
| Auth | `Authorization: Bearer <fsk_… or access_token>` |
| Create key | Dashboard → **OpenAI API** → Create API key |
| Models | `GET /v1/models` |
| Chat | `POST /v1/chat/completions` |

Model ids are **`provider/model`** (also accepts `provider:model`):

| Example | Provider |
|---|---|
| `codex/gpt-5.6-sol` | Codex |
| `copilot/gpt-4.1` | GitHub Copilot |
| `claude/claude-sonnet-4-20250514` | Claude Code |
| `kimi/kimi-for-coding` | Kimi Code |
| `mimo/mimo-v2.5-pro` | Xiaomi MiMo |
| `grok/grok-4` | Grok Build |
| `antigravity/gemini-2.5-pro` | Antigravity |

Optional header: `X-Failure-Provider: codex` with a bare model id.

### OpenAI SDK

```bash
export OPENAI_BASE_URL=https://oauth.failure.fail/v1
export OPENAI_API_KEY=fsk_…   # from Dashboard → OpenAI API
```

```js
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY, // fsk_…
  baseURL: "https://oauth.failure.fail/v1",
});

const models = await client.models.list();

const chat = await client.chat.completions.create({
  model: "codex/gpt-5.6-sol",
  messages: [
    { role: "system", content: "Be brief." },
    { role: "user", content: "Say hello." },
  ],
});

console.log(chat.choices[0].message.content);
```

`stream: true` is supported (Failure buffers the provider reply, then emits OpenAI SSE chunks).

`reasoning_effort` (`none` | `low` | `medium` | `high` | `xhigh`) maps to provider thinking where supported.

### curl

```bash
curl https://oauth.failure.fail/v1/chat/completions \
  -H "Authorization: Bearer $FAILURE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "kimi/kimi-for-coding",
    "messages": [{"role":"user","content":"Hello"}]
  }'
```

Errors use the OpenAI error envelope (`{ "error": { "message", "type", "code" } }`).

---

## 5. Use provider credentials in your backend

Failure’s `/api/chat` and `/api/images` are **dashboard session helpers** for testing. Integrating apps should call **provider endpoints directly** (from your server) using the credential package from userinfo — or use the OpenAI-compatible `/v1` proxy above.

If a provider’s credentials show `reconnectRequired`, ask the user to reconnect at https://oauth.failure.fail/account/providers.

### Codex (`protocol: "codex_backend"`)

Official Codex Desktop / CLI OAuth. Send Codex CLI identity headers:

```http
Authorization: Bearer <accessToken>
chatgpt-account-id: <accountId>
originator: codex_cli_rs
Accept: application/json
```

### Antigravity (`protocol: "antigravity_cloudcode"`)

Google Antigravity / Cloud Code Assist via OAuth PKCE (same public client as Antigravity IDE). Docs: https://github.com/NoeFabris/opencode-antigravity-auth

`credentials.models` is the **live account catalog** (same source as Failure chat via `fetchAvailableModels`). Prefer those ids over hardcoding. Also includes `projectId`, `modelsSource` (`live` | `fallback`), and optional `modelsWarning`.

**Required headers**

```http
Authorization: Bearer <accessToken>
Content-Type: application/json
User-Agent: antigravity/1.18.3 darwin/arm64
X-Goog-Api-Client: google-cloud-sdk vscode_cloudshelleditor/0.1
Client-Metadata: {"ideType":"ANTIGRAVITY","platform":"MACOS","pluginType":"GEMINI"}
```

**Chat example**

```js
const cred = providers.find((p) => p.provider === "antigravity").credentials;
const model = cred.models?.[0]?.id || "gemini-3-pro-high";

await fetch(cred.endpoints.streamGenerateContent, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${cred.accessToken}`,
    "Content-Type": "application/json",
    Accept: "text/event-stream",
    "User-Agent": "antigravity/1.18.3 darwin/arm64",
    "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
    "Client-Metadata": '{"ideType":"ANTIGRAVITY","platform":"MACOS","pluginType":"GEMINI"}',
  },
  body: JSON.stringify({
    project: cred.projectId,
    model,
    userAgent: "antigravity",
    requestType: "agent",
    request: {
      contents: [{ role: "user", parts: [{ text: "Hello" }] }],
      systemInstruction: { parts: [{ text: "You are helpful." }] },
      generationConfig: {
        maxOutputTokens: 4096,
        thinkingConfig: { thinkingBudget: 8192, includeThoughts: true },
      },
    },
  }),
});
```

### GitHub Copilot (`protocol: "github_copilot"`)

Device-code OAuth with the public Copilot GitHub App (`Iv1.b507a08c87ecfe98`). Failure stores a short-lived Copilot **session** token (`tid=…`) as `accessToken` and the long-lived GitHub `ghu_…` token as `refreshToken`.

Refresh: `GET credentials.endpoints.sessionToken` with `Authorization: Bearer <refreshToken>` plus the Copilot editor headers, then replace `accessToken`.

**Chat** — always stream:

```js
const cred = providers.find((p) => p.provider === "copilot").credentials;
const model = cred.models?.[0]?.id || "gpt-4.1";

await fetch(cred.endpoints.chatCompletions, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${cred.accessToken}`,
    Accept: "text/event-stream",
    "Content-Type": "application/json",
    ...cred.requiredHeaders,
  },
  body: JSON.stringify({
    stream: true,
    model,
    messages: [{ role: "user", content: "Hello" }],
  }),
});
```

### Xiaomi MiMo (`protocol: "xiaomi_mimo"`)

Same platform OAuth as **MiMo Code CLI** (`platform.xiaomimimo.com/authorize` with X25519 key exchange). Failure decrypts the returned payload into a managed API key (often `mimo-code-cli-key-…`) plus optional Token Plan `baseUrl`.

Manual API-key paste (`sk-` / `tp-`) remains supported as a fallback.

Supports OpenAI chat completions + optional `thinking: { type: "enabled" }` → `reasoning_content`.

```js
const cred = providers.find((p) => p.provider === "mimo").credentials;

await fetch(cred.endpoints.chatCompletions, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${cred.apiKey}`,
    "api-key": cred.apiKey,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: cred.models?.[0]?.id || "mimo-v2.5-pro",
    messages: [{ role: "user", content: "Hello" }],
    thinking: { type: "enabled" },
  }),
});
```

### Codex subscription Responses API

Codex talks to the ChatGPT subscription Responses surface.

**Endpoints** (from `credentials.endpoints`)

| Purpose | Path |
|---|---|
| Models | `{base}/models` |
| Chat (Responses) | `{base}/responses` |
| Image generate | `{base}/images/generations` |
| Image edit | `{base}/images/edits` |

`base` is either Failure’s configured relay (KV `failure-oauth:relay:codex`, or `FAILURE_CODEX_BASE_URL`) or `https://chatgpt.com/backend-api/codex`.

> **Cloudflare Workers cannot call `chatgpt.com` directly** (CF challenge). Call from a normal Node/VM host, or use the relay URL from credentials.

#### Chat example (Codex)

Subscription Responses expects `input` as a **list**, not a string:

```js
const cred = providers.find((p) => p.provider === "codex").credentials;

const res = await fetch(cred.endpoints.responses, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${cred.accessToken}`,
    "chatgpt-account-id": cred.accountId,
    "Content-Type": "application/json",
    Accept: "text/event-stream",
  },
  body: JSON.stringify({
    model: "gpt-5.6-sol", // use an id from /models for this account
    instructions: "You are a helpful assistant.",
    input: [
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Hello" }],
      },
    ],
    store: false,
    stream: true,
    include: ["reasoning.encrypted_content"],
    reasoning: {
      effort: "medium", // none | minimal | low | medium | high | xhigh
      summary: "detailed",
    },
  }),
});
```

**Think blocks** appear as output items:

```json
{
  "type": "reasoning",
  "summary": [{ "type": "summary_text", "text": "…" }],
  "encrypted_content": "<opaque — keep for multi-turn when store:false>"
}
```

#### Image example (GPT Image 2)

Model id: `gpt-image-2` (always supported for connected Codex accounts even when `/models` omits it).

```js
await fetch(cred.endpoints.imageGenerations, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${cred.accessToken}`,
    "chatgpt-account-id": cred.accountId,
    "Content-Type": "application/json",
    originator: "codex_cli_rs",
  },
  body: JSON.stringify({
    model: "gpt-image-2",
    prompt: "A ceramic mug on oak",
  }),
});
```

---

### Claude Code (`protocol: "anthropic_oauth"`)

**Risk:** Using Claude Code OAuth outside Claude Code can risk account deletion (Anthropic ToS). Surface this to your users.

```js
const cred = providers.find((p) => p.provider === "claude").credentials;
const token = cred.setupToken || cred.accessToken;

const res = await fetch(cred.endpoints.messages, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "anthropic-version": "2023-06-01",
    "anthropic-beta":
      "claude-code-20250219,oauth-2025-04-20,fine-grained-tool-streaming-2025-05-14",
    "anthropic-dangerous-direct-browser-access": "true",
    "User-Agent": "claude-cli/2.0.0 (external, your-app)",
    "x-app": "cli",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: "claude-sonnet-4-5", // pick from /v1/models
    max_tokens: 8192,
    thinking: {
      type: "enabled",
      budget_tokens: 4096,
      display: "summarized",
    },
    messages: [{ role: "user", content: "Hello" }],
  }),
});
```

Thinking blocks in the response have `type: "thinking"` (plus optional `signature`).

---

### Grok Build (`protocol: "grok_cli_proxy"`)

Uses **`cli-chat-proxy.grok.com`**, not `api.x.ai`.

```js
const cred = providers.find((p) => p.provider === "grok").credentials;

await fetch(cred.endpoints.responses, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${cred.accessToken}`,
    "X-XAI-Token-Auth": "xai-grok-cli",
    "x-authenticateresponse": "authenticate-response",
    "x-grok-client-version": "0.2.93",
    "x-grok-client-mode": "headless",
    "Content-Type": "application/json",
    Accept: "text/event-stream",
  },
  body: JSON.stringify({
    model: "<id from models-v2>",
    input: "Hello",
    store: false,
    stream: true,
  }),
});
```

Prefer headers/endpoints from the credential package over hardcoding versions.

---

### Kimi Code (`protocol: "kimi_code"`)

Same device OAuth as [MoonshotAI/kimi-cli](https://github.com/MoonshotAI/kimi-cli). OpenAI-compatible coding API at `https://api.kimi.com/coding/v1`.

> **Cloudflare Workers cannot call `api.kimi.com/coding` directly** (CF bot challenge HTML). OAuth against `auth.kimi.com` still works. For Worker-hosted chat/models, run `pnpm relay:kimi` and set `FAILURE_KIMI_BASE_URL`. Credential `endpoints.base` is the relay URL when configured.

```js
const cred = providers.find((p) => p.provider === "kimi").credentials;
const base = cred.endpoints.base; // relay or https://api.kimi.com/coding/v1

await fetch(`${base}/chat/completions`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${cred.accessToken}`,
    "Content-Type": "application/json",
    "User-Agent": cred.requiredHeaders["User-Agent"],
    "X-Msh-Platform": cred.requiredHeaders["X-Msh-Platform"],
    "X-Msh-Version": cred.requiredHeaders["X-Msh-Version"],
    Accept: "text/event-stream",
  },
  body: JSON.stringify({
    model: "kimi-for-coding",
    stream: true,
    messages: [{ role: "user", content: "Hello" }],
  }),
});
```

---

## 6. End-to-end checklist

1. User registers Failure account and connects providers at `/account/providers`
2. Your app starts PKCE authorize → consent → callback
3. Exchange `code` + `code_verifier` for tokens
4. Call userinfo with `providers` scope
5. From **your backend**, call provider endpoints with the package
6. Refresh Failure tokens with `refresh_token` before expiry
7. If a provider shows `reconnectRequired`, send the user back to Failure providers

---

## 7. Node / TypeScript sketch

```ts
type FailureTokens = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
};

export async function exchangeCode(input: {
  clientId: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
  origin?: string;
}): Promise<FailureTokens> {
  const origin = input.origin ?? "https://oauth.failure.fail";
  const res = await fetch(`${origin}/api/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: input.clientId,
      code: input.code,
      redirect_uri: input.redirectUri,
      code_verifier: input.codeVerifier,
    }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function userinfo(accessToken: string, origin = "https://oauth.failure.fail") {
  const res = await fetch(`${origin}/api/oauth/userinfo`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<{
    sub: string;
    email?: string;
    name?: string;
    providers: Array<{
      provider: "codex" | "antigravity" | "copilot" | "mimo" | "claude" | "grok" | "kimi";
      status: string;
      credentials?: Record<string, unknown>;
    }>;
  }>;
}
```

---

## 8. Security notes

- Prefer **public PKCE** clients; never embed confidential secrets in browsers
- Store `code_verifier` / tokens server-side when possible
- Treat provider `accessToken` / `setupToken` as secrets — do not leak to the browser unless intentional
- Always send `chatgpt-account-id` + `originator: codex_cli_rs` for Codex
- For **Antigravity**, send Google Cloud Code Assist headers + `project` in the body
- Claude Code OAuth carries **account-deletion risk** — require explicit user acknowledgement in your product
- Redirect URIs must match exactly (including scheme/host/path)
- Discovery may advertise revoke/jwks endpoints that are not implemented yet

---

## 9. Related links

| Resource | URL |
|---|---|
| Live AS | https://oauth.failure.fail |
| Developers page | https://oauth.failure.fail/developers |
| OpenID discovery | https://oauth.failure.fail/.well-known/openid-configuration |
| UI format JSON | https://oauth.failure.fail/api/ui-format |
| Drop-in JS | https://oauth.failure.fail/sdk/sign-in-with-failure.js |
| Drop-in CSS | https://oauth.failure.fail/sdk/sign-in-with-failure.css |
| Connect providers (users) | https://oauth.failure.fail/account/providers |
