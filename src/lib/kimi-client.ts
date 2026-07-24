import { randomUUID } from "crypto";
import { KIMI_OAUTH } from "./config";
import { toOpenAiUserContent, type ChatImage } from "./chat-images";
import type { StoredProviderSecret } from "./providers";
import type { ProviderModel } from "./codex-client";
import { resolveKimiRelayBase } from "./relay-config";

const FALLBACK_MODELS: ProviderModel[] = [
  { id: "kimi-for-coding", name: "Kimi K2.7 Code", kind: "chat" },
  {
    id: "kimi-for-coding-highspeed",
    name: "Kimi K2.7 Code HighSpeed",
    kind: "chat",
  },
  { id: "k3", name: "Kimi K3", kind: "chat" },
];

function asciiHeader(value: string) {
  // Match kimi-cli `_ascii_header_value`: strip non-ASCII, keep printable.
  return value.replace(/[^\x20-\x7E]/g, "").trim() || "unknown";
}

/** kimi-cli persists device ids as UUIDv4 hex without dashes. */
export function newKimiDeviceId() {
  return randomUUID().replace(/-/g, "");
}

/**
 * Headers used by MoonshotAI/kimi-cli for OAuth + coding API.
 * UA must be `KimiCLI/{version}`; X-Msh-* must look like a desktop CLI — not a Worker.
 */
export function kimiHeaders(
  token?: string,
  deviceId?: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent": KIMI_OAUTH.userAgent,
    "X-Msh-Platform": KIMI_OAUTH.platform,
    "X-Msh-Version": KIMI_OAUTH.version,
    "X-Msh-Device-Name": asciiHeader(KIMI_OAUTH.deviceName),
    "X-Msh-Device-Model": asciiHeader(KIMI_OAUTH.deviceModel),
    "X-Msh-Os-Version": asciiHeader(KIMI_OAUTH.osVersion),
    "X-Msh-Device-Id": asciiHeader(deviceId || newKimiDeviceId()),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

/** Shorten upstream errors; detect Cloudflare challenge HTML. */
export function formatKimiUpstreamError(status: number, body: string) {
  const snippet = body.slice(0, 280).replace(/\s+/g, " ").trim();
  if (
    /Attention Required|Cloudflare|cf-browser-verification|Just a moment/i.test(
      body,
    )
  ) {
    return `${status} Cloudflare challenged this request (bot protection). Retry after reconnect; if it persists, Kimi may be blocking Worker egress IPs.`;
  }
  if (/only available for Coding Agents/i.test(body)) {
    return `${status} Kimi rejected the client fingerprint (need KimiCLI User-Agent + X-Msh headers).`;
  }
  return `${status} ${snippet}`;
}

function formHeaders(deviceId?: string): Record<string, string> {
  const h = kimiHeaders(undefined, deviceId);
  h["Content-Type"] = "application/x-www-form-urlencoded";
  return h;
}

/** Non-Worker relay for api.kimi.com/coding (Worker egress is CF-challenged). */
export async function kimiRelayBase(): Promise<string | null> {
  return resolveKimiRelayBase();
}

export async function kimiApiBase(
  secret?: StoredProviderSecret,
): Promise<string> {
  // Prefer relay on Workers — stored apiBase is usually api.kimi.com which is blocked.
  const relay = await kimiRelayBase();
  if (relay) return relay;
  const fromRaw =
    typeof secret?.raw?.apiBase === "string" ? secret.raw.apiBase : null;
  return (fromRaw || KIMI_OAUTH.apiBase).replace(/\/$/, "");
}

export async function kimiTransport(): Promise<"relay" | "direct"> {
  return (await kimiRelayBase()) ? "relay" : "direct";
}

export type KimiDeviceAuthorization = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  expiresIn: number;
  interval: number;
  deviceId: string;
};

