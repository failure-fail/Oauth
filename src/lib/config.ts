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

export const CODEX_OAUTH = {
  // Official Codex CLI / Desktop public OAuth client
  clientId: "app_EMoamEEZ73f0CkXaXp7hrann",
  authorizeUrl: "https://auth.openai.com/oauth/authorize",
  tokenUrl: "https://auth.openai.com/oauth/token",
  // Desktop Codex listens on this loopback callback (same as Codex CLI/Desktop)
  redirectUri: "http://localhost:1455/auth/callback",
  port: 1455,
  scope:
    "openid profile email offline_access api.connectors.read api.connectors.invoke",
  originator: "failure_ai_oauth",
};

export const GROK_OAUTH = {
  clientId: "b1a00492-073a-47ea-816f-4c329264a828",
  deviceCodeUrl: "https://auth.x.ai/oauth2/device/code",
  tokenUrl: "https://auth.x.ai/oauth2/token",
  scope: "openid profile email offline_access grok-cli:access api:access",
  grantType: "urn:ietf:params:oauth:grant-type:device_code",
};
