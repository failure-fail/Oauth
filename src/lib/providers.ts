import { randomUUID } from "crypto";
import {
  ANTIGRAVITY_OAUTH,
  CLAUDE_OAUTH,
  CODEX_OAUTH,
  GROK_OAUTH,
  randomToken,
  type ProviderId,
} from "./config";
import { encryptSecret, decryptSecret, pkceChallengeFromVerifier } from "./crypto";
import { db, type ProviderConnection } from "./db";
import { antigravityCredentialEndpoints } from "./antigravity-client";

export type StoredProviderSecret = {
  type: string;
  accessToken?: string;
  refreshToken?: string;
  idToken?: string;
  expiresAt?: number;
  accountId?: string;
  accountKey?: string;
  projectId?: string;
  setupToken?: string;
  isFedRamp?: boolean;
  raw?: Record<string, unknown>;
};

const TOKEN_REFRESH_SKEW_MS = 60_000;

export function storeProviderSecret(secret: StoredProviderSecret) {
  return encryptSecret(JSON.stringify(secret));
}

export function readProviderSecret(encrypted: string): StoredProviderSecret {
  return JSON.parse(decryptSecret(encrypted)) as StoredProviderSecret;
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
}

export function chatgptAccountIdFromToken(token: string): string | null {
  const payload = decodeJwtPayload(token);
  if (!payload) return null;
  const auth = payload["https://api.openai.com/auth"] as
    | { chatgpt_account_id?: string; chatgpt_account_is_fedramp?: boolean }
    | undefined;
  return auth?.chatgpt_account_id || null;
}

export function chatgptIsFedRampFromToken(token?: string): boolean {
  if (!token) return false;
  const payload = decodeJwtPayload(token);
  if (!payload) return false;
  const auth = payload["https://api.openai.com/auth"] as
    | { chatgpt_account_is_fedramp?: boolean }
    | undefined;
  return auth?.chatgpt_account_is_fedramp === true;
}

function tokenNeedsRefresh(secret: StoredProviderSecret): boolean {
  if (!secret.refreshToken) return false;
  if (!secret.expiresAt) {
    // JWT with exp: refresh near expiry; opaque tokens refresh on demand via 401
    const payload = secret.accessToken
      ? decodeJwtPayload(secret.accessToken)
      : null;
    const exp = typeof payload?.exp === "number" ? payload.exp * 1000 : null;
    if (!exp) return false;
    return Date.now() >= exp - TOKEN_REFRESH_SKEW_MS;
  }
  return Date.now() >= secret.expiresAt - TOKEN_REFRESH_SKEW_MS;
}

async function refreshOpenAiTokens(
  refreshToken: string,
): Promise<StoredProviderSecret> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: CODEX_OAUTH.clientId,
  });
  const res = await fetch(CODEX_OAUTH.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI token refresh failed: ${res.status} ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    id_token?: string;
    expires_in?: number;
  };
  const accountId = chatgptAccountIdFromToken(json.access_token);
  return {
    type: "openai_oauth_refreshed",
    accessToken: json.access_token,
    refreshToken: json.refresh_token || refreshToken,
    idToken: json.id_token,
    expiresAt: json.expires_in ? Date.now() + json.expires_in * 1000 : undefined,
    accountId: accountId || undefined,
    isFedRamp: chatgptIsFedRampFromToken(json.id_token || json.access_token),
    raw: json as unknown as Record<string, unknown>,
  };
}

