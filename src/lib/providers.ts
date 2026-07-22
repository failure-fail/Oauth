import { randomUUID } from "crypto";
import { CODEX_OAUTH, GROK_OAUTH, type ProviderId } from "./config";
import { encryptSecret, decryptSecret, pkceChallengeFromVerifier } from "./crypto";
import { db } from "./db";
import { randomToken } from "./config";

export type StoredProviderSecret = {
  type: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  accountKey?: string;
  setupToken?: string;
  raw?: Record<string, unknown>;
};

export function storeProviderSecret(secret: StoredProviderSecret) {
  return encryptSecret(JSON.stringify(secret));
}

export function readProviderSecret(encrypted: string): StoredProviderSecret {
  return JSON.parse(decryptSecret(encrypted)) as StoredProviderSecret;
}

export function startCodexDesktopOAuth(userId: string) {
  const verifier = randomToken(48);
  const challenge = pkceChallengeFromVerifier(verifier);
  const state = randomToken(24);
  const params = new URLSearchParams({
    response_type: "code",
    client_id: CODEX_OAUTH.clientId,
    redirect_uri: CODEX_OAUTH.redirectUri,
    scope: CODEX_OAUTH.scope,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true",
  });
  const authorizeUrl = `${CODEX_OAUTH.authorizeUrl}?${params.toString()}`;
  const flowId = randomUUID();
  db.savePendingFlow({
    id: flowId,
    userId,
    provider: "codex",
    encryptedState: encryptSecret(
      JSON.stringify({ verifier, state, authorizeUrl }),
    ),
    expiresAt: Date.now() + 1000 * 60 * 15,
  });
  return {
    flowId,
    authorizeUrl,
    redirectUri: CODEX_OAUTH.redirectUri,
    instructions: [
      "Open the Codex authorize URL on this machine (desktop OAuth).",
      "Complete sign-in in the browser.",
      "After redirect to localhost:1455, paste the full callback URL or the code below.",
    ],
  };
}

export async function completeCodexDesktopOAuth(input: {
  userId: string;
  flowId: string;
  callbackUrlOrCode: string;
}) {
  const flow = db.getPendingFlow(input.flowId, input.userId);
  if (!flow || flow.provider !== "codex") {
    throw new Error("Codex flow not found or expired");
  }
  const statePayload = JSON.parse(decryptSecret(flow.encryptedState)) as {
    verifier: string;
    state: string;
  };

  let code = input.callbackUrlOrCode.trim();
  let returnedState: string | null = null;
  try {
    if (code.includes("://")) {
      const url = new URL(code);
      code = url.searchParams.get("code") || "";
      returnedState = url.searchParams.get("state");
    } else if (code.includes("#")) {
      const [c, s] = code.split("#");
      code = c;
      returnedState = s || null;
    }
  } catch {
    // treat as raw code
  }
  if (!code) throw new Error("Missing authorization code");
  if (returnedState && returnedState !== statePayload.state) {
    throw new Error("State mismatch");
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: CODEX_OAUTH.clientId,
    code,
    redirect_uri: CODEX_OAUTH.redirectUri,
    code_verifier: statePayload.verifier,
  });
  const res = await fetch(CODEX_OAUTH.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Codex token exchange failed: ${res.status} ${text}`);
  }
  const json = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };
  const conn = db.upsertConnection({
    userId: input.userId,
    provider: "codex",
    status: "connected",
    label: "Codex desktop OAuth",
    encryptedPayload: storeProviderSecret({
      type: "codex_oauth",
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresAt: json.expires_in
        ? Date.now() + json.expires_in * 1000
        : undefined,
      raw: json as unknown as Record<string, unknown>,
    }),
    meta: { method: "desktop_oauth" },
  });
  db.deletePendingFlow(input.flowId);
  return conn;
}

export function connectChatGptTokens(
  userId: string,
  tokens: {
    accessToken: string;
    refreshToken?: string;
    expiresAt?: number;
    accountId?: string;
  },
) {
  return db.upsertConnection({
    userId,
    provider: "chatgpt",
    status: "connected",
    label: tokens.accountId
      ? `ChatGPT ${tokens.accountId.slice(0, 8)}`
      : "ChatGPT via openai-oauth",
    encryptedPayload: storeProviderSecret({
      type: "chatgpt_oauth",
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      raw: tokens as unknown as Record<string, unknown>,
    }),
    meta: {
      method: "openai_oauth",
      source: "https://github.com/EvanZhouDev/openai-oauth",
    },
  });
}

export function connectClaudeSetupToken(userId: string, setupToken: string) {
  const token = setupToken.trim();
  if (!token) throw new Error("Setup token required");
  return db.upsertConnection({
    userId,
    provider: "claude",
    status: "connected",
    label: "Claude Code setup token",
    encryptedPayload: storeProviderSecret({
      type: "claude_setup_token",
      setupToken: token,
      accessToken: token,
    }),
    meta: {
      method: "setup_token",
      riskAcknowledged: true,
      warning:
        "Using Claude Code OAuth outside Claude Code can risk account deletion.",
    },
  });
}

export async function startGrokDeviceOAuth(userId: string) {
  const body = new URLSearchParams({
    client_id: GROK_OAUTH.clientId,
    scope: GROK_OAUTH.scope,
  });
  const res = await fetch(GROK_OAUTH.deviceCodeUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "User-Agent": "FailureAI-OAuth/1.0",
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Grok device code failed: ${res.status} ${text}`);
  }
  const json = (await res.json()) as {
    device_code: string;
    user_code: string;
    verification_uri: string;
    verification_uri_complete?: string;
    expires_in: number;
    interval?: number;
  };
  const flowId = randomUUID();
  db.savePendingFlow({
    id: flowId,
    userId,
    provider: "grok",
    encryptedState: encryptSecret(
      JSON.stringify({
        deviceCode: json.device_code,
        interval: json.interval ?? 5,
      }),
    ),
    expiresAt: Date.now() + json.expires_in * 1000,
  });
  return {
    flowId,
    userCode: json.user_code,
    verificationUri: json.verification_uri,
    verificationUriComplete: json.verification_uri_complete,
    expiresIn: json.expires_in,
    interval: json.interval ?? 5,
  };
}

