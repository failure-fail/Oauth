import { SignJWT, jwtVerify } from "jose";
import { createHash } from "crypto";
import { config, randomToken } from "./config";
import { pkceChallengeFromVerifier, safeEqual } from "./crypto";
import { db } from "./db";

const encoder = new TextEncoder();

function signingKey() {
  return encoder.encode(config.sessionSecret);
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function validateRedirectUri(clientRedirectUris: string[], uri: string) {
  return clientRedirectUris.includes(uri);
}

export function verifyPkce(
  verifier: string,
  challenge: string,
  method: "S256" | "plain",
) {
  if (method === "plain") return safeEqual(verifier, challenge);
  return safeEqual(pkceChallengeFromVerifier(verifier), challenge);
}

export async function mintAccessToken(input: {
  userId: string;
  clientId: string;
  scope: string;
  email: string;
  name: string;
}) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    sub: input.userId,
    client_id: input.clientId,
    scope: input.scope,
    email: input.email,
    name: input.name,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(config.jwtIssuer)
    .setAudience(input.clientId)
    .setIssuedAt(now)
    .setExpirationTime(now + config.accessTokenTtlSec)
    .sign(signingKey());
}

export async function verifyAccessToken(token: string) {
  const { payload } = await jwtVerify(token, signingKey(), {
    issuer: config.jwtIssuer,
  });
  return payload;
}

export async function issueAuthorizationCode(input: {
  clientId: string;
  userId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: "S256" | "plain";
  scope: string;
}) {
  const code = randomToken(24);
  await db.saveAuthCode({
    code,
    clientId: input.clientId,
    userId: input.userId,
    redirectUri: input.redirectUri,
    codeChallenge: input.codeChallenge,
    codeChallengeMethod: input.codeChallengeMethod,
    scope: input.scope,
    expiresAt: Date.now() + config.authCodeTtlSec * 1000,
    used: false,
  });
  return code;
}

export async function issueRefreshToken(input: {
  clientId: string;
  userId: string;
  scope: string;
}) {
  const token = `frt_${randomToken(32)}`;
  await db.saveRefreshToken({
    tokenHash: hashToken(token),
    clientId: input.clientId,
    userId: input.userId,
    scope: input.scope,
    expiresAt: Date.now() + config.refreshTokenTtlSec * 1000,
    revoked: false,
  });
  return token;
}

export function discoveryDocument() {
  const base = config.baseUrl.replace(/\/$/, "");
  return {
    issuer: config.jwtIssuer,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/api/oauth/token`,
    userinfo_endpoint: `${base}/api/oauth/userinfo`,
    revocation_endpoint: `${base}/api/oauth/revoke`,
    jwks_uri: `${base}/api/oauth/jwks`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256", "plain"],
    token_endpoint_auth_methods_supported: [
      "none",
      "client_secret_post",
      "client_secret_basic",
    ],
    scopes_supported: ["openid", "profile", "email", "offline_access", "providers"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["HS256"],
    service_documentation: `${base}/developers`,
    ui_locales_supported: ["en"],
    claims_supported: [
      "sub",
      "email",
      "name",
      "providers",
      "iss",
      "aud",
      "exp",
      "iat",
    ],
  };
}

export function universalUiFormat() {
  return {
    brand: "Failure",
    product: "Failure AI OAuth",
    button: {
      id: "sign-in-with-failure",
      label: "Sign in with Failure",
      recommendedHeight: 48,
      recommendedMinWidth: 260,
      theme: {
        surface: "frosted-glass",
        background:
          "linear-gradient(135deg, rgba(255,255,255,0.18), rgba(255,255,255,0.05))",
        border: "1px solid rgba(255,255,255,0.28)",
        blur: "18px",
        text: "#fff7ed",
        accent: "#ff6b35",
        shadow: "0 10px 40px rgba(0,0,0,0.35)",
        radius: "999px",
        fontFamily: '"Syne", "Figtree", sans-serif',
      },
      cssClass: "failure-signin-btn",
      scriptUrl: `${config.baseUrl.replace(/\/$/, "")}/sdk/sign-in-with-failure.js`,
      cssUrl: `${config.baseUrl.replace(/\/$/, "")}/sdk/sign-in-with-failure.css`,
    },
    oauth: {
      authorize: `${config.baseUrl.replace(/\/$/, "")}/oauth/authorize`,
      token: `${config.baseUrl.replace(/\/$/, "")}/api/oauth/token`,
      userinfo: `${config.baseUrl.replace(/\/$/, "")}/api/oauth/userinfo`,
      discovery: `${config.baseUrl.replace(/\/$/, "")}/.well-known/openid-configuration`,
      pkceRequired: true,
      responseType: "code",
      defaultScopes: ["openid", "profile", "email", "providers", "offline_access"],
    },
    card: {
      title: "Sign in with Failure",
      subtitle: "One OAuth for Codex, Antigravity, Claude Code, and Grok Build.",
      accent: "ember-glass",
    },
  };
}
