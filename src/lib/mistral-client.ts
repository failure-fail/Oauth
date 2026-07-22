import { MISTRAL_API } from "./config";
import type { StoredProviderSecret } from "./providers";
import type { ProviderModel } from "./codex-client";

const FALLBACK_MODELS: ProviderModel[] = [
  { id: "mistral-large-latest", name: "Mistral Large", kind: "chat" },
  { id: "mistral-medium-latest", name: "Mistral Medium", kind: "chat" },
  { id: "mistral-small-latest", name: "Mistral Small", kind: "chat" },
  { id: "codestral-latest", name: "Codestral", kind: "chat" },
  { id: "devstral-medium-latest", name: "Devstral Medium", kind: "chat" },
];

function apiKey(secret: StoredProviderSecret): string {
  const key = secret.accessToken || secret.setupToken;
  if (!key) throw new Error("Mistral API key missing");
  return key;
}

export function mistralHeaders(secret: StoredProviderSecret): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey(secret)}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
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
      name: typeof row.name === "string" ? row.name : id,
      kind: "chat",
    });
  }
  return models;
}

export async function listMistralModels(
  secret: StoredProviderSecret,
): Promise<{
  models: ProviderModel[];
  source: "live" | "fallback";
  warning?: string;
}> {
  try {
    const res = await fetch(MISTRAL_API.modelsUrl, {
      headers: mistralHeaders(secret),
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
        warning: "Mistral returned an empty model list; using known models.",
      };
    }
    return { models, source: "live" };
  } catch (error) {
    return {
      models: FALLBACK_MODELS,
      source: "fallback",
      warning:
        error instanceof Error
          ? `${error.message} — using known Mistral models.`
          : "Live Mistral models failed — using known models.",
    };
  }
}

export async function chatMistral(
  secret: StoredProviderSecret,
  prompt: string,
  model?: string,
) {
  const listed = await listMistralModels(secret);
  const models = listed.models;
  const selected =
    (model && models.some((m) => m.id === model) && model) ||
    models.find((m) => /large|codestral|devstral|medium/i.test(m.id))?.id ||
    models[0]?.id;
  if (!selected) throw new Error("No Mistral models available");

  const res = await fetch(MISTRAL_API.chatUrl, {
    method: "POST",
    headers: mistralHeaders(secret),
    body: JSON.stringify({
      model: selected,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 2048,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Mistral chat failed (${selected}): ${res.status} ${text.slice(0, 400)}`,
    );
  }
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    model?: string;
  };
  return {
    text: json.choices?.[0]?.message?.content || JSON.stringify(json).slice(0, 1000),
    model: json.model || selected,
    models,
    warning: listed.warning,
    providerLabel: "Mistral",
  };
}

export function mistralCredentialEndpoints() {
  return {
    base: MISTRAL_API.baseUrl,
    models: MISTRAL_API.modelsUrl,
    chatCompletions: MISTRAL_API.chatUrl,
  };
}
