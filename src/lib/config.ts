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

/** OpenAI OAuth client used by official Codex CLI / Desktop. */
export const CODEX_OAUTH = {
  clientId: "app_EMoamEEZ73f0CkXaXp7hrann",
  authorizeUrl: "https://auth.openai.com/oauth/authorize",
  tokenUrl: "https://auth.openai.com/oauth/token",
  redirectUri: "http://localhost:1455/auth/callback",
  port: 1455,
  scope: "openid profile email offline_access",
  originator: "codex_cli_rs",
  baseUrl: "https://chatgpt.com/backend-api/codex",
  modelsUrl: "https://chatgpt.com/backend-api/codex/models",
  responsesUrl: "https://chatgpt.com/backend-api/codex/responses",
  imageGenerationsUrl:
    "https://chatgpt.com/backend-api/codex/images/generations",
  imageEditsUrl: "https://chatgpt.com/backend-api/codex/images/edits",
  imageModel: "gpt-image-2",
};

/**
 * Google Antigravity (Cloud Code Assist) OAuth — same public client as
 * opencode-antigravity-auth / Antigravity IDE.
 * https://github.com/NoeFabris/opencode-antigravity-auth
 */
export const ANTIGRAVITY_OAUTH = {
  clientId:
    "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com",
  clientSecret: "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",
  authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  userInfoUrl: "https://www.googleapis.com/oauth2/v1/userinfo?alt=json",
  redirectUri: "http://localhost:51121/oauth-callback",
  port: 51121,
  scopes: [
    "https://www.googleapis.com/auth/cloud-platform",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
    "https://www.googleapis.com/auth/cclog",
    "https://www.googleapis.com/auth/experimentsandconfigs",
  ],
  endpoints: {
    prod: "https://cloudcode-pa.googleapis.com",
    daily: "https://daily-cloudcode-pa.sandbox.googleapis.com",
    autopush: "https://autopush-cloudcode-pa.sandbox.googleapis.com",
  },
  defaultProjectId: "rising-fact-p41fc",
  version: "1.18.3",
  docsUrl: "https://github.com/NoeFabris/opencode-antigravity-auth",
};

export const GROK_OAUTH = {
  clientId: "b1a00492-073a-47ea-816f-4c329264a828",
  deviceCodeUrl: "https://auth.x.ai/oauth2/device/code",
  tokenUrl: "https://auth.x.ai/oauth2/token",
  scope: "openid profile email offline_access grok-cli:access api:access",
  grantType: "urn:ietf:params:oauth:grant-type:device_code",
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

/**
 * GitHub Copilot — identical to VS Code Copilot Chat / OpenCode.
 * Client ID Iv1.b507a08c87ecfe98 is the public VS Code GitHub App.
 * Device + token requests use JSON bodies (not form-urlencoded).
 */
export const COPILOT_OAUTH = {
  clientId: "Iv1.b507a08c87ecfe98",
  deviceCodeUrl: "https://github.com/login/device/code",
  accessTokenUrl: "https://github.com/login/oauth/access_token",
  sessionTokenUrl: "https://api.github.com/copilot_internal/v2/token",
  scope: "read:user",
  /** OpenCode / VS Code default host for individual accounts. */
  defaultApiBase: "https://api.githubcopilot.com",
  headers: {
    "User-Agent": "GitHubCopilotChat/0.35.0",
    "Editor-Version": "vscode/1.107.0",
    "Editor-Plugin-Version": "copilot-chat/0.35.0",
    "Copilot-Integration-Id": "vscode-chat",
  },
};

/**
 * Kimi Code — same public OAuth client as MoonshotAI/kimi-cli.
 * Device flow against auth.kimi.com; OpenAI-compatible coding API.
 */
export const KIMI_OAUTH = {
  clientId: "17e5f671-d194-4dfb-9706-5516cb48c098",
  deviceCodeUrl: "https://auth.kimi.com/api/oauth/device_authorization",
  tokenUrl: "https://auth.kimi.com/api/oauth/token",
  grantType: "urn:ietf:params:oauth:grant-type:device_code",
  apiBase: "https://api.kimi.com/coding/v1",
  docsUrl: "https://www.kimi.com/code",
  /** Must match MoonshotAI/kimi-cli — coding API 403s other UA prefixes. */
  platform: "kimi_cli",
  version: "1.49.0",
  userAgent: "KimiCLI/1.49.0",
  /**
   * Spoofed desktop fingerprint for Worker egress.
   * Never advertise cloudflare-worker — api.kimi.com is behind Cloudflare and
   * that label triggers bot challenges (HTML "Attention Required!").
   * Shapes mirror kimi-cli `_device_model()` / `platform.version()` on macOS.
   */
  deviceName: "MacBook-Pro.local",
  deviceModel: "macOS 15.3.1 arm64",
  osVersion:
    "Darwin Kernel Version 24.3.0: Thu Jan 2 20:24:16 PST 2025; root:xnu-11417.81.5~1/RELEASE_ARM64_T6000",
};

/**
 * Xiaomi MiMo API Open Platform.
 * OAuth (same as MiMo Code CLI): https://platform.xiaomimimo.com/authorize
 * Pay-as-you-go: sk-… @ api.xiaomimimo.com
 * Token Plan: tp-… @ token-plan-cn.xiaomimimo.com (or the URL shown in console)
 */
export const MIMO_API = {
  platformUrl: "https://platform.xiaomimimo.com",
  paygBaseUrl: "https://api.xiaomimimo.com/v1",
  tokenPlanBaseUrl: "https://token-plan-cn.xiaomimimo.com/v1",
  anthropicPaygBaseUrl: "https://api.xiaomimimo.com/anthropic",
  docsUrl:
    "https://mimo.mi.com/docs/en-US/tokenplan/integration/mimo-code",
  consoleUrl: "https://platform.xiaomimimo.com/",
};
