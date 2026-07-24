import { COPILOT_OAUTH } from "./config";
import { toOpenAiUserContent, type ChatImage } from "./chat-images";
import type { StoredProviderSecret } from "./providers";
import type { ProviderModel } from "./codex-client";

const FALLBACK_MODELS: ProviderModel[] = [
  { id: "gpt-4.1", name: "GPT-4.1", kind: "chat" },
  { id: "gpt-4o", name: "GPT-4o", kind: "chat" },
  { id: "claude-sonnet-4", name: "Claude Sonnet 4", kind: "chat" },
  { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", kind: "chat" },
];

/** Headers used by VS Code Copilot Chat / OpenCode for Copilot API calls. */
export function copilotHeaders(
  token: string,
  extra?: Record<string, string>,
): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "Content-Type": "application/json",
    ...COPILOT_OAUTH.headers,
    ...extra,
  };
}

export function resolveCopilotApiBase(sessionToken: string): string {
  const match = sessionToken.match(/(?:^|;)\s*proxy-ep=([^;\s]+)/i);
  const proxyEp = match?.[1]?.trim();
  if (!proxyEp) return COPILOT_OAUTH.defaultApiBase;
  const host = proxyEp.replace(/^https?:\/\//, "").replace(/^proxy\./i, "api.");
  if (!host) return COPILOT_OAUTH.defaultApiBase;
  return `https://${host}`;
}

export function copilotApiBase(secret: StoredProviderSecret): string {
  const fromRaw =
    typeof secret.raw?.apiBase === "string" ? secret.raw.apiBase : null;
  if (fromRaw) return fromRaw.replace(/\/$/, "");
  if (secret.accessToken) return resolveCopilotApiBase(secret.accessToken);
  return COPILOT_OAUTH.defaultApiBase;
}

function parseExpiresAt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1e12 ? value : value * 1000;
  }
  if (typeof value === "string" && value.trim()) {
    const asNum = Number(value);
    if (Number.isFinite(asNum)) return asNum > 1e12 ? asNum : asNum * 1000;
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return null;
}

/**
 * Exchange GitHub OAuth token (ghu_) for a short-lived Copilot session token.
 * Matches OpenCode: Authorization Bearer + VS Code editor headers.
 */
export async function exchangeCopilotSession(
  githubToken: string,
): Promise<{ token: string; expiresAt: number; apiBase: string }> {
  const res = await fetch(COPILOT_OAUTH.sessionTokenUrl, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${githubToken}`,
      ...COPILOT_OAUTH.headers,
    },
  });
  if (!res.ok) {
    // Older docs use `token` — try once for compatibility.
    const retry = await fetch(COPILOT_OAUTH.sessionTokenUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `token ${githubToken}`,
        ...COPILOT_OAUTH.headers,
      },
    });
    if (!retry.ok) {
      const text = await res.text();
      const retryText = await retry.text();
      throw new Error(
        `Copilot session token failed: ${res.status} ${text.slice(0, 160)} | ${retry.status} ${retryText.slice(0, 160)}`,
      );
    }
    return readSessionPayload(await retry.json());
  }
  return readSessionPayload(await res.json());
}

function readSessionPayload(data: {
  token?: string;
  expires_at?: number | string;
  endpoints?: { api?: string };
}): { token: string; expiresAt: number; apiBase: string } {
  if (!data.token) throw new Error("Copilot session response missing token");
  // OpenCode: expires_at is unix seconds → ms, refresh 5 min early.
  const expiresAt =
    (parseExpiresAt(data.expires_at) || Date.now() + 25 * 60 * 1000) -
    5 * 60 * 1000;
  const apiBase =
    (typeof data.endpoints?.api === "string" &&
      data.endpoints.api.replace(/\/$/, "")) ||
    resolveCopilotApiBase(data.token);
  return { token: data.token, expiresAt, apiBase };
}

export async function refreshCopilotSession(
  secret: StoredProviderSecret,
): Promise<StoredProviderSecret> {
  const githubToken = secret.refreshToken;
  if (!githubToken) throw new Error("Copilot GitHub token missing");
  const session = await exchangeCopilotSession(githubToken);
  return {
    ...secret,
    type: secret.type || "github_copilot_oauth",
    accessToken: session.token,
    refreshToken: githubToken,
    expiresAt: session.expiresAt,
    raw: {
      ...(secret.raw || {}),
      apiBase: session.apiBase,
    },
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

    // VS Code Copilot model catalog: prefer picker-enabled chat/agent models.
    if (row.model_picker_enabled === false) continue;
    const caps = row.capabilities as { type?: string } | undefined;
    const capType = caps?.type?.toLowerCase();
    if (
      capType &&
      capType !== "chat" &&
      capType !== "agent" &&
      capType !== "chat_completion"
    ) {
      continue;
    }

    seen.add(id);
    models.push({
      id,
      name:
        typeof row.name === "string"
          ? row.name
          : typeof row.vendor === "string"
            ? `${row.vendor} ${id}`
            : id,
      kind: "chat",
    });
  }
  return models;
}

async function fetchCopilotModelsFromBase(
  token: string,
  base: string,
): Promise<ProviderModel[]> {
  const res = await fetch(`${base.replace(/\/$/, "")}/models`, {
    headers: copilotHeaders(token),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${base} → ${res.status} ${text.slice(0, 200)}`);
  }
  return pickModels(await res.json());
}

