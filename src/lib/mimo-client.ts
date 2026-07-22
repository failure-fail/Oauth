import { MIMO_API } from "./config";
import type { StoredProviderSecret } from "./providers";
import type { ProviderModel, ThinkingLevel, ThinkingPayload } from "./codex-client";

const FALLBACK_MODELS: ProviderModel[] = [
  {
    id: "mimo-v2.5-pro",
    name: "MiMo V2.5 Pro",
    kind: "chat",
    reasoningLevels: ["none", "low", "medium", "high"],
    defaultReasoningLevel: "medium",
    supportsReasoningSummaries: true,
  },
  {
    id: "mimo-v2.5",
    name: "MiMo V2.5",
    kind: "chat",
    reasoningLevels: ["none", "low", "medium", "high"],
    defaultReasoningLevel: "medium",
    supportsReasoningSummaries: true,
  },
];

export function resolveMimoBaseUrl(
  apiKey: string,
  explicitBaseUrl?: string | null,
): string {
  if (explicitBaseUrl?.trim()) {
    return explicitBaseUrl.trim().replace(/\/$/, "");
  }
  if (apiKey.startsWith("tp-")) return MIMO_API.tokenPlanBaseUrl;
  return MIMO_API.paygBaseUrl;
}

export function mimoBaseUrl(secret: StoredProviderSecret): string {
  const key = secret.accessToken || secret.setupToken || "";
  const explicit =
    typeof secret.raw?.baseUrl === "string" ? secret.raw.baseUrl : null;
  return resolveMimoBaseUrl(key, explicit);
}

function apiKey(secret: StoredProviderSecret): string {
  const key = secret.accessToken || secret.setupToken;
  if (!key) throw new Error("Xiaomi MiMo API key missing");
  return key;
}

export function mimoHeaders(secret: StoredProviderSecret): Record<string, string> {
  const key = apiKey(secret);
  return {
    Authorization: `Bearer ${key}`,
    "api-key": key,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

function withThinkingMeta(models: ProviderModel[]): ProviderModel[] {
  return models.map((model) => ({
    ...model,
    reasoningLevels: model.reasoningLevels || [
      "none",
      "low",
      "medium",
      "high",
    ],
    defaultReasoningLevel: model.defaultReasoningLevel || "medium",
    supportsReasoningSummaries: true,
  }));
}

function pickModels(payload: unknown): ProviderModel[] {
  if (!payload || typeof payload !== "object") return [];
  const root = payload as { data?: unknown[] };
  const rows = Array.isArray(root.data) ? root.data : [];
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
      name:
        (typeof row.name === "string" && row.name) ||
        (typeof row.owned_by === "string" && `${row.owned_by}/${id}`) ||
        id,
      kind: "chat",
    });
  }
  return withThinkingMeta(models);
}

export async function listMimoModels(
  secret: StoredProviderSecret,
): Promise<{
  models: ProviderModel[];
  source: "live" | "fallback";
  warning?: string;
}> {
  try {
    const base = mimoBaseUrl(secret);
    const res = await fetch(`${base}/models`, {
      headers: mimoHeaders(secret),
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
        warning: "MiMo returned an empty model list; using known models.",
      };
    }
    return { models, source: "live" };
  } catch (error) {
    return {
      models: FALLBACK_MODELS,
      source: "fallback",
      warning:
        error instanceof Error
          ? `${error.message} — using known MiMo models.`
          : "Live MiMo models failed — using known models.",
    };
  }
}

function thinkingEnabled(level?: ThinkingLevel): boolean {
  return Boolean(level && level !== "none");
}

export async function chatMimo(
  secret: StoredProviderSecret,
  prompt: string,
  model?: string,
  options?: {
    thinkingLevel?: ThinkingLevel;
    includeThinking?: boolean;
  },
) {
  const listed = await listMimoModels(secret);
  const models = listed.models;
  const selected =
    (model && models.some((m) => m.id === model) && model) ||
    models.find((m) => /mimo-v2\.5-pro|mimo-v2\.5|pro/i.test(m.id))?.id ||
    models[0]?.id;
  if (!selected) throw new Error("No MiMo models available");

  const base = mimoBaseUrl(secret);
  const enableThinking = thinkingEnabled(options?.thinkingLevel);
  const body: Record<string, unknown> = {
    model: selected,
    messages: [
      {
        role: "system",
        content:
          "You are MiMo, an AI assistant developed by Xiaomi.",
      },
      { role: "user", content: prompt },
    ],
    max_completion_tokens: 2048,
    temperature: 1,
    stream: false,
    thinking: {
      type: enableThinking ? "enabled" : "disabled",
    },
  };

  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: mimoHeaders(secret),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `MiMo chat failed (${selected}): ${res.status} ${text.slice(0, 400)}`,
    );
  }
  const json = (await res.json()) as {
    choices?: Array<{
      message?: {
        content?: string;
        reasoning_content?: string;
      };
    }>;
    model?: string;
  };
  const message = json.choices?.[0]?.message;
  const reasoning = message?.reasoning_content;
  const thinking: ThinkingPayload | undefined =
    enableThinking && options?.includeThinking !== false && reasoning
      ? {
          level: options?.thinkingLevel || "medium",
          summary: reasoning,
          blocks: [
            {
              type: "thinking",
              content: reasoning,
              summary: reasoning,
            },
          ],
        }
      : undefined;

  return {
    text: message?.content || JSON.stringify(json).slice(0, 1000),
    thinking,
    model: json.model || selected,
    models,
    warning: listed.warning,
    providerLabel: "Xiaomi MiMo",
  };
}

export function mimoCredentialEndpoints(secret: StoredProviderSecret) {
  const base = mimoBaseUrl(secret);
  return {
    base,
    models: `${base}/models`,
    chatCompletions: `${base}/chat/completions`,
    anthropicCompatible: MIMO_API.anthropicPaygBaseUrl,
  };
}
