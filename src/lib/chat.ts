import {
  CLAUDE_OAUTH,
  GROK_OAUTH,
  type ProviderId,
} from "./config";
import {
  chatCodex,
  listCodexModels,
  type ProviderModel,
  type ThinkBlock,
  type ThinkingLevel,
  type ThinkingPayload,
} from "./codex-client";
import {
  ensureFreshConnection,
  type StoredProviderSecret,
} from "./providers";
import type { ProviderConnection } from "./db";

export type { ProviderModel };

function claudeHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "anthropic-version": CLAUDE_OAUTH.version,
    "anthropic-beta": CLAUDE_OAUTH.beta,
    "anthropic-dangerous-direct-browser-access": "true",
    "User-Agent": CLAUDE_OAUTH.userAgent,
    "x-app": "cli",
  };
}

function grokHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "X-XAI-Token-Auth": GROK_OAUTH.tokenAuth,
    "x-authenticateresponse": "authenticate-response",
    "x-grok-client-version": GROK_OAUTH.clientVersion,
    "x-grok-client-mode": "headless",
    "x-grok-client-identifier": "failure-ai-oauth",
    "User-Agent": `xai-grok-workspace/${GROK_OAUTH.clientVersion}`,
  };
}

function pickModelIds(payload: unknown): ProviderModel[] {
  if (!payload || typeof payload !== "object") return [];
  const root = payload as Record<string, unknown>;
  const buckets: unknown[] = [];
  if (Array.isArray(root.data)) buckets.push(...root.data);
  if (Array.isArray(root.models)) buckets.push(...root.models);
  if (Array.isArray(root.items)) buckets.push(...root.items);
  if (Array.isArray(payload)) buckets.push(...payload);
  for (const key of ["groups", "categories", "available_models"]) {
    const group = root[key];
    if (Array.isArray(group)) {
      for (const entry of group) {
        if (!entry || typeof entry !== "object") continue;
        const row = entry as Record<string, unknown>;
        if (Array.isArray(row.models)) buckets.push(...row.models);
        if (Array.isArray(row.data)) buckets.push(...row.data);
        if (typeof row.id === "string" || typeof row.slug === "string") {
          buckets.push(entry);
        }
      }
    }
  }
  const seen = new Set<string>();
  const models: ProviderModel[] = [];
  for (const item of buckets) {
    if (typeof item === "string") {
      if (seen.has(item)) continue;
      seen.add(item);
      models.push({ id: item, name: item, kind: "chat" });
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const id =
      (typeof row.id === "string" && row.id) ||
      (typeof row.slug === "string" && row.slug) ||
      (typeof row.model === "string" && row.model) ||
      (typeof row.model_id === "string" && row.model_id) ||
      null;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const name =
      (typeof row.display_name === "string" && row.display_name) ||
      (typeof row.name === "string" && row.name) ||
      (typeof row.title === "string" && row.title) ||
      id;
    models.push({ id, name, kind: "chat" });
  }
  return models;
}

function preferModel(models: ProviderModel[], hints: string[]): string {
  if (!models.length) throw new Error("Provider returned no models");
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

const CLAUDE_THINKING_LEVELS: ThinkingLevel[] = [
  "none",
  "low",
  "medium",
  "high",
];

function withClaudeThinkingMeta(models: ProviderModel[]): ProviderModel[] {
  return models.map((model) => ({
    ...model,
    reasoningLevels: model.reasoningLevels || CLAUDE_THINKING_LEVELS,
    defaultReasoningLevel: model.defaultReasoningLevel || "medium",
    supportsReasoningSummaries: true,
  }));
}

function claudeThinkingBudget(level?: ThinkingLevel): number | null {
  switch (level) {
    case undefined:
    case "medium":
      return 4096;
    case "low":
    case "minimal":
      return 1024;
    case "high":
    case "xhigh":
    case "max":
      return 10000;
    case "none":
      return null;
    default:
      return 4096;
  }
}

async function listClaudeModels(secret: StoredProviderSecret): Promise<ProviderModel[]> {
  const token = secret.setupToken || secret.accessToken;
  if (!token) throw new Error("Claude token missing");
  const res = await fetch(CLAUDE_OAUTH.modelsUrl, {
    headers: claudeHeaders(token),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to fetch Claude models: ${res.status} ${text.slice(0, 300)}`);
  }
  return withClaudeThinkingMeta(pickModelIds(await res.json()));
}

async function listGrokModels(secret: StoredProviderSecret): Promise<ProviderModel[]> {
  const token = secret.accessToken;
  if (!token) throw new Error("Grok access token missing");
  const res = await fetch(GROK_OAUTH.modelsUrl, {
    headers: grokHeaders(token),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to fetch Grok models: ${res.status} ${text.slice(0, 300)}`);
  }
  return pickModelIds(await res.json());
}

export async function listProviderModels(input: {
  provider: ProviderId;
  connection: ProviderConnection;
}): Promise<{
  models: ProviderModel[];
  warning?: string;
  transport?: string;
  source?: string;
}> {
  const { secret } = await ensureFreshConnection(input.connection);
  switch (input.provider) {
    case "codex":
    case "chatgpt": {
      const result = await listCodexModels(
        secret,
        input.provider === "chatgpt" ? "chatgpt" : "codex",
      );
      return {
        models: result.models,
        warning: result.warning,
        transport: result.transport,
        source: result.source,
      };
    }
    case "claude":
      return { models: await listClaudeModels(secret) };
    case "grok":
      return { models: await listGrokModels(secret) };
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

async function chatClaude(
  secret: StoredProviderSecret,
  prompt: string,
  model?: string,
  options?: {
    thinkingLevel?: ThinkingLevel;
    includeThinking?: boolean;
  },
) {
  const token = secret.setupToken || secret.accessToken;
  if (!token) throw new Error("Claude token missing");
  const models = await listClaudeModels(secret);
  const selected =
    model && models.some((m) => m.id === model)
      ? model
      : preferModel(models, ["claude-sonnet", "claude-opus", "claude-haiku", "claude"]);

  const budget = claudeThinkingBudget(options?.thinkingLevel);
  const includeThinking = options?.includeThinking !== false;
  const maxTokens = budget ? Math.max(budget + 1024, 2048) : 1024;

  const body: Record<string, unknown> = {
    model: selected,
    max_tokens: maxTokens,
    system: "You are Claude Code, Anthropic's official CLI for Claude.",
    messages: [{ role: "user", content: prompt }],
  };
  if (budget) {
    body.thinking = {
      type: "enabled",
      budget_tokens: budget,
      ...(includeThinking ? { display: "summarized" } : {}),
    };
  }

  const res = await fetch(CLAUDE_OAUTH.messagesUrl, {
    method: "POST",
    headers: {
      ...claudeHeaders(token),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Claude chat failed (${selected}): ${res.status} ${text.slice(0, 400)}`,
    );
  }
  const json = (await res.json()) as {
    content?: Array<{
      type: string;
      text?: string;
      thinking?: string;
      signature?: string;
    }>;
    model?: string;
  };
  const blocks: ThinkBlock[] = [];
  const textParts: string[] = [];
  for (const c of json.content || []) {
    if (c.type === "thinking" || c.type === "redacted_thinking") {
      blocks.push({
        type: "thinking",
        content: typeof c.thinking === "string" ? c.thinking : undefined,
        signature: typeof c.signature === "string" ? c.signature : undefined,
        summary: typeof c.thinking === "string" ? c.thinking : undefined,
        raw: c as unknown as Record<string, unknown>,
      });
      continue;
    }
    if (c.type === "text" && c.text) textParts.push(c.text);
  }
  const thinking: ThinkingPayload | undefined = budget
    ? {
        level: options?.thinkingLevel || "medium",
        summary: blocks.map((b) => b.content || b.summary || "").filter(Boolean).join("\n\n") || undefined,
        blocks,
      }
    : undefined;
  return {
    text: textParts.join("\n") || JSON.stringify(json).slice(0, 1000),
    thinking,
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
          "grok-composer-2.5-fast",
          "grok-4.5",
          "grok-4.20",
          "grok-4",
          "grok",
        ]);

  const convId = crypto.randomUUID();
  const res = await fetch(GROK_OAUTH.responsesUrl, {
    method: "POST",
    headers: {
      ...grokHeaders(token),
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      "x-grok-model-override": selected,
      "x-grok-conv-id": convId,
      "x-grok-session-id": convId,
      "x-grok-req-id": crypto.randomUUID(),
    },
    body: JSON.stringify({
      model: selected,
      input: prompt,
      store: false,
      stream: true,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Grok chat failed (${selected}): ${res.status} ${text.slice(0, 400)}`,
    );
  }
  return {
    text: await readSseText(res),
    model: selected,
    models,
    providerLabel: "Grok Build",
  };
}

export async function runProviderChat(input: {
  provider: ProviderId;
  connection: ProviderConnection;
  prompt: string;
  model?: string;
  thinkingLevel?: ThinkingLevel;
  includeThinking?: boolean;
}) {
  const { secret } = await ensureFreshConnection(input.connection);
  switch (input.provider) {
    case "codex":
      return chatCodex(secret, input.prompt, "Codex", {
        model: input.model,
        thinkingLevel: input.thinkingLevel,
        includeThinking: input.includeThinking,
        flavor: "codex",
      });
    case "chatgpt":
      return chatCodex(secret, input.prompt, "ChatGPT", {
        model: input.model,
        thinkingLevel: input.thinkingLevel,
        includeThinking: input.includeThinking,
        flavor: "chatgpt",
      });
    case "claude":
      return chatClaude(secret, input.prompt, input.model, {
        thinkingLevel: input.thinkingLevel,
        includeThinking: input.includeThinking,
      });
    case "grok":
      return chatGrok(secret, input.prompt, input.model);
    default:
      throw new Error("Unsupported provider");
  }
}