export async function listCopilotModels(
  secret: StoredProviderSecret,
): Promise<{
  models: ProviderModel[];
  source: "live" | "fallback";
  warning?: string;
}> {
  try {
    let working = secret;
    if (!working.accessToken && working.refreshToken) {
      working = await refreshCopilotSession(working);
    }
    const token = working.accessToken;
    if (!token) throw new Error("Copilot session token missing");

    const primary = copilotApiBase(working);
    const candidates = Array.from(
      new Set([
        primary,
        COPILOT_OAUTH.defaultApiBase,
        "https://api.individual.githubcopilot.com",
        "https://api.business.githubcopilot.com",
      ]),
    );

    const errors: string[] = [];
    for (const base of candidates) {
      try {
        const models = await fetchCopilotModelsFromBase(token, base);
        if (models.length) {
          return { models, source: "live" };
        }
        errors.push(`${base} → empty catalog`);
      } catch (error) {
        errors.push(
          error instanceof Error ? error.message : `${base} → failed`,
        );
      }
    }

    return {
      models: FALLBACK_MODELS,
      source: "fallback",
      warning:
        errors.length > 0
          ? `${errors.join(" | ")} — using known Copilot models.`
          : "Copilot returned an empty model list; using known models.",
    };
  } catch (error) {
    return {
      models: FALLBACK_MODELS,
      source: "fallback",
      warning:
        error instanceof Error
          ? `${error.message} — using known Copilot models.`
          : "Live Copilot models failed — using known models.",
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

export async function chatCopilot(
  secret: StoredProviderSecret,
  prompt: string,
  model?: string,
  options?: { images?: ChatImage[] },
) {
  const token = secret.accessToken;
  if (!token) throw new Error("Copilot session token missing");
  const listed = await listCopilotModels(secret);
  const models = listed.models;
  const selected =
    (model && models.some((m) => m.id === model) && model) ||
    models.find((m) => /gpt-4\.1|gpt-4o|claude-sonnet|gemini/i.test(m.id))
      ?.id ||
    models[0]?.id;
  if (!selected) throw new Error("No Copilot models available");

  const base = copilotApiBase(secret);
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      ...copilotHeaders(token),
      Accept: "text/event-stream",
      "Openai-Intent": "conversation-edits",
      "X-Initiator": "user",
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
    throw new Error(
      `Copilot chat failed (${selected}): ${res.status} ${text.slice(0, 400)}`,
    );
  }
  return {
    text: await readSseText(res),
    model: selected,
    models,
    warning: listed.warning,
    providerLabel: "GitHub Copilot",
  };
}

export function copilotCredentialEndpoints(secret: StoredProviderSecret) {
  const base = copilotApiBase(secret);
  return {
    base,
    models: `${base}/models`,
    chatCompletions: `${base}/chat/completions`,
    sessionToken: COPILOT_OAUTH.sessionTokenUrl,
  };
}
