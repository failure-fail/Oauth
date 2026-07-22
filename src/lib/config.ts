import { createHash, randomBytes } from "crypto";
export type { ProviderId } from "./providers-meta";
export { PROVIDERS } from "./providers-meta";

function env(name: string, fallback: string) {
  return process.env[name]?.trim() || fallback;
}

export const config = {
  appName: "Failure AI OAuth",
  brand: "Failure",
  baseUrl: env("FAILURE_OAUTH_BASE_URL", "http://localhost:3000"),
  sessionSecret: env(
    "FAILURE_SESSION_SECRET",
    createHash("sha256").update("failure-dev-session").digest("hex"),
  ),
  encryptionKey: env(
    "FAILURE_ENCRYPTION_KEY",
    createHash("sha256").update("failure-dev-encryption").digest("hex"),
  ),
  jwtIssuer: env("FAILURE_OAUTH_ISSUER", "http://localhost:3000"),
  accessTokenTtlSec: 60 * 60,
  refreshTokenTtlSec: 60 * 60 * 24 * 30,
  authCodeTtlSec: 60 * 10,
  sessionCookie: "failure_session",
  dataDir: env("FAILURE_DATA_DIR", "data"),
};

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

export const OPENAI_OAUTH = {
  // Shared OpenAI OAuth client used by Codex CLI and openai-oauth / Sign in with ChatGPT
  // https://github.com/EvanZhouDev/openai-oauth
  clientId: "app_EMoamEEZ73f0CkXaXp7hrann",
  issuer: "https://auth.openai.com",
  authorizeUrl: "https://auth.openai.com/oauth/authorize",
  tokenUrl: "https://auth.openai.com/oauth/token",
  scope: "openid profile email offline_access",
  // Historical path name on chatgpt.com — used by both Codex CLI and openai-oauth
  baseUrl: "https://chatgpt.com/backend-api/codex",
  sdkDocs: "https://github.com/EvanZhouDev/openai-oauth",
};

export const CODEX_OAUTH = {
  // Official Codex CLI / Desktop public OAuth client (same client id as OPENAI_OAUTH)
  clientId: OPENAI_OAUTH.clientId,
  authorizeUrl: OPENAI_OAUTH.authorizeUrl,
  tokenUrl: OPENAI_OAUTH.tokenUrl,
  // Desktop Codex listens on this loopback callback (same as Codex CLI/Desktop)
  redirectUri: "http://localhost:1455/auth/callback",
  port: 1455,
  // Official Codex login scope — extra scopes break token usability for models
  scope: OPENAI_OAUTH.scope,
  originator: "codex_cli_rs",
  modelsUrl: `${OPENAI_OAUTH.baseUrl}/models`,
  responsesUrl: `${OPENAI_OAUTH.baseUrl}/responses`,
  imageGenerationsUrl: `${OPENAI_OAUTH.baseUrl}/images/generations`,
  imageEditsUrl: `${OPENAI_OAUTH.baseUrl}/images/edits`,
  imageModel: "gpt-image-2",
};

/** ChatGPT via Sign in with ChatGPT (@openai-oauth/react) — not Codex CLI identity. */
export const CHATGPT_OAUTH = {
  clientId: OPENAI_OAUTH.clientId,
  issuer: OPENAI_OAUTH.issuer,
  authorizeUrl: OPENAI_OAUTH.authorizeUrl,
  tokenUrl: OPENAI_OAUTH.tokenUrl,
  scope: OPENAI_OAUTH.scope,
  baseUrl: OPENAI_OAUTH.baseUrl,
  modelsUrl: `${OPENAI_OAUTH.baseUrl}/models`,
  responsesUrl: `${OPENAI_OAUTH.baseUrl}/responses`,
  imageGenerationsUrl: `${OPENAI_OAUTH.baseUrl}/images/generations`,
  imageEditsUrl: `${OPENAI_OAUTH.baseUrl}/images/edits`,
  imageModel: "gpt-image-2",
  sdk: "@openai-oauth/react",
  sdkDocs: OPENAI_OAUTH.sdkDocs,
  // openai-oauth applyAuthHeaders does NOT send Codex CLI originator / UA
  requiredHeaderNames: ["Authorization", "chatgpt-account-id"] as const,
};

export const GROK_OAUTH = {
  clientId: "b1a00492-073a-47ea-816f-4c329264a828",
  deviceCodeUrl: "https://auth.x.ai/oauth2/device/code",
  tokenUrl: "https://auth.x.ai/oauth2/token",
  scope: "openid profile email offline_access grok-cli:access api:access",
  grantType: "urn:ietf:params:oauth:grant-type:device_code",
  // Grok Build OAuth tokens talk to the CLI chat proxy, not api.x.ai
  proxyBaseUrl: "https://cli-chat-proxy.grok.com/v1",
  modelsUrl: "https://cli-chat-proxy.grok.com/v1/models-v2",
  responsesUrl: "https://cli-chat-proxy.grok.com/v1/responses",
  clientVersion: "0.2.93",
  tokenAuth: "xai-grok-cli",
};

export const CLAUDE_OAUTH = {
  modelsUrl: "https://api.anthropic.com/v1/models",
  messagesUrl: "https://api.anthropic.com/v1/messages",
  version: "2023-06-01",
  beta: "claude-code-20250219,oauth-2025-04-20,fine-grained-tool-streaming-2025-05-14",
  userAgent: "claude-cli/2.0.0 (external, failure-ai-oauth)",
};