export async function pollGrokDeviceOAuth(input: {
  userId: string;
  flowId: string;
}) {
  const flow = db.getPendingFlow(input.flowId, input.userId);
  if (!flow || flow.provider !== "grok") {
    throw new Error("Grok flow not found or expired");
  }
  const state = JSON.parse(decryptSecret(flow.encryptedState)) as {
    deviceCode: string;
    interval: number;
  };
  const body = new URLSearchParams({
    grant_type: GROK_OAUTH.grantType,
    client_id: GROK_OAUTH.clientId,
    device_code: state.deviceCode,
  });
  const res = await fetch(GROK_OAUTH.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "User-Agent": "FailureAI-OAuth/1.0",
    },
    body,
  });
  const json = (await res.json()) as {
    error?: string;
    error_description?: string;
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!res.ok || json.error) {
    if (
      json.error === "authorization_pending" ||
      json.error === "slow_down"
    ) {
      return {
        status: json.error as "authorization_pending" | "slow_down",
        interval: state.interval,
      };
    }
    throw new Error(
      json.error_description || json.error || `Grok poll failed (${res.status})`,
    );
  }
  if (!json.access_token) throw new Error("Missing Grok access token");
  const conn = db.upsertConnection({
    userId: input.userId,
    provider: "grok",
    status: "connected",
    label: "Grok Build OAuth",
    encryptedPayload: storeProviderSecret({
      type: "grok_build_oauth",
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresAt: json.expires_in
        ? Date.now() + json.expires_in * 1000
        : undefined,
      raw: json as unknown as Record<string, unknown>,
    }),
    meta: { method: "device_oauth" },
  });
  db.deletePendingFlow(input.flowId);
  return { status: "connected" as const, connection: conn };
}

export function connectCursorAccountKey(userId: string, accountKey: string) {
  const key = accountKey.trim();
  if (!key) throw new Error("Cursor account key required");
  return db.upsertConnection({
    userId,
    provider: "cursor",
    status: "connected",
    label: "Cursor account key",
    encryptedPayload: storeProviderSecret({
      type: "cursor_account_key",
      accountKey: key,
      accessToken: key,
    }),
    meta: {
      method: "account_key",
      dashboard: "https://cursor.com/dashboard/integrations",
    },
  });
}

export function connectionPublicView(
  conn: NonNullable<ReturnType<typeof db.getConnection>>,
) {
  return {
    id: conn.id,
    provider: conn.provider as ProviderId,
    status: conn.status,
    label: conn.label,
    connectedAt: conn.connectedAt,
    updatedAt: conn.updatedAt,
    meta: conn.meta
      ? {
          method: conn.meta.method,
          warning: conn.meta.warning,
          source: conn.meta.source,
          dashboard: conn.meta.dashboard,
          riskAcknowledged: conn.meta.riskAcknowledged,
        }
      : undefined,
  };
}