async function refreshAntigravityTokens(
  refreshToken: string,
): Promise<StoredProviderSecret> {
  const res = await fetch(ANTIGRAVITY_OAUTH.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      Accept: "*/*",
      "User-Agent": "google-api-nodejs-client/9.15.1",
    },
    body: new URLSearchParams({
      client_id: ANTIGRAVITY_OAUTH.clientId,
      client_secret: ANTIGRAVITY_OAUTH.clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Antigravity token refresh failed: ${res.status} ${text.slice(0, 300)}`,
    );
  }
  const json = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };
  return {
    type: "antigravity_oauth",
    accessToken: json.access_token,
    refreshToken: json.refresh_token || refreshToken,
    expiresAt: json.expires_in
      ? Date.now() + json.expires_in * 1000
      : undefined,
    raw: json as unknown as Record<string, unknown>,
  };
}

async function refreshGrokTokens(
  refreshToken: string,
): Promise<StoredProviderSecret> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: GROK_OAUTH.clientId,
  });
  const res = await fetch(GROK_OAUTH.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "User-Agent": `xai-grok-workspace/${GROK_OAUTH.clientVersion}`,
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Grok token refresh failed: ${res.status} ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };
  return {
    type: "grok_build_oauth",
    accessToken: json.access_token,
    refreshToken: json.refresh_token || refreshToken,
    expiresAt: json.expires_in
      ? Date.now() + json.expires_in * 1000
      : undefined,
    raw: json as unknown as Record<string, unknown>,
  };
}

/** Refresh provider tokens if needed and persist back to the connection. */
export async function ensureFreshConnection(
  conn: ProviderConnection,
): Promise<{ connection: ProviderConnection; secret: StoredProviderSecret }> {
  let secret = readProviderSecret(conn.encryptedPayload);

  if (
    conn.provider === "codex" &&
    tokenNeedsRefresh(secret) &&
    secret.refreshToken
  ) {
    const refreshed = await refreshOpenAiTokens(secret.refreshToken);
    secret = {
      ...secret,
      ...refreshed,
      type: secret.type || refreshed.type,
      accountId:
        refreshed.accountId ||
        secret.accountId ||
        (typeof secret.raw?.accountId === "string"
          ? secret.raw.accountId
          : undefined),
      idToken: refreshed.idToken || secret.idToken,
      isFedRamp:
        refreshed.isFedRamp ??
        secret.isFedRamp ??
        chatgptIsFedRampFromToken(refreshed.idToken || refreshed.accessToken),
    };
    conn = await db.upsertConnection({
      userId: conn.userId,
      provider: conn.provider,
      status: conn.status,
      label: conn.label,
      encryptedPayload: storeProviderSecret(secret),
      meta: conn.meta,
    });
  }

  if (
    conn.provider === "antigravity" &&
    tokenNeedsRefresh(secret) &&
    secret.refreshToken
  ) {
    const refreshed = await refreshAntigravityTokens(secret.refreshToken);
    secret = {
      ...secret,
      ...refreshed,
      type: secret.type || refreshed.type,
      projectId:
        secret.projectId ||
        (typeof secret.raw?.projectId === "string"
          ? secret.raw.projectId
          : undefined),
    };
    conn = await db.upsertConnection({
      userId: conn.userId,
      provider: "antigravity",
      status: conn.status,
      label: conn.label,
      encryptedPayload: storeProviderSecret(secret),
      meta: conn.meta,
    });
  }

  if (
    conn.provider === "grok" &&
    tokenNeedsRefresh(secret) &&
    secret.refreshToken
  ) {
    const refreshed = await refreshGrokTokens(secret.refreshToken);
    secret = { ...secret, ...refreshed };
    conn = await db.upsertConnection({
      userId: conn.userId,
      provider: "grok",
      status: conn.status,
      label: conn.label,
      encryptedPayload: storeProviderSecret(secret),
      meta: conn.meta,
    });
  }

  // Normalize OpenAI account id onto the secret for Codex callers
  if (
    conn.provider === "codex" &&
    secret.accessToken &&
    !secret.accountId
  ) {
    secret.accountId =
      chatgptAccountIdFromToken(secret.accessToken) ||
      (typeof secret.raw?.accountId === "string"
        ? secret.raw.accountId
        : undefined);
  }

  return { connection: conn, secret };
}

/** Usable credential package apps receive under the `providers` scope. */
export function exposeProviderCredentials(
  provider: ProviderId,
  secret: StoredProviderSecret,
) {
  switch (provider) {
    case "codex": {
      const relay = process.env.FAILURE_CODEX_BASE_URL?.trim().replace(/\/$/, "");
      const base = relay || CODEX_OAUTH.baseUrl;
      return {
        type: secret.type,
        protocol: "codex_backend",
        accessToken: secret.accessToken ?? null,
        refreshToken: secret.refreshToken ?? null,
        idToken: secret.idToken ?? null,
        expiresAt: secret.expiresAt ?? null,
        accountId: secret.accountId ?? null,
        isFedRamp: secret.isFedRamp ?? null,
        capabilities: {
          chat: true,
          imageGeneration: true,
          imageEditing: true,
          imageModel: "gpt-image-2",
          reasoning: true,
          thinkingLevels: ["none", "minimal", "low", "medium", "high", "xhigh"],
          defaultThinkingLevel: "medium",
          thinkBlocks: {
            include: ["reasoning.encrypted_content"],
            summary: ["auto", "concise", "detailed"],
            outputItemType: "reasoning",
            requestShape: {
              reasoning: { effort: "<thinkingLevel>", summary: "detailed" },
              include: ["reasoning.encrypted_content"],
              store: false,
              stream: true,
            },
            responseShape: {
              type: "reasoning",
              summary: [{ type: "summary_text", text: "..." }],
              encrypted_content: "<opaque>",
            },
          },
        },
        endpoints: {
          models: `${base}/models`,
          responses: `${base}/responses`,
          imageGenerations: `${base}/images/generations`,
          imageEdits: `${base}/images/edits`,
          token: CODEX_OAUTH.tokenUrl,
          openaiApiFallback: "https://api.openai.com/v1",
        },
        requiredHeaders: {
          Authorization: "Bearer <accessToken>",
          "chatgpt-account-id": "<accountId>",
          originator: CODEX_OAUTH.originator,
        },
        oauth: {
          clientId: CODEX_OAUTH.clientId,
          scope: CODEX_OAUTH.scope,
          originator: CODEX_OAUTH.originator,
        },
        note: relay
          ? "FAILURE_CODEX_BASE_URL relay is configured for Cloudflare Worker egress."
          : "Direct chatgpt.com calls are blocked from Cloudflare Workers; apps should call from non-Worker hosts or a relay.",
      };
    }
    case "antigravity": {
      const endpoints = antigravityCredentialEndpoints();
      return {
        type: secret.type,
        protocol: "antigravity_cloudcode",
        accessToken: secret.accessToken ?? null,
        refreshToken: secret.refreshToken ?? null,
        expiresAt: secret.expiresAt ?? null,
        projectId: secret.projectId ?? null,
        email:
          typeof secret.raw?.email === "string" ? secret.raw.email : null,
        capabilities: {
          chat: true,
          reasoning: true,
          thinkingLevels: ["none", "low", "medium", "high"],
          defaultThinkingLevel: "medium",
          thinkBlocks: {
            outputItemType: "thinking",
            requestShape: {
              generationConfig: {
                thinkingConfig: {
                  thinkingBudget: "<mappedFromThinkingLevel>",
                  includeThoughts: true,
                },
              },
            },
            responseShape: {
              parts: [
                { thought: true, text: "...", thoughtSignature: "<opaque>" },
                { text: "..." },
              ],
            },
          },
        },
        endpoints,
        requiredHeaders: {
          Authorization: "Bearer <accessToken>",
          "Content-Type": "application/json",
          "User-Agent": `antigravity/${ANTIGRAVITY_OAUTH.version} darwin/arm64`,
          "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
          "Client-Metadata":
            '{"ideType":"ANTIGRAVITY","platform":"MACOS","pluginType":"GEMINI"}',
        },
        oauth: {
          clientId: ANTIGRAVITY_OAUTH.clientId,
          redirectUri: ANTIGRAVITY_OAUTH.redirectUri,
          scopes: ANTIGRAVITY_OAUTH.scopes,
        },
        docs: ANTIGRAVITY_OAUTH.docsUrl,
        note:
          "Google Antigravity / Cloud Code Assist. Requests use Gemini-style contents wrapped in { project, model, request }. See docs/INTEGRATION.md.",
      };
    }
    case "claude":
      return {
        type: secret.type,
        protocol: "anthropic_oauth",
        setupToken: secret.setupToken ?? secret.accessToken ?? null,
        accessToken: secret.setupToken ?? secret.accessToken ?? null,
        capabilities: {
          chat: true,
          reasoning: true,
          thinkingLevels: ["none", "low", "medium", "high"],
          defaultThinkingLevel: "medium",
          thinkBlocks: {
            outputItemType: "thinking",
            requestShape: {
              thinking: {
                type: "enabled",
                budget_tokens: "<mappedFromThinkingLevel>",
                display: "summarized",
              },
              max_tokens: "<mustExceedBudget>",
            },
            responseShape: {
              type: "thinking",
              thinking: "<summary or thinking text>",
              signature: "<opaque>",
            },
          },
        },
        endpoints: {
          models: CLAUDE_OAUTH.modelsUrl,
          messages: CLAUDE_OAUTH.messagesUrl,
        },
        requiredHeaders: {
          Authorization: "Bearer <setupToken>",
          "anthropic-version": CLAUDE_OAUTH.version,
          "anthropic-beta": CLAUDE_OAUTH.beta,
          "anthropic-dangerous-direct-browser-access": "true",
          "User-Agent": CLAUDE_OAUTH.userAgent,
          "x-app": "cli",
        },
        risk: "Using Claude Code OAuth outside Claude Code can risk account deletion.",
      };
    case "grok":
      return {
        type: secret.type,
        protocol: "grok_cli_proxy",
        accessToken: secret.accessToken ?? null,
        refreshToken: secret.refreshToken ?? null,
        expiresAt: secret.expiresAt ?? null,
        endpoints: {
          models: GROK_OAUTH.modelsUrl,
          responses: GROK_OAUTH.responsesUrl,
          token: GROK_OAUTH.tokenUrl,
          proxyBase: GROK_OAUTH.proxyBaseUrl,
        },
        requiredHeaders: {
          Authorization: "Bearer <accessToken>",
          "X-XAI-Token-Auth": GROK_OAUTH.tokenAuth,
          "x-authenticateresponse": "authenticate-response",
          "x-grok-client-version": GROK_OAUTH.clientVersion,
          "x-grok-client-mode": "headless",
          "User-Agent": `xai-grok-workspace/${GROK_OAUTH.clientVersion}`,
        },
        oauth: {
          clientId: GROK_OAUTH.clientId,
          scope: GROK_OAUTH.scope,
        },
      };
    default:
      return {
        type: secret.type,
        accessToken: secret.accessToken ?? null,
        refreshToken: secret.refreshToken ?? null,
        expiresAt: secret.expiresAt ?? null,
      };
  }
}

export async function startCodexDesktopOAuth(userId: string) {
  const verifier = randomToken(48);
  const challenge = pkceChallengeFromVerifier(verifier);
  const state = randomToken(24);
  const bridgeToken = randomToken(24);
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
    originator: CODEX_OAUTH.originator,
  });
  const authorizeUrl = `${CODEX_OAUTH.authorizeUrl}?${params.toString()}`;
  const flowId = randomUUID();
  await db.savePendingFlow({
    id: flowId,
    userId,
    provider: "codex",
    bridgeToken,
    encryptedState: encryptSecret(
      JSON.stringify({ verifier, state, authorizeUrl }),
    ),
    expiresAt: Date.now() + 1000 * 60 * 15,
  });
  const apiBase = (
    process.env.FAILURE_OAUTH_BASE_URL || "http://localhost:3000"
  ).replace(/\/$/, "");
  const bridgeCommand = [
    `curl -fsSL "${apiBase}/sdk/codex-desktop-login.mjs" -o /tmp/failure-codex-desktop.mjs`,
    `node /tmp/failure-codex-desktop.mjs --flow-id=${flowId} --bridge-token=${bridgeToken} --api-base=${apiBase} --authorize-url=${JSON.stringify(authorizeUrl)}`,
  ].join(" && ");
  return {
    flowId,
    bridgeToken,
    authorizeUrl,
    redirectUri: CODEX_OAUTH.redirectUri,
    port: CODEX_OAUTH.port,
    method: "desktop_oauth" as const,
    bridgeCommand,
    instructions: [
      "Codex uses official desktop OAuth (same as Codex CLI/Desktop): PKCE + http://localhost:1455/auth/callback.",
      "Run the desktop bridge command in a terminal on this machine (Node 20+).",
      "The bridge opens your browser, listens on port 1455, and finishes the connection automatically.",
      "Fallback: paste the full localhost:1455 callback URL below if the bridge cannot bind the port.",
    ],
  };
}

export async function completeCodexDesktopOAuth(input: {
  userId?: string;
  flowId: string;
  callbackUrlOrCode: string;
  bridgeToken?: string;
}) {
  const flow = input.bridgeToken
    ? await db.getPendingFlowByBridgeToken(input.flowId, input.bridgeToken)
    : input.userId
      ? await db.getPendingFlow(input.flowId, input.userId)
      : null;
  if (!flow || flow.provider !== "codex") {
    throw new Error("Codex desktop OAuth flow not found or expired");
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
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
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
    id_token?: string;
  };
  const accountId = chatgptAccountIdFromToken(json.access_token);
  if (!accountId) {
    throw new Error(
      "Codex token missing chatgpt_account_id — reconnect and ensure ChatGPT org access is granted",
    );
  }
  const conn = await db.upsertConnection({
    userId: flow.userId,
    provider: "codex",
    status: "connected",
    label: "Codex desktop OAuth",
    encryptedPayload: storeProviderSecret({
      type: "codex_desktop_oauth",
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresAt: json.expires_in
        ? Date.now() + json.expires_in * 1000
        : undefined,
      accountId,
      raw: json as unknown as Record<string, unknown>,
    }),
    meta: {
      method: "desktop_oauth",
      redirectUri: CODEX_OAUTH.redirectUri,
      originator: CODEX_OAUTH.originator,
    },
  });
  await db.deletePendingFlow(input.flowId);
  return conn;
}

export async function startAntigravityOAuth(userId: string) {
  const verifier = randomToken(48);
  const challenge = pkceChallengeFromVerifier(verifier);
  const state = randomToken(24);
  const params = new URLSearchParams({
    client_id: ANTIGRAVITY_OAUTH.clientId,
    response_type: "code",
    redirect_uri: ANTIGRAVITY_OAUTH.redirectUri,
    scope: ANTIGRAVITY_OAUTH.scopes.join(" "),
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    access_type: "offline",
    prompt: "consent",
  });
  const authorizeUrl = `${ANTIGRAVITY_OAUTH.authorizeUrl}?${params.toString()}`;
  const flowId = randomUUID();
  await db.savePendingFlow({
    id: flowId,
    userId,
    provider: "antigravity",
    encryptedState: encryptSecret(JSON.stringify({ verifier, state })),
    expiresAt: Date.now() + 15 * 60 * 1000,
  });
  return {
    flowId,
    authorizeUrl,
    redirectUri: ANTIGRAVITY_OAUTH.redirectUri,
    port: ANTIGRAVITY_OAUTH.port,
    instructions: [
      "Antigravity uses Google OAuth PKCE (same client as Antigravity IDE / opencode-antigravity-auth).",
      `Open the authorize URL, sign in with Google, then paste the full ${ANTIGRAVITY_OAUTH.redirectUri} callback URL below.`,
      "Failure exchanges the code, discovers your Cloud Code project id, and stores refreshed tokens.",
    ],
  };
}

async function fetchAntigravityProjectId(accessToken: string): Promise<string> {
  const bases = [
    ANTIGRAVITY_OAUTH.endpoints.prod,
    ANTIGRAVITY_OAUTH.endpoints.daily,
    ANTIGRAVITY_OAUTH.endpoints.autopush,
  ];
  for (const base of bases) {
    try {
      const res = await fetch(`${base}/v1internal:loadCodeAssist`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "User-Agent": "google-api-nodejs-client/9.15.1",
          "Client-Metadata": JSON.stringify({
            ideType: "ANTIGRAVITY",
            platform: "MACOS",
            pluginType: "GEMINI",
          }),
        },
        body: JSON.stringify({
          metadata: {
            ideType: "ANTIGRAVITY",
            platform: "MACOS",
            pluginType: "GEMINI",
          },
        }),
      });
      if (!res.ok) continue;
      const data = (await res.json()) as {
        cloudaicompanionProject?: string | { id?: string };
      };
      if (typeof data.cloudaicompanionProject === "string") {
        return data.cloudaicompanionProject;
      }
      if (
        data.cloudaicompanionProject &&
        typeof data.cloudaicompanionProject.id === "string"
      ) {
        return data.cloudaicompanionProject.id;
      }
    } catch {
      // try next
    }
  }
  return ANTIGRAVITY_OAUTH.defaultProjectId;
}

export async function completeAntigravityOAuth(input: {
  userId: string;
  flowId: string;
  callbackUrlOrCode: string;
}) {
  const flow = await db.getPendingFlow(input.flowId, input.userId);
  if (!flow || flow.provider !== "antigravity") {
    throw new Error("Antigravity OAuth flow not found or expired");
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
    }
  } catch {
    // raw code
  }
  if (!code) throw new Error("Missing authorization code");
  if (returnedState && returnedState !== statePayload.state) {
    throw new Error("State mismatch");
  }

  const res = await fetch(ANTIGRAVITY_OAUTH.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      Accept: "*/*",
      "User-Agent": "google-api-nodejs-client/9.15.1",
    },
    body: new URLSearchParams({
      client_id: ANTIGRAVITY_OAUTH.clientId,
      client_secret: ANTIGRAVITY_OAUTH.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: ANTIGRAVITY_OAUTH.redirectUri,
      code_verifier: statePayload.verifier,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Antigravity token exchange failed: ${res.status} ${text}`);
  }
  const json = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!json.refresh_token) {
    throw new Error("Missing Antigravity refresh token — retry with prompt=consent");
  }

  let email: string | undefined;
  try {
    const userRes = await fetch(ANTIGRAVITY_OAUTH.userInfoUrl, {
      headers: { Authorization: `Bearer ${json.access_token}` },
    });
    if (userRes.ok) {
      const info = (await userRes.json()) as { email?: string };
      email = info.email;
    }
  } catch {
    // optional
  }

  const projectId = await fetchAntigravityProjectId(json.access_token);
  const conn = await db.upsertConnection({
    userId: input.userId,
    provider: "antigravity",
    status: "connected",
    label: email ? `Antigravity ${email}` : `Antigravity ${projectId.slice(0, 12)}`,
    encryptedPayload: storeProviderSecret({
      type: "antigravity_oauth",
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresAt: json.expires_in
        ? Date.now() + json.expires_in * 1000
        : undefined,
      projectId,
      raw: { ...json, email, projectId } as unknown as Record<string, unknown>,
    }),
    meta: {
      method: "google_oauth",
      source: ANTIGRAVITY_OAUTH.docsUrl,
      projectId,
      email,
    },
  });
  await db.deletePendingFlow(input.flowId);
  return conn;
}

export async function connectClaudeSetupToken(userId: string, setupToken: string) {
  const token = setupToken.trim();
  if (!token) throw new Error("Setup token required");
  if (!token.startsWith("sk-ant-")) {
    throw new Error(
      "Expected a Claude Code setup token (sk-ant-oat01-…) from `claude setup-token`",
    );
  }
  return await db.upsertConnection({
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
      "User-Agent": `xai-grok-workspace/${GROK_OAUTH.clientVersion}`,
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
  await db.savePendingFlow({
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
  const flow = await db.getPendingFlow(input.flowId, input.userId);
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
      "User-Agent": `xai-grok-workspace/${GROK_OAUTH.clientVersion}`,
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
  const conn = await db.upsertConnection({
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
    meta: { method: "device_oauth", proxy: GROK_OAUTH.proxyBaseUrl },
  });
  await db.deletePendingFlow(input.flowId);
  return { status: "connected" as const, connection: conn };
}

export function connectionPublicView(conn: ProviderConnection) {
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
