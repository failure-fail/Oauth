import { randomBytes, createHash, randomUUID } from "crypto";
import { QWEN_OAUTH } from "./config";
import type { StoredProviderSecret } from "./providers";
import type { ProviderModel } from "./codex-client";

const FALLBACK_MODELS: ProviderModel[] = [
  { id: "coder-model", name: "Qwen Coder", kind: "chat" },
  { id: "qwen3.7-max", name: "Qwen3.7 Max", kind: "chat" },
  { id: "qwen3-coder-plus", name: "Qwen3 Coder Plus", kind: "chat" },
  { id: "qwen-max", name: "Qwen Max", kind: "chat" },
  { id: "qwen-plus", name: "Qwen Plus", kind: "chat" },
];

export function generateQwenPkcePair() {
  const codeVerifier = randomBytes(32).toString("base64url");
  const codeChallenge = createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");
  return { codeVerifier, codeChallenge };
}

function formBody(data: Record<string, string>) {
  return new URLSearchParams(data);
}

export function normalizeQwenApiBase(resourceUrl?: string | null): string {
  const base = (resourceUrl || QWEN_OAUTH.defaultApiBase).trim();
  const withScheme = /^https?:\/\//i.test(base) ? base : `https://${base}`;
  const stripped = withScheme.replace(/\/$/, "");
  return stripped.endsWith("/v1") ? stripped : `${stripped}/v1`;
}

export function qwenApiBase(secret: StoredProviderSecret): string {
  const fromRaw =
    typeof secret.raw?.apiBase === "string" ? secret.raw.apiBase : null;
  if (fromRaw) return normalizeQwenApiBase(fromRaw);
  return QWEN_OAUTH.defaultApiBase;
}

export function qwenHeaders(
  token: string,
  authType: "qwen-oauth" | "api-key" = "qwen-oauth",
): Record<string, string> {
  const userAgent = QWEN_OAUTH.userAgent;
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent": userAgent,
    "X-DashScope-CacheControl": "enable",
    "X-DashScope-UserAgent": userAgent,
    "X-DashScope-AuthType": authType,
  };
}

export type QwenDeviceAuthorization = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  expiresIn: number;
  interval: number;
  codeVerifier: string;
};

export async function requestQwenDeviceCode(): Promise<QwenDeviceAuthorization> {
  const { codeVerifier, codeChallenge } = generateQwenPkcePair();
  const res = await fetch(QWEN_OAUTH.deviceCodeUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "x-request-id": randomUUID(),
    },
    body: formBody({
      client_id: QWEN_OAUTH.clientId,
      scope: QWEN_OAUTH.scope,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Qwen device code failed: ${res.status} ${text.slice(0, 240)}`);
  }
  const data = JSON.parse(text) as {
    device_code?: string;
    user_code?: string;
    verification_uri?: string;
    verification_uri_complete?: string;
    expires_in?: number;
    interval?: number;
    error?: string;
    error_description?: string;
  };
  if (data.error || !data.device_code || !data.user_code || !data.verification_uri) {
    throw new Error(
      data.error_description || data.error || "Qwen device code response missing codes",
    );
  }
  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    verificationUriComplete: data.verification_uri_complete,
    expiresIn: data.expires_in || 900,
    interval: Math.max(2, data.interval || 5),
    codeVerifier,
  };
}

export type QwenDevicePollResult =
  | { status: "pending"; interval: number }
  | { status: "slow_down"; interval: number }
  | {
      status: "complete";
      accessToken: string;
      refreshToken?: string;
      expiresIn?: number;
      resourceUrl?: string;
    }
  | { status: "failed"; error: string };

export async function pollQwenDeviceCode(input: {
  deviceCode: string;
  codeVerifier: string;
  interval?: number;
}): Promise<QwenDevicePollResult> {
  const interval = Math.max(2, input.interval || 5);
  const res = await fetch(QWEN_OAUTH.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "x-request-id": randomUUID(),
    },
    body: formBody({
      grant_type: QWEN_OAUTH.grantType,
      client_id: QWEN_OAUTH.clientId,
      device_code: input.deviceCode,
      code_verifier: input.codeVerifier,
    }),
  });
  const text = await res.text();
  let data: {
    access_token?: string | null;
    refresh_token?: string | null;
    expires_in?: number;
    resource_url?: string;
    error?: string;
    error_description?: string;
  } = {};
  try {
    data = text.trim() ? (JSON.parse(text) as typeof data) : {};
  } catch {
    return {
      status: "failed",
      error: `Qwen poll returned non-JSON (${res.status}): ${text.slice(0, 200)}`,
    };
  }

  if (data.access_token) {
    return {
      status: "complete",
      accessToken: data.access_token,
      refreshToken: data.refresh_token || undefined,
      expiresIn: data.expires_in,
      resourceUrl: data.resource_url,
    };
  }

  if (data.error === "authorization_pending") {
    return { status: "pending", interval };
  }
  if (data.error === "slow_down") {
    return { status: "slow_down", interval: interval + 5 };
  }
  return {
    status: "failed",
    error:
      data.error_description ||
      data.error ||
      `Qwen poll failed (${res.status})`,
  };
}

export async function refreshQwenTokens(
  refreshToken: string,
): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresAt?: number;
  resourceUrl?: string;
}> {
  const res = await fetch(QWEN_OAUTH.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "x-request-id": randomUUID(),
    },
    body: formBody({
      grant_type: "refresh_token",
      client_id: QWEN_OAUTH.clientId,
      refresh_token: refreshToken,
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Qwen token refresh failed: ${res.status} ${text.slice(0, 240)}`);
  }
  const data = JSON.parse(text) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    resource_url?: string;
    error?: string;
    error_description?: string;
  };
  if (!data.access_token) {
    throw new Error(
      data.error_description || data.error || "Qwen refresh missing access_token",
    );
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    expiresAt: data.expires_in
      ? Date.now() + data.expires_in * 1000
      : undefined,
    resourceUrl: data.resource_url,
  };
}

