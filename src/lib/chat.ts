import type { ProviderId } from "./config";
import { readProviderSecret, type StoredProviderSecret } from "./providers";

export type ProviderModel = {
  id: string;
  name?: string;
};

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

function chatgptAccountId(token: string): string | null {
  const payload = decodeJwtPayload(token);
  if (!payload) return null;
  const auth = payload["https://api.openai.com/auth"] as
    | { chatgpt_account_id?: string }
    | undefined;
  return auth?.chatgpt_account_id || null;
}

function codexHeaders(token: string): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "OpenAI-Beta": "responses=experimental",
    originator: "codex_cli_rs",
  };
  const accountId = chatgptAccountId(token);
  if (accountId) headers["ChatGPT-Account-Id"] = accountId;
  return headers;
}

function pickModelIds(payload: unknown): ProviderModel[] {
  if (!payload || typeof payload !== "object") return [];
  const root = payload as Record<string, unknown>;

  const buckets: unknown[] = [];
  if (Array.isArray(root.data)) buckets.push(...root.data);
  if (Array.isArray(root.models)) buckets.push(...root.models);
  if (Array.isArray(payload)) buckets.push(...payload);

  const models: ProviderModel[] = [];
  for (const item of buckets) {
    if (typeof item === "string") {
      models.push({ id: item, name: item });
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const id =
      (typeof row.id === "string" && row.id) ||
      (typeof row.slug === "string" && row.slug) ||
      (typeof row.model === "string" && row.model) ||
      null;
    if (!id) continue;
    const name =
      (typeof row.display_name === "string" && row.display_name) ||
      (typeof row.name === "string" && row.name) ||
      id;
    models.push({ id, name });
  }
  return models;
}

function preferModel(models: ProviderModel[], hints: string[]): string {
  if (!models.length) {
    throw new Error("Provider returned no models");
  }
  for (const hint of hints) {
    const exact = models.find((m) => m.id === hint);
    if (exact) return exact.id;
  }
  for (const hint of hints) {
    const partial = models.find((m) => m.id.includes(hint));
    if (partial) return partial.id;
  }
  return models[0].id;
}

async function listCodexModels(secret: StoredProviderSecret): Promise<ProviderModel[]> {
  const token = secret.accessToken;
  if (!token) throw new Error("Access token missing");
  const res = await fetch(
    "https://chatgpt.com/backend-api/codex/models?client_version=1.0.0",
    { headers: codexHeaders(token) },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to fetch Codex models: ${res.status} ${text.slice(0, 300)}`);
  }
  return pickModelIds(await res.json());
}

async function listClaudeModels(secret: StoredProviderSecret): Promise<ProviderModel[]> {
  const token = secret.setupToken || secret.accessToken;
  if (!token) throw new Error("Claude token missing");
  const res = await fetch("https://api.anthropic.com/v1/models", {
    headers: {
      Authorization: `Bearer ${token}`,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "oauth-2025-04-20",
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to fetch Claude models: ${res.status} ${text.slice(0, 300)}`);
  }
  return pickModelIds(await res.json());
}

