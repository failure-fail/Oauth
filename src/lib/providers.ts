import { randomUUID } from "crypto";
import {
  ANTIGRAVITY_OAUTH,
  CLAUDE_OAUTH,
  CODEX_OAUTH,
  COPILOT_OAUTH,
  GROK_OAUTH,
  KIMI_OAUTH,
  MIMO_API,
  randomToken,
  type ProviderId,
} from "./config";
import { encryptSecret, decryptSecret, pkceChallengeFromVerifier } from "./crypto";
import { db, type ProviderConnection } from "./db";
import { antigravityCredentialEndpoints, listAntigravityModels } from "./antigravity-client";
import { listCodexModels } from "./codex-client";
import { resolveCodexRelayBase } from "./relay-config";
import {
  copilotCredentialEndpoints,
  exchangeCopilotSession,
  listCopilotModels,
  refreshCopilotSession,
} from "./copilot-client";
import {
  pollCopilotDeviceCode,
  requestCopilotDeviceCode,
} from "./copilot-auth";
import {
  formatKimiUpstreamError,
  kimiCredentialEndpoints,
  kimiHeaders,
  listKimiModels,
  newKimiDeviceId,
  pollKimiDeviceCode,
  refreshKimiTokens,
  requestKimiDeviceCode,
} from "./kimi-client";
import {
  buildMimoAuthorizeUrl,
  decryptMimoOAuthPayload,
  generateMimoOAuthKeyPair,
  listMimoModels,
  mimoCredentialEndpoints,
  newMimoKeyName,
  resolveMimoBaseUrl,
} from "./mimo-client";

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
  // OpenCode Copilot: may store refresh immediately with empty/expired access.
  if (!secret.accessToken) return true;
  if (secret.expiresAt === 0) return true;
  if (!secret.expiresAt) {
    // JWT with exp: refresh near expiry; opaque tokens refresh on demand via 401
    const payload = decodeJwtPayload(secret.accessToken);
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

  if (
    conn.provider === "kimi" &&
    tokenNeedsRefresh(secret) &&
    secret.refreshToken
  ) {
    const refreshed = await refreshKimiTokens(
      secret.refreshToken,
      secret.raw?.deviceId as string | undefined,
    );
    secret = {
      ...secret,
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken,
      expiresAt: refreshed.expiresAt,
      raw: {
        ...(secret.raw || {}),
        ...(typeof secret.raw?.deviceId === "string"
          ? { deviceId: secret.raw.deviceId }
          : {}),
      },
    };
    conn = await db.upsertConnection({
      userId: conn.userId,
      provider: "kimi",
      status: conn.status,
      label: conn.label,
      encryptedPayload: storeProviderSecret(secret),
      meta: conn.meta,
    });
  }

  if (
    conn.provider === "copilot" &&
    tokenNeedsRefresh(secret) &&
    secret.refreshToken
  ) {
    const refreshed = await refreshCopilotSession(secret);
    secret = refreshed;
    conn = await db.upsertConnection({
      userId: conn.userId,
      provider: "copilot",
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
export async function exposeProviderCredentials(
  provider: ProviderId,
  secret: StoredProviderSecret,
) {
  switch (provider) {
    case "codex": {
      const relay = await resolveCodexRelayBase();
      const base = relay || CODEX_OAUTH.baseUrl;
      let models: Awaited<ReturnType<typeof listCodexModels>>["models"] = [];
      let modelsSource: "live" | "error" | undefined;
      let modelsWarning: string | undefined;
      try {
        const listed = await listCodexModels(secret, "codex");
        models = listed.models;
        modelsSource = listed.source;
        modelsWarning = listed.warning;
      } catch (error) {
        modelsWarning =
          error instanceof Error
            ? error.message
            : "Failed to load Codex models for userinfo";
      }
      return {
        type: secret.type,
        protocol: "codex_backend",
        accessToken: secret.accessToken ?? null,
        refreshToken: secret.refreshToken ?? null,
        idToken: secret.idToken ?? null,
        expiresAt: secret.expiresAt ?? null,
        accountId: secret.accountId ?? null,
        isFedRamp: secret.isFedRamp ?? null,
        models,
        modelsSource: modelsSource ?? null,
        modelsWarning: modelsWarning ?? null,
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
          ? "Codex relay is configured (KV failure-oauth:relay:codex or FAILURE_CODEX_BASE_URL)."
          : "Direct chatgpt.com calls are blocked from Cloudflare Workers; run pnpm relay:providers.",
      };
    }
    case "antigravity": {
      const endpoints = antigravityCredentialEndpoints();
      let models: Awaited<ReturnType<typeof listAntigravityModels>>["models"] =
        [];
      let modelsSource: "live" | "fallback" | "error" | undefined;
      let modelsWarning: string | undefined;
      let projectId =
        secret.projectId ||
        (typeof secret.raw?.projectId === "string"
          ? secret.raw.projectId
          : null);
      try {
        const listed = await listAntigravityModels(secret);
        models = listed.models;
        modelsSource = listed.source;
        modelsWarning = listed.warning;
        projectId = listed.projectId || projectId;
      } catch (error) {
        modelsSource = "error";
        modelsWarning =
          error instanceof Error
            ? error.message
            : "Failed to load Antigravity models for userinfo";
      }
      return {
        type: secret.type,
        protocol: "antigravity_cloudcode",
        accessToken: secret.accessToken ?? null,
        refreshToken: secret.refreshToken ?? null,
        expiresAt: secret.expiresAt ?? null,
        projectId: projectId ?? null,
        email:
          typeof secret.raw?.email === "string" ? secret.raw.email : null,
        models,
        modelsSource: modelsSource ?? null,
        modelsWarning: modelsWarning ?? null,
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
        requestShape: {
          project: "<projectId>",
          model: "<modelId from models[]>",
          userAgent: "antigravity",
          requestType: "agent",
          request: {
            contents: [{ role: "user", parts: [{ text: "..." }] }],
            systemInstruction: { parts: [{ text: "..." }] },
            generationConfig: { maxOutputTokens: 4096 },
          },
        },
        oauth: {
          clientId: ANTIGRAVITY_OAUTH.clientId,
          redirectUri: ANTIGRAVITY_OAUTH.redirectUri,
          scopes: ANTIGRAVITY_OAUTH.scopes,
        },
        docs: ANTIGRAVITY_OAUTH.docsUrl,
        note:
          "Google Antigravity / Cloud Code Assist. `models` is the live account catalog (same as Failure chat). Requests use Gemini-style contents wrapped in { project, model, request }.",
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
    case "kimi": {
      let models: Awaited<ReturnType<typeof listKimiModels>>["models"] = [];
      let modelsSource: "live" | "fallback" | "error" | undefined;
      let modelsWarning: string | undefined;
      try {
        const listed = await listKimiModels(secret);
        models = listed.models;
        modelsSource = listed.source;
        modelsWarning = listed.warning;
      } catch (error) {
        modelsSource = "error";
        modelsWarning =
          error instanceof Error
            ? error.message
            : "Failed to load Kimi models for userinfo";
      }
      const endpoints = await kimiCredentialEndpoints(secret);
      return {
        type: secret.type,
        protocol: "kimi_code",
        accessToken: secret.accessToken ?? secret.setupToken ?? null,
        refreshToken: secret.refreshToken ?? null,
        expiresAt: secret.expiresAt ?? null,
        models,
        modelsSource: modelsSource ?? null,
        modelsWarning: modelsWarning ?? null,
        capabilities: { chat: true, streamingRequired: true },
        endpoints,
        requiredHeaders: {
          Authorization: "Bearer <accessToken>",
          "Content-Type": "application/json",
          "User-Agent": KIMI_OAUTH.userAgent,
          "X-Msh-Platform": KIMI_OAUTH.platform,
          "X-Msh-Version": KIMI_OAUTH.version,
          "X-Msh-Device-Name": KIMI_OAUTH.deviceName,
          "X-Msh-Device-Model": KIMI_OAUTH.deviceModel,
          "X-Msh-Os-Version": KIMI_OAUTH.osVersion,
          "X-Msh-Device-Id": "<stable device id>",
        },
        oauth: {
          clientId: KIMI_OAUTH.clientId,
          tokenUrl: KIMI_OAUTH.tokenUrl,
        },
        docs: KIMI_OAUTH.docsUrl,
        note:
          endpoints.note ||
          "Moonshot Kimi Code device OAuth (same public client as kimi-cli). OpenAI-compatible coding API at api.kimi.com/coding/v1. Requests must send KimiCLI User-Agent + X-Msh-* desktop fingerprint headers.",
      };
    }
    case "copilot": {
      let models: Awaited<ReturnType<typeof listCopilotModels>>["models"] = [];
      let modelsSource: "live" | "fallback" | "error" | undefined;
      let modelsWarning: string | undefined;
      try {
        const listed = await listCopilotModels(secret);
        models = listed.models;
        modelsSource = listed.source;
        modelsWarning = listed.warning;
      } catch (error) {
        modelsSource = "error";
        modelsWarning =
          error instanceof Error
            ? error.message
            : "Failed to load Copilot models for userinfo";
      }
      const endpoints = copilotCredentialEndpoints(secret);
      return {
        type: secret.type,
        protocol: "github_copilot",
        accessToken: secret.accessToken ?? null,
        refreshToken: secret.refreshToken ?? null,
        expiresAt: secret.expiresAt ?? null,
        models,
        modelsSource: modelsSource ?? null,
        modelsWarning: modelsWarning ?? null,
        capabilities: {
          chat: true,
          streamingRequired: true,
        },
        endpoints,
        requiredHeaders: {
          Authorization: "Bearer <accessToken>",
          ...COPILOT_OAUTH.headers,
        },
        oauth: {
          clientId: COPILOT_OAUTH.clientId,
          scope: COPILOT_OAUTH.scope,
          sessionTokenUrl: COPILOT_OAUTH.sessionTokenUrl,
        },
        note:
          "accessToken is the short-lived Copilot session token (tid=…). refreshToken is the GitHub ghu_ token — refresh by GET sessionTokenUrl with Authorization: token <refreshToken> (or Bearer).",
      };
    }
    case "mimo": {
      let models: Awaited<ReturnType<typeof listMimoModels>>["models"] = [];
      let modelsSource: "live" | "fallback" | "error" | undefined;
      let modelsWarning: string | undefined;
      try {
        const listed = await listMimoModels(secret);
        models = listed.models;
        modelsSource = listed.source;
        modelsWarning = listed.warning;
      } catch (error) {
        modelsSource = "error";
        modelsWarning =
          error instanceof Error
            ? error.message
            : "Failed to load MiMo models for userinfo";
      }
      const endpoints = mimoCredentialEndpoints(secret);
      return {
        type: secret.type,
        protocol: "xiaomi_mimo",
        apiKey: secret.accessToken ?? secret.setupToken ?? null,
        accessToken: secret.accessToken ?? secret.setupToken ?? null,
        baseUrl: endpoints.base,
        models,
        modelsSource: modelsSource ?? null,
        modelsWarning: modelsWarning ?? null,
        capabilities: {
          chat: true,
          reasoning: true,
          thinkingLevels: ["none", "low", "medium", "high"],
          defaultThinkingLevel: "medium",
          thinkBlocks: {
            outputItemType: "thinking",
            requestShape: { thinking: { type: "enabled|disabled" } },
            responseShape: { reasoning_content: "..." },
          },
        },
        endpoints,
        requiredHeaders: {
          Authorization: "Bearer <apiKey>",
          "api-key": "<apiKey>",
          "Content-Type": "application/json",
          "X-Mimo-Source": "failure-ai-oauth",
        },
        docs: MIMO_API.docsUrl,
        console: MIMO_API.consoleUrl,
        note:
          "Connected via Xiaomi MiMo platform OAuth (same as MiMo Code). The stored apiKey is platform-managed (often mimo-code-cli-key-…).",
      };
    }
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

export async function startCopilotDeviceOAuth(userId: string) {
  const auth = await requestCopilotDeviceCode();
  const flowId = randomUUID();
  await db.savePendingFlow({
    id: flowId,
    userId,
    provider: "copilot",
    encryptedState: encryptSecret(
      JSON.stringify({
        deviceCode: auth.deviceCode,
        userCode: auth.userCode,
        interval: auth.interval,
      }),
    ),
    expiresAt: Date.now() + auth.expiresIn * 1000,
  });
  return {
    flowId,
    // Client must poll this exact device code (VS Code keeps it in-process).
    deviceCode: auth.deviceCode,
    userCode: auth.userCode,
    verificationUri: auth.verificationUri,
    verificationUriComplete: auth.verificationUriComplete,
    expiresIn: auth.expiresIn,
    interval: auth.interval,
  };
}

export async function pollCopilotDeviceOAuth(input: {
  userId: string;
  flowId: string;
  deviceCode?: string;
}) {
  const existing = await db.getConnection(input.userId, "copilot");
  if (existing?.status === "connected") {
    await db.deletePendingFlow(input.flowId).catch(() => undefined);
    return { status: "connected" as const, connection: existing };
  }

  const flow = await db.getPendingFlow(input.flowId, input.userId);
  let deviceCode = input.deviceCode?.trim() || "";
  let interval = 5;
  if (flow && flow.provider === "copilot") {
    const state = JSON.parse(decryptSecret(flow.encryptedState)) as {
      deviceCode: string;
      interval?: number;
    };
    interval = state.interval ?? 5;
    if (!deviceCode) deviceCode = state.deviceCode;
  } else if (!deviceCode) {
    throw new Error("Copilot flow not found or expired — start OAuth again");
  }

  const polled = await pollCopilotDeviceCode(deviceCode, interval);
  if (polled.status === "pending" || polled.status === "slow_down") {
    return {
      status: polled.status,
      interval: polled.interval,
    };
  }
  if (polled.status !== "complete") {
    if (
      polled.status === "failed" &&
      /incorrect_device_code/i.test(polled.error)
    ) {
      const again = await db.getConnection(input.userId, "copilot");
      if (again?.status === "connected") {
        return { status: "connected" as const, connection: again };
      }
    }
    throw new Error(polled.error);
  }

  // OpenCode stores the GitHub token as refresh immediately, then exchanges
  // for a Copilot session token (access). Do the same; connect even if the
  // session exchange is deferred to first API use.
  const githubToken = polled.githubToken;
  let accessToken = "";
  let expiresAt = 0;
  let apiBase = COPILOT_OAUTH.defaultApiBase;
  let warning: string | undefined;
  try {
    const session = await exchangeCopilotSession(githubToken);
    accessToken = session.token;
    expiresAt = session.expiresAt;
    apiBase = session.apiBase;
  } catch (error) {
    warning =
      error instanceof Error
        ? `GitHub login ok; Copilot session will refresh on first use (${error.message})`
        : "GitHub login ok; Copilot session will refresh on first use";
  }

  const conn = await db.upsertConnection({
    userId: input.userId,
    provider: "copilot",
    status: "connected",
    label: "GitHub Copilot",
    encryptedPayload: storeProviderSecret({
      type: "github_copilot_oauth",
      accessToken: accessToken || undefined,
      refreshToken: githubToken,
      expiresAt,
      raw: { apiBase },
    }),
    meta: {
      method: "device_oauth",
      apiBase,
      ...(warning ? { warning } : {}),
    },
  });
  await db.deletePendingFlow(input.flowId);
  return { status: "connected" as const, connection: conn };
}

export async function startMimoOAuth(userId: string) {
  const { publicKey, privateKeyDerBase64 } = generateMimoOAuthKeyPair();
  const keyName = newMimoKeyName();
  const authorizeUrl = buildMimoAuthorizeUrl({
    publicKey,
    keyName,
    manual: true,
  });
  const flowId = randomUUID();
  await db.savePendingFlow({
    id: flowId,
    userId,
    provider: "mimo",
    encryptedState: encryptSecret(
      JSON.stringify({
        privateKeyDerBase64,
        publicKey,
        keyName,
      }),
    ),
    expiresAt: Date.now() + 10 * 60 * 1000,
  });
  return {
    flowId,
    authorizeUrl,
    keyName,
    instructions: [
      "Open the Xiaomi MiMo authorize URL and sign in with your Xiaomi account.",
      "Choose pay-as-you-go or Token Plan when prompted.",
      "Copy the authorization code shown after login and paste it below.",
      "Your open platform account needs balance or an active Token Plan.",
    ],
  };
}

export async function completeMimoOAuth(input: {
  userId: string;
  flowId: string;
  code: string;
}) {
  const flow = await db.getPendingFlow(input.flowId, input.userId);
  if (!flow || flow.provider !== "mimo") {
    throw new Error("MiMo OAuth flow not found or expired");
  }
  const state = JSON.parse(decryptSecret(flow.encryptedState)) as {
    privateKeyDerBase64: string;
    publicKey: string;
    keyName: string;
  };

  let payload: { sk?: string; uid: string; url?: string };
  try {
    // Accept raw code, or a full callback URL containing ?u= / ?code=
    let code = input.code.trim();
    try {
      const asUrl = new URL(code);
      code =
        asUrl.searchParams.get("u") ||
        asUrl.searchParams.get("code") ||
        code;
    } catch {
      // not a URL
    }
    payload = decryptMimoOAuthPayload(state.privateKeyDerBase64, code);
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? `MiMo OAuth decrypt failed: ${error.message}`
        : "MiMo OAuth decrypt failed",
    );
  }

  if (!payload.sk) {
    throw new Error(
      "MiMo OAuth succeeded but no API key was returned. Check platform balance / Token Plan.",
    );
  }

  const baseUrl = resolveMimoBaseUrl(payload.sk, payload.url || null);
  const conn = await db.upsertConnection({
    userId: input.userId,
    provider: "mimo",
    status: "connected",
    label: payload.uid
      ? `Xiaomi MiMo ${payload.uid}`
      : "Xiaomi MiMo OAuth",
    encryptedPayload: storeProviderSecret({
      type: "xiaomi_mimo_oauth",
      accessToken: payload.sk,
      setupToken: payload.sk,
      raw: {
        baseUrl,
        uid: payload.uid,
        keyName: state.keyName,
      },
    }),
    meta: {
      method: "platform_oauth",
      source: MIMO_API.docsUrl,
      baseUrl,
      uid: payload.uid,
    },
  });
  await db.deletePendingFlow(input.flowId);
  return conn;
}

export async function connectMimoApiKey(
  userId: string,
  apiKey: string,
  baseUrl?: string,
) {
  const key = apiKey.trim();
  if (!key) throw new Error("Xiaomi MiMo API key required");
  if (!key.startsWith("sk-") && !key.startsWith("tp-") && !key.startsWith("mimo-")) {
    throw new Error(
      "Expected a MiMo API key (sk-… pay-as-you-go, tp-… Token Plan, or mimo-code-cli-key…)",
    );
  }
  const resolvedBase = resolveMimoBaseUrl(key, baseUrl);
  const probe = await fetch(`${resolvedBase}/models`, {
    headers: {
      Authorization: `Bearer ${key}`,
      "api-key": key,
      Accept: "application/json",
    },
  });
  if (!probe.ok) {
    const text = await probe.text();
    throw new Error(
      `MiMo key rejected (${probe.status}): ${text.slice(0, 200)}`,
    );
  }

  return await db.upsertConnection({
    userId,
    provider: "mimo",
    status: "connected",
    label: key.startsWith("tp-") ? "Xiaomi MiMo Token Plan" : "Xiaomi MiMo API",
    encryptedPayload: storeProviderSecret({
      type: "xiaomi_mimo_api_key",
      accessToken: key,
      setupToken: key,
      raw: { baseUrl: resolvedBase },
    }),
    meta: {
      method: "api_key",
      source: MIMO_API.docsUrl,
      baseUrl: resolvedBase,
    },
  });
}

export async function startKimiDeviceOAuth(userId: string) {
  const auth = await requestKimiDeviceCode();
  const flowId = randomUUID();
  await db.savePendingFlow({
    id: flowId,
    userId,
    provider: "kimi",
    encryptedState: encryptSecret(
      JSON.stringify({
        deviceCode: auth.deviceCode,
        deviceId: auth.deviceId,
        userCode: auth.userCode,
        interval: auth.interval,
      }),
    ),
    expiresAt: Date.now() + auth.expiresIn * 1000,
  });
  return {
    flowId,
    deviceCode: auth.deviceCode,
    userCode: auth.userCode,
    verificationUri: auth.verificationUri,
    verificationUriComplete: auth.verificationUriComplete,
    expiresIn: auth.expiresIn,
    interval: auth.interval,
  };
}

export async function pollKimiDeviceOAuth(input: {
  userId: string;
  flowId: string;
  deviceCode?: string;
}) {
  const existing = await db.getConnection(input.userId, "kimi");
  if (existing?.status === "connected") {
    await db.deletePendingFlow(input.flowId).catch(() => undefined);
    return { status: "connected" as const, connection: existing };
  }

  const flow = await db.getPendingFlow(input.flowId, input.userId);
  if (!flow || flow.provider !== "kimi") {
    throw new Error("Kimi flow not found or expired — start OAuth again");
  }
  const state = JSON.parse(decryptSecret(flow.encryptedState)) as {
    deviceCode: string;
    deviceId?: string;
    interval?: number;
  };
  const deviceCode = input.deviceCode?.trim() || state.deviceCode;
  const polled = await pollKimiDeviceCode({
    deviceCode,
    deviceId: state.deviceId,
    interval: state.interval,
  });
  if (polled.status === "pending" || polled.status === "slow_down") {
    return { status: polled.status, interval: polled.interval };
  }
  if (polled.status !== "complete") {
    throw new Error(polled.error);
  }

  const conn = await db.upsertConnection({
    userId: input.userId,
    provider: "kimi",
    status: "connected",
    label: "Kimi Code",
    encryptedPayload: storeProviderSecret({
      type: "kimi_code_oauth",
      accessToken: polled.accessToken,
      refreshToken: polled.refreshToken,
      expiresAt: polled.expiresIn
        ? Date.now() + polled.expiresIn * 1000
        : undefined,
      raw: {
        apiBase: KIMI_OAUTH.apiBase,
        ...(state.deviceId ? { deviceId: state.deviceId } : {}),
      },
    }),
    meta: {
      method: "device_oauth",
      apiBase: KIMI_OAUTH.apiBase,
    },
  });
  await db.deletePendingFlow(input.flowId);
  return { status: "connected" as const, connection: conn };
}

export async function connectKimiApiKey(
  userId: string,
  apiKey: string,
  baseUrl?: string,
) {
  const key = apiKey.trim();
  if (!key) throw new Error("Kimi API key required");
  const resolvedBase = (baseUrl?.trim() || KIMI_OAUTH.apiBase).replace(
    /\/$/,
    "",
  );
  const deviceId = newKimiDeviceId();
  const probe = await fetch(`${resolvedBase}/models`, {
    headers: kimiHeaders(key, deviceId),
  });
  if (!probe.ok) {
    const text = await probe.text();
    throw new Error(
      `Kimi key rejected: ${formatKimiUpstreamError(probe.status, text)}`,
    );
  }

  return await db.upsertConnection({
    userId,
    provider: "kimi",
    status: "connected",
    label: "Kimi API key",
    encryptedPayload: storeProviderSecret({
      type: "kimi_api_key",
      accessToken: key,
      setupToken: key,
      raw: { apiBase: resolvedBase, deviceId },
    }),
    meta: {
      method: "api_key",
      source: KIMI_OAUTH.docsUrl,
      apiBase: resolvedBase,
    },
  });
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