function pickModels(payload: unknown): ProviderModel[] {
  if (!payload || typeof payload !== "object") return [];
  const root = payload as Record<string, unknown>;
  const rows = Array.isArray(root.data)
    ? root.data
    : Array.isArray(root.models)
      ? root.models
      : [];
  const models: ProviderModel[] = [];
  const seen = new Set<string>();
  for (const item of rows) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id : null;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    models.push({
      id,
      name: typeof row.name === "string" ? row.name : id,
      kind: "chat",
    });
  }
  return models;
}

function authTypeFor(secret: StoredProviderSecret): "qwen-oauth" | "api-key" {
  if (secret.type === "qwen_api_key" || secret.setupToken) return "api-key";
  return "qwen-oauth";
}

export async function listQwenModels(
  secret: StoredProviderSecret,
): Promise<{
  models: ProviderModel[];
  source: "live" | "fallback";
  warning?: string;
}> {
  const token = secret.accessToken || secret.setupToken;
  if (!token) throw new Error("Qwen access token missing");
  const base = qwenApiBase(secret);
  try {
    const res = await fetch(`${base}/models`, {
      headers: qwenHeaders(token, authTypeFor(secret)),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${res.status} ${text.slice(0, 200)}`);
    }
    const models = pickModels(await res.json());
    if (!models.length) {
      return {
        models: FALLBACK_MODELS,
        source: "fallback",
        warning: "Qwen returned an empty model list; using known models.",
      };
    }
    return { models, source: "live" };
  } catch (error) {
    return {
      models: FALLBACK_MODELS,
      source: "fallback",
      warning:
        error instanceof Error
          ? `${error.message} — using known Qwen models.`
          : "Live Qwen models failed — using known models.",
    };
  }
}

async function readSseText(res: Response): Promise<string> {
  const raw = await res.text();
  if (!raw.includes("data:")) return raw;
  const chunks: string[] = [];
  for (const line of raw.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    try {
      const json = JSON.parse(data) as {
        choices?: Array<{
          delta?: { content?: string };
          message?: { content?: string };
        }>;
      };
      const delta = json.choices?.[0]?.delta?.content;
      const message = json.choices?.[0]?.message?.content;
      if (delta) chunks.push(delta);
      if (message) chunks.push(message);
    } catch {
      // ignore
    }
  }
  return chunks.join("") || raw.slice(0, 2000);
}

export async function chatQwen(
  secret: StoredProviderSecret,
  prompt: string,
  model?: string,
) {
  const token = secret.accessToken || secret.setupToken;
  if (!token) throw new Error("Qwen access token missing");
  const listed = await listQwenModels(secret);
  const models = listed.models;
  const selected =
    (model && models.some((m) => m.id === model) && model) ||
    models.find((m) => /coder-model|qwen3\.7-max|qwen3-coder|qwen-max/i.test(m.id))
      ?.id ||
    models[0]?.id;
  if (!selected) throw new Error("No Qwen models available");

  const base = qwenApiBase(secret);
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      ...qwenHeaders(token, authTypeFor(secret)),
      Accept: "text/event-stream",
    },
    body: JSON.stringify({
      stream: true,
      model: selected,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Qwen chat failed (${selected}): ${res.status} ${text.slice(0, 400)}`,
    );
  }
  return {
    text: await readSseText(res),
    model: selected,
    models,
    warning: listed.warning,
    providerLabel: "Qwen Code",
  };
}

export function qwenCredentialEndpoints(secret: StoredProviderSecret) {
  const base = qwenApiBase(secret);
  return {
    base,
    models: `${base}/models`,
    chatCompletions: `${base}/chat/completions`,
    token: QWEN_OAUTH.tokenUrl,
    deviceCode: QWEN_OAUTH.deviceCodeUrl,
  };
}