async function listGrokModels(secret: StoredProviderSecret): Promise<ProviderModel[]> {
  const token = secret.accessToken;
  if (!token) throw new Error("Grok access token missing");
  const res = await fetch("https://api.x.ai/v1/models", {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to fetch Grok models: ${res.status} ${text.slice(0, 300)}`);
  }
  return pickModelIds(await res.json());
}

export async function listProviderModels(input: {
  provider: ProviderId;
  encryptedPayload: string;
}): Promise<ProviderModel[]> {
  const secret = readProviderSecret(input.encryptedPayload);
  switch (input.provider) {
    case "codex":
    case "chatgpt":
      return listCodexModels(secret);
    case "claude":
      return listClaudeModels(secret);
    case "grok":
      return listGrokModels(secret);
    default:
      throw new Error("Unsupported provider");
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
      const json = JSON.parse(data) as Record<string, unknown>;
      if (typeof json.text === "string") chunks.push(json.text);
      if (json.type === "response.output_text.delta" && typeof json.delta === "string") {
        chunks.push(json.delta);
      }
      if (json.type === "response.completed") {
        const response = json.response as
          | { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> }
          | undefined;
        if (response?.output_text) chunks.push(response.output_text);
        const nested = response?.output
          ?.flatMap((o) => o.content || [])
          .map((c) => c.text)
          .filter(Boolean) as string[] | undefined;
        if (nested?.length) chunks.push(nested.join(""));
      }
      const choices = json.choices as
        | Array<{ delta?: { content?: string }; message?: { content?: string } }>
        | undefined;
      if (choices?.[0]?.delta?.content) chunks.push(choices[0].delta.content);
      if (choices?.[0]?.message?.content) chunks.push(choices[0].message.content);
    } catch {
      // ignore
    }
  }
  return chunks.join("") || raw.slice(0, 2000);
}

async function chatCodexLike(
  secret: StoredProviderSecret,
  prompt: string,
  label: string,
  model?: string,
) {
  const token = secret.accessToken;
  if (!token) throw new Error(`${label} access token missing`);
  const models = await listCodexModels(secret);
  const selected =
    model && models.some((m) => m.id === model)
      ? model
      : preferModel(models, [
          "gpt-5.6-sol",
          "gpt-5.5",
          "gpt-5.4",
          "gpt-5.3-codex",
          "gpt-5.2-codex",
          "codex",
          "gpt-5",
        ]);

  const headers = {
    ...codexHeaders(token),
    "Content-Type": "application/json",
    Accept: "text/event-stream",
  };

  const res = await fetch("https://chatgpt.com/backend-api/codex/responses", {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: selected,
      instructions: "You are a helpful assistant used to test Failure AI OAuth.",
      input: prompt,
      store: false,
      stream: true,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `${label} chat failed (${selected}): ${res.status} ${text.slice(0, 400)}`,
    );
  }
  return {
    text: await readSseText(res),
    model: selected,
    models,
    providerLabel: label,
  };
}

async function chatClaude(
  secret: StoredProviderSecret,
  prompt: string,
  model?: string,
) {
  const token = secret.setupToken || secret.accessToken;
  if (!token) throw new Error("Claude token missing");
  const models = await listClaudeModels(secret);
  const selected =
    model && models.some((m) => m.id === model)
      ? model
      : preferModel(models, ["claude-sonnet", "claude-opus", "claude-haiku", "claude"]);

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "oauth-2025-04-20",
    },
    body: JSON.stringify({
      model: selected,
      max_tokens: 512,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Claude chat failed (${selected}): ${res.status} ${text.slice(0, 400)}`,
    );
  }
  const json = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
    model?: string;
  };
  const text = (json.content || [])
    .filter((c) => c.type === "text" && c.text)
    .map((c) => c.text)
    .join("\n");
  return {
    text: text || JSON.stringify(json).slice(0, 1000),
    model: json.model || selected,
    models,
    providerLabel: "Claude Code",
  };
}

async function chatGrok(
  secret: StoredProviderSecret,
  prompt: string,
  model?: string,
) {
  const token = secret.accessToken;
  if (!token) throw new Error("Grok access token missing");
  const models = await listGrokModels(secret);
  const selected =
    model && models.some((m) => m.id === model)
      ? model
      : preferModel(models, [
          "grok-build",
          "grok-4.20",
          "grok-4.3",
          "grok-4",
          "grok-3",
          "grok",
        ]);

  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: selected,
      messages: [
        {
          role: "system",
          content: "You are a helpful assistant used to test Failure AI OAuth.",
        },
        { role: "user", content: prompt },
      ],
      max_tokens: 512,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Grok chat failed (${selected}): ${res.status} ${text.slice(0, 400)}`,
    );
  }
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    model?: string;
  };
  return {
    text:
      json.choices?.[0]?.message?.content ||
      JSON.stringify(json).slice(0, 1000),
    model: json.model || selected,
    models,
    providerLabel: "Grok Build",
  };
}

export async function runProviderChat(input: {
  provider: ProviderId;
  encryptedPayload: string;
  prompt: string;
  model?: string;
}) {
  const secret = readProviderSecret(input.encryptedPayload);
  switch (input.provider) {
    case "codex":
      return chatCodexLike(secret, input.prompt, "Codex", input.model);
    case "chatgpt":
      return chatCodexLike(secret, input.prompt, "ChatGPT", input.model);
    case "claude":
      return chatClaude(secret, input.prompt, input.model);
    case "grok":
      return chatGrok(secret, input.prompt, input.model);
    default:
      throw new Error("Unsupported provider");
  }
}