export async function requestKimiDeviceCode(): Promise<KimiDeviceAuthorization> {
  const deviceId = newKimiDeviceId();
  const res = await fetch(KIMI_OAUTH.deviceCodeUrl, {
    method: "POST",
    headers: formHeaders(deviceId),
    body: new URLSearchParams({ client_id: KIMI_OAUTH.clientId }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `Kimi device authorization failed: ${formatKimiUpstreamError(res.status, text)}`,
    );
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
  if (
    data.error ||
    !data.device_code ||
    !data.user_code ||
    !(data.verification_uri || data.verification_uri_complete)
  ) {
    throw new Error(
      data.error_description ||
        data.error ||
        "Kimi device authorization missing codes",
    );
  }
  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri:
      data.verification_uri ||
      "https://www.kimi.com/code/authorize_device",
    verificationUriComplete: data.verification_uri_complete,
    expiresIn: data.expires_in || 1800,
    interval: Math.max(2, data.interval || 5),
    deviceId,
  };
}

export type KimiDevicePollResult =
  | { status: "pending"; interval: number }
  | { status: "slow_down"; interval: number }
  | {
      status: "complete";
      accessToken: string;
      refreshToken: string;
      expiresIn: number;
      scope?: string;
      tokenType?: string;
    }
  | { status: "failed"; error: string };

export async function pollKimiDeviceCode(input: {
  deviceCode: string;
  deviceId?: string;
  interval?: number;
}): Promise<KimiDevicePollResult> {
  const interval = Math.max(2, input.interval || 5);
  const res = await fetch(KIMI_OAUTH.tokenUrl, {
    method: "POST",
    headers: formHeaders(input.deviceId),
    body: new URLSearchParams({
      client_id: KIMI_OAUTH.clientId,
      device_code: input.deviceCode,
      grant_type: KIMI_OAUTH.grantType,
    }),
  });
  const text = await res.text();
  let data: {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    token_type?: string;
    error?: string;
    error_description?: string;
  } = {};
  try {
    data = text.trim() ? (JSON.parse(text) as typeof data) : {};
  } catch {
    return {
      status: "failed",
      error: `Kimi poll returned non-JSON: ${formatKimiUpstreamError(res.status, text)}`,
    };
  }

  if (data.access_token && data.refresh_token) {
    return {
      status: "complete",
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in || 900,
      scope: data.scope,
      tokenType: data.token_type,
    };
  }

  if (data.error === "authorization_pending") {
    return { status: "pending", interval };
  }
  if (data.error === "slow_down") {
    return { status: "slow_down", interval: interval + 5 };
  }
  if (data.error === "expired_token") {
    return {
      status: "failed",
      error: data.error_description || "Device code expired — start again",
    };
  }
  return {
    status: "failed",
    error:
      data.error_description ||
      data.error ||
      `Kimi poll failed (${res.status})`,
  };
}

export async function refreshKimiTokens(
  refreshToken: string,
  deviceId?: string,
): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}> {
  const res = await fetch(KIMI_OAUTH.tokenUrl, {
    method: "POST",
    headers: formHeaders(deviceId),
    body: new URLSearchParams({
      client_id: KIMI_OAUTH.clientId,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `Kimi token refresh failed: ${formatKimiUpstreamError(res.status, text)}`,
    );
  }
  const data = JSON.parse(text) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!data.access_token) {
    throw new Error(
      data.error_description || data.error || "Kimi refresh missing access_token",
    );
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    expiresAt: Date.now() + (data.expires_in || 900) * 1000,
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

function deviceIdOf(secret: StoredProviderSecret) {
  return typeof secret.raw?.deviceId === "string"
    ? secret.raw.deviceId
    : undefined;
}

export async function listKimiModels(
  secret: StoredProviderSecret,
): Promise<{
  models: ProviderModel[];
  source: "live" | "fallback";
  warning?: string;
  transport?: "relay" | "direct";
}> {
  const token = secret.accessToken;
  if (!token) throw new Error("Kimi access token missing");
  const base = await kimiApiBase(secret);
  const transport = await kimiTransport();
  try {
    const res = await fetch(`${base}/models`, {
      headers: kimiHeaders(token, deviceIdOf(secret)),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(formatKimiUpstreamError(res.status, text));
    }
    const models = pickModels(await res.json());
    if (!models.length) {
      return {
        models: FALLBACK_MODELS,
        source: "fallback",
        transport,
        warning: "Kimi returned an empty model list; using known models.",
      };
    }
    return { models, source: "live", transport };
  } catch (error) {
    const hint =
      transport === "direct"
        ? " Run pnpm relay:providers (Worker egress to api.kimi.com is CF-blocked)."
        : "";
    return {
      models: FALLBACK_MODELS,
      source: "fallback",
      transport,
      warning:
        error instanceof Error
          ? `${error.message} — using known Kimi models.${hint}`
          : `Live Kimi models failed — using known models.${hint}`,
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

export async function chatKimi(
  secret: StoredProviderSecret,
  prompt: string,
  model?: string,
  options?: { images?: ChatImage[] },
) {
  const token = secret.accessToken;
  if (!token) throw new Error("Kimi access token missing");
  const listed = await listKimiModels(secret);
  const models = listed.models;
  const selected =
    (model && models.some((m) => m.id === model) && model) ||
    models.find((m) => /kimi-for-coding|k3/i.test(m.id))?.id ||
    models[0]?.id;
  if (!selected) throw new Error("No Kimi models available");

  const base = await kimiApiBase(secret);
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      ...kimiHeaders(token, deviceIdOf(secret)),
      Accept: "text/event-stream",
    },
    body: JSON.stringify({
      stream: true,
      model: selected,
      messages: [
        {
          role: "user",
          content: toOpenAiUserContent(prompt, options?.images),
        },
      ],
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    const transport = await kimiTransport();
    const hint =
      transport === "direct"
        ? " Run pnpm relay:providers (see scripts/start-provider-relays.mjs)."
        : "";
    throw new Error(
      `Kimi chat failed (${selected}): ${formatKimiUpstreamError(res.status, text)}${hint}`,
    );
  }
  return {
    text: await readSseText(res),
    model: selected,
    models,
    warning: listed.warning,
    transport: await kimiTransport(),
    providerLabel: "Kimi Code",
  };
}

export async function kimiCredentialEndpoints(secret: StoredProviderSecret) {
  const base = await kimiApiBase(secret);
  const relay = await kimiRelayBase();
  return {
    base,
    models: `${base}/models`,
    chatCompletions: `${base}/chat/completions`,
    token: KIMI_OAUTH.tokenUrl,
    deviceAuthorization: KIMI_OAUTH.deviceCodeUrl,
    upstream: KIMI_OAUTH.apiBase,
    transport: relay ? ("relay" as const) : ("direct" as const),
    note: relay
      ? "Using Kimi relay (FAILURE_KIMI_BASE_URL or KV failure-oauth:relay:kimi)."
      : "Direct api.kimi.com/coding calls are CF-challenged from Workers; run pnpm relay:providers.",
  };
}
