import { CODEX_OAUTH } from "./config";
import {
  chatgptAccountIdFromToken,
  type StoredProviderSecret,
} from "./providers";

export type ThinkingLevel =
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

export type ThinkBlock = {
  type: "reasoning" | "thinking";
  id?: string;
  summary?: string;
  /** Visible thinking text when the upstream returns it (e.g. Claude). */
  content?: string;
  encryptedContent?: string;
  signature?: string;
  raw?: Record<string, unknown>;
};

export type ThinkingPayload = {
  level?: ThinkingLevel;
  summary?: string;
  blocks: ThinkBlock[];
};

export type ProviderModel = {
  id: string;
  name?: string;
  kind?: "chat" | "image";
  reasoningLevels?: ThinkingLevel[];
  defaultReasoningLevel?: ThinkingLevel;
  supportsReasoningSummaries?: boolean;
};

export type CodexTransport = "codex" | "openai_api" | "relay";

export const CODEX_IMAGE_MODEL = "gpt-image-2";
export const THINKING_LEVELS: ThinkingLevel[] = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
];
const DEFAULT_CODEX_CLIENT_VERSION = "0.144.1";
const DEFAULT_REASONING_LEVELS: ThinkingLevel[] = [
  "low",
  "medium",
  "high",
  "xhigh",
];

async function resolveCodexClientVersion(): Promise<string> {
  try {
    const res = await fetch("https://registry.npmjs.org/@openai/codex/latest", {
      headers: { Accept: "application/json" },
    });
    if (res.ok) {
      const json = (await res.json()) as { version?: string };
      const match = json.version?.match(/\b\d+\.\d+\.\d+\b/);
      if (match) return match[0];
    }
  } catch {
    // ignore
  }
  return DEFAULT_CODEX_CLIENT_VERSION;
}

function asThinkingLevel(value: unknown): ThinkingLevel | null {
  if (typeof value !== "string") return null;
  const v = value.toLowerCase() as ThinkingLevel;
  return THINKING_LEVELS.includes(v) || v === "max" ? v : null;
}

function extractReasoningMeta(row: Record<string, unknown>): {
  reasoningLevels?: ThinkingLevel[];
  defaultReasoningLevel?: ThinkingLevel;
  supportsReasoningSummaries?: boolean;
} {
  const levels: ThinkingLevel[] = [];
  const rawLevels =
    row.supported_reasoning_levels ||
    row.supportedReasoningLevels ||
    (typeof row.capabilities === "object" &&
    row.capabilities &&
    !Array.isArray(row.capabilities)
      ? (row.capabilities as Record<string, unknown>).reasoning_efforts
      : null);
  if (Array.isArray(rawLevels)) {
    for (const entry of rawLevels) {
      if (typeof entry === "string") {
        const level = asThinkingLevel(entry);
        if (level) levels.push(level);
        continue;
      }
      if (entry && typeof entry === "object") {
        const effort = asThinkingLevel(
          (entry as Record<string, unknown>).effort ||
            (entry as Record<string, unknown>).level,
        );
        if (effort) levels.push(effort);
      }
    }
  }
  const defaultReasoningLevel =
    asThinkingLevel(row.default_reasoning_level) ||
    asThinkingLevel(row.defaultReasoningLevel) ||
    (levels.includes("medium") ? "medium" : levels[0]);
  const supportsReasoningSummaries = Boolean(
    row.supports_reasoning_summaries ??
      row.supportsReasoningSummaries ??
      levels.length > 0,
  );
  return {
    reasoningLevels: levels.length ? [...new Set(levels)] : undefined,
    defaultReasoningLevel: defaultReasoningLevel || undefined,
    supportsReasoningSummaries: supportsReasoningSummaries || undefined,
  };
}

function envBase(): string | null {
  const value = process.env.FAILURE_CODEX_BASE_URL?.trim();
  return value ? value.replace(/\/$/, "") : null;
}

function openaiApiBase(): string {
  return (
    process.env.FAILURE_OPENAI_API_BASE_URL?.trim().replace(/\/$/, "") ||
    "https://api.openai.com/v1"
  );
}

function defaultCodexBase(): string {
  return "https://chatgpt.com/backend-api/codex";
}

export function isCloudflareChallenge(res: Response, bodyText: string): boolean {
  if (res.status !== 403 && res.status !== 503) return false;
  const ctype = res.headers.get("content-type") || "";
  if (ctype.includes("text/html")) return true;
  if (res.headers.get("cf-mitigated")) return true;
  const sample = bodyText.slice(0, 500).toLowerCase();
  return (
    sample.includes("<html") ||
    sample.includes("cf-browser-verification") ||
    sample.includes("enable javascript and cookies") ||
    sample.includes("enlarge-appear") ||
    sample.includes("_cf_chl")
  );
}

function accountId(secret: StoredProviderSecret): string {
  const id =
    secret.accountId ||
    (secret.accessToken
      ? chatgptAccountIdFromToken(secret.accessToken)
      : null) ||
    (typeof secret.raw?.accountId === "string" ? secret.raw.accountId : null);
  if (!id) {
    throw new Error(
      "Missing ChatGPT-Account-Id — reconnect Codex/ChatGPT so the account id is stored",
    );
  }
  return id;
}

export function codexAuthHeaders(
  secret: StoredProviderSecret,
  extra?: Record<string, string>,
): Record<string, string> {
  const token = secret.accessToken;
  if (!token) throw new Error("Access token missing");
  return {
    Authorization: `Bearer ${token}`,
    "chatgpt-account-id": accountId(secret),
    Accept: "application/json",
    "User-Agent": `codex_cli_rs/${CODEX_OAUTH.originator === "codex_cli_rs" ? "0.144.1" : "0.144.1"}`,
    originator: CODEX_OAUTH.originator,
    ...extra,
  };
}

/** Dedupe + normalize kinds/names from the live catalog only (no injected fakes). */
function normalizeLiveModels(models: ProviderModel[]): ProviderModel[] {
  const seen = new Set<string>();
  const out: ProviderModel[] = [];
  for (const model of models) {
    if (seen.has(model.id)) continue;
    seen.add(model.id);
    const isImage =
      model.kind === "image" ||
      model.id === CODEX_IMAGE_MODEL ||
      /image/i.test(model.id);
    out.push({
      ...model,
      kind: model.kind || (isImage ? "image" : "chat"),
      name:
        model.name ||
        (model.id === CODEX_IMAGE_MODEL ? "GPT Image 2" : model.id),
    });
  }
  return out;
}

function collectModelBuckets(payload: unknown, into: unknown[] = []): unknown[] {
  if (!payload) return into;
  if (Array.isArray(payload)) {
    for (const item of payload) {
      if (typeof item === "string") {
        into.push(item);
        continue;
      }
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      if (
        typeof row.id === "string" ||
        typeof row.slug === "string" ||
        typeof row.model === "string" ||
        typeof row.model_id === "string"
      ) {
        into.push(item);
      }
      for (const key of [
        "models",
        "data",
        "items",
        "groups",
        "categories",
        "available_models",
        "entries",
        "results",
      ]) {
        if (row[key] !== undefined) collectModelBuckets(row[key], into);
      }
    }
    return into;
  }
  if (typeof payload === "object") {
    const root = payload as Record<string, unknown>;
    for (const key of [
      "models",
      "data",
      "items",
      "groups",
      "categories",
      "available_models",
      "entries",
      "results",
    ]) {
      if (root[key] !== undefined) collectModelBuckets(root[key], into);
    }
  }
  return into;
}

function pickModelIds(payload: unknown): ProviderModel[] {
  const buckets = collectModelBuckets(payload);
  const models: ProviderModel[] = [];
  const seen = new Set<string>();
  for (const item of buckets) {
    if (typeof item === "string") {
      if (seen.has(item)) continue;
      seen.add(item);
      models.push({
        id: item,
        name: item,
        kind: item === CODEX_IMAGE_MODEL ? "image" : "chat",
        reasoningLevels:
          item === CODEX_IMAGE_MODEL ? undefined : DEFAULT_REASONING_LEVELS,
        defaultReasoningLevel:
          item === CODEX_IMAGE_MODEL ? undefined : "medium",
        supportsReasoningSummaries: item !== CODEX_IMAGE_MODEL,
      });
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
    // Keep every model the account catalog returns — do not filter by
    // supported_in_api / visibility; the live list is the source of truth.
    seen.add(id);
    const name =
      (typeof row.display_name === "string" && row.display_name) ||
      (typeof row.name === "string" && row.name) ||
      (typeof row.title === "string" && row.title) ||
      id;
    const reasoning = extractReasoningMeta(row);
    const nested =
      (row.model && typeof row.model === "object"
        ? extractReasoningMeta(row.model as Record<string, unknown>)
        : null) ||
      (row.info && typeof row.info === "object"
        ? extractReasoningMeta(row.info as Record<string, unknown>)
        : null);
    const isImage =
      id === CODEX_IMAGE_MODEL ||
      id.includes("image") ||
      id.includes("gpt-image");
    models.push({
      id,
      name,
      kind: isImage ? "image" : "chat",
      reasoningLevels:
        reasoning.reasoningLevels ||
        nested?.reasoningLevels ||
        (isImage ? undefined : DEFAULT_REASONING_LEVELS),
      defaultReasoningLevel:
        reasoning.defaultReasoningLevel ||
        nested?.defaultReasoningLevel ||
        (isImage ? undefined : "medium"),
      supportsReasoningSummaries:
        reasoning.supportsReasoningSummaries ||
        nested?.supportsReasoningSummaries ||
        !isImage,
    });
  }
  return models;
}

function userInputList(prompt: string) {
  return [
    {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: prompt }],
    },
  ];
}

type UpstreamAttempt = {
  transport: CodexTransport;
  baseUrl: string;
};

function upstreamCandidates(): UpstreamAttempt[] {
  const candidates: UpstreamAttempt[] = [];
  const relay = envBase();
  if (relay) {
    candidates.push({ transport: "relay", baseUrl: relay });
  }
  candidates.push({ transport: "codex", baseUrl: defaultCodexBase() });
  candidates.push({ transport: "openai_api", baseUrl: openaiApiBase() });
  return candidates;
}

async function fetchUpstream(
  secret: StoredProviderSecret,
  path: string,
  init: RequestInit & { preferJson?: boolean } = {},
): Promise<{
  res: Response;
  text: string;
  transport: CodexTransport;
  baseUrl: string;
}> {
  const errors: string[] = [];
  for (const candidate of upstreamCandidates()) {
    const url = `${candidate.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    try {
      const headers = new Headers(init.headers || {});
      const auth = codexAuthHeaders(secret);
      for (const [k, v] of Object.entries(auth)) {
        if (!headers.has(k)) headers.set(k, v);
      }
      const res = await fetch(url, { ...init, headers });
      const text = await res.text();
      if (isCloudflareChallenge(res, text)) {
        errors.push(
          `${candidate.transport} blocked by Cloudflare challenge at ${candidate.baseUrl}`,
        );
        continue;
      }
      return { res, text, transport: candidate.transport, baseUrl: candidate.baseUrl };
    } catch (error) {
      errors.push(
        `${candidate.transport}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  throw new Error(
    `Codex/ChatGPT upstream unreachable from this host (Cloudflare Workers cannot call chatgpt.com directly). ${errors.join(" | ")}. Set FAILURE_CODEX_BASE_URL to a Node relay (see scripts/codex-relay.mjs).`,
  );
}

export async function listCodexModels(secret: StoredProviderSecret): Promise<{
  models: ProviderModel[];
  transport: CodexTransport;
  source: "live" | "error";
  warning?: string;
}> {
  const clientVersion = await resolveCodexClientVersion();
  try {
    const { res, text, transport } = await fetchUpstream(
      secret,
      `/models?client_version=${encodeURIComponent(clientVersion)}`,
      { method: "GET" },
    );
    if (!res.ok) {
      throw new Error(`Upstream models failed: ${res.status} ${text.slice(0, 240)}`);
    }
    const models = normalizeLiveModels(pickModelIds(JSON.parse(text)));
    if (!models.length) {
      return {
        models: [],
        transport,
        source: "error",
        warning:
          "Upstream returned an empty catalog — no guessed models will be shown.",
      };
    }
    return { models, transport, source: "live" };
  } catch (error) {
    return {
      models: [],
      transport: envBase() ? "relay" : "openai_api",
      source: "error",
      warning:
        error instanceof Error
          ? `${error.message} — no guessed models will be shown.`
          : "Live model fetch failed — no guessed models will be shown.",
    };
  }
}

function summaryTextFromReasoningItem(item: Record<string, unknown>): string {
  if (typeof item.summary === "string") return item.summary;
  if (!Array.isArray(item.summary)) return "";
  return item.summary
    .map((s) => {
      if (typeof s === "string") return s;
      if (s && typeof s === "object") {
        return String((s as { text?: string }).text || "");
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function reasoningContentFromItem(item: Record<string, unknown>): string {
  if (typeof item.content === "string") return item.content;
  if (!Array.isArray(item.content)) return "";
  return item.content
    .map((c) => {
      if (typeof c === "string") return c;
      if (!c || typeof c !== "object") return "";
      const row = c as { text?: string; type?: string };
      if (row.type === "reasoning_text" || row.type === "summary_text" || row.text) {
        return String(row.text || "");
      }
      return "";
    })
    .filter(Boolean)
    .join("");
}

function pushThinkBlock(
  blocks: ThinkBlock[],
  item: Record<string, unknown>,
  type: ThinkBlock["type"] = "reasoning",
) {
  const id = typeof item.id === "string" ? item.id : undefined;
  const summary = summaryTextFromReasoningItem(item) || undefined;
  const content = reasoningContentFromItem(item) || undefined;
  const encryptedContent =
    typeof item.encrypted_content === "string"
      ? item.encrypted_content
      : undefined;
  const signature =
    typeof item.signature === "string" ? item.signature : undefined;
  if (!summary && !content && !encryptedContent && !signature) return;

  const existingIdx = id
    ? blocks.findIndex((b) => b.id === id)
    : blocks.findIndex(
        (b) =>
          b.type === type &&
          b.summary === summary &&
          b.content === content &&
          b.encryptedContent === encryptedContent,
      );
  const next: ThinkBlock = {
    type,
    id,
    summary,
    content,
    encryptedContent,
    signature,
    raw: item,
  };
  if (existingIdx >= 0) {
    blocks[existingIdx] = { ...blocks[existingIdx], ...next };
  } else {
    blocks.push(next);
  }
}

function extractFromResponseObject(
  response: Record<string, unknown>,
  chunks: string[],
  summaryChunks: string[],
  thinkBlocks: ThinkBlock[],
) {
  if (typeof response.output_text === "string" && response.output_text) {
    chunks.push(response.output_text);
  }
  for (const item of (response.output as Array<Record<string, unknown>>) || []) {
    if (item?.type === "reasoning") {
      pushThinkBlock(thinkBlocks, item, "reasoning");
      const summary = summaryTextFromReasoningItem(item);
      if (summary) summaryChunks.push(summary);
      const content = reasoningContentFromItem(item);
      if (content) summaryChunks.push(content);
    }
    if (item?.type === "message" && Array.isArray(item.content)) {
      for (const c of item.content as Array<{ text?: string; type?: string }>) {
        if (c.type === "output_text" || c.text) {
          if (c.text) chunks.push(c.text);
        }
      }
    }
  }
}

function parseCodexChatPayload(raw: string): {
  text: string;
  thinkingSummary: string;
  thinkBlocks: ThinkBlock[];
} {
  const chunks: string[] = [];
  const summaryChunks: string[] = [];
  const thinkBlocks: ThinkBlock[] = [];
  const reasoningTextChunks: string[] = [];

  if (!raw.includes("data:")) {
    try {
      const json = JSON.parse(raw) as Record<string, unknown>;
      extractFromResponseObject(json, chunks, summaryChunks, thinkBlocks);
      if (json.response && typeof json.response === "object") {
        extractFromResponseObject(
          json.response as Record<string, unknown>,
          chunks,
          summaryChunks,
          thinkBlocks,
        );
      }
      if (typeof json.text === "string") chunks.push(json.text);
    } catch {
      // fall through to raw slice
    }
    return {
      text: chunks.join("") || raw.slice(0, 2000),
      thinkingSummary: [...summaryChunks, ...reasoningTextChunks].join(""),
      thinkBlocks,
    };
  }

  for (const line of raw.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    try {
      const json = JSON.parse(data) as Record<string, unknown>;
      if (typeof json.text === "string") chunks.push(json.text);
      if (
        json.type === "response.output_text.delta" &&
        typeof json.delta === "string"
      ) {
        chunks.push(json.delta);
      }
      if (
        json.type === "response.reasoning_summary_text.delta" &&
        typeof json.delta === "string"
      ) {
        summaryChunks.push(json.delta);
      }
      if (
        json.type === "response.reasoning_summary_text.done" &&
        typeof json.text === "string"
      ) {
        summaryChunks.push(json.text);
      }
      if (
        (json.type === "response.reasoning_summary_part.added" ||
          json.type === "response.reasoning_summary_part.done") &&
        typeof json.part === "object" &&
        json.part
      ) {
        const part = json.part as { text?: string };
        if (part.text) summaryChunks.push(part.text);
      }
      if (
        json.type === "response.reasoning_text.delta" &&
        typeof json.delta === "string"
      ) {
        reasoningTextChunks.push(json.delta);
      }
      if (
        json.type === "response.reasoning_text.done" &&
        typeof json.text === "string"
      ) {
        reasoningTextChunks.push(json.text);
      }
      if (
        json.type === "response.output_item.done" ||
        json.type === "response.output_item.added"
      ) {
        const item = json.item as Record<string, unknown> | undefined;
        if (item?.type === "reasoning") {
          pushThinkBlock(thinkBlocks, item, "reasoning");
          const summary = summaryTextFromReasoningItem(item);
          if (summary) summaryChunks.push(summary);
        }
      }
      if (json.type === "response.completed") {
        const response = json.response as Record<string, unknown> | undefined;
        if (response) {
          extractFromResponseObject(
            response,
            chunks,
            summaryChunks,
            thinkBlocks,
          );
        }
      }
      const choices = json.choices as
        | Array<{ delta?: { content?: string }; message?: { content?: string } }>
        | undefined;
      if (choices?.[0]?.delta?.content) chunks.push(choices[0].delta.content);
      if (choices?.[0]?.message?.content) {
        chunks.push(choices[0].message.content);
      }
    } catch {
      // ignore malformed SSE chunks
    }
  }

  if (reasoningTextChunks.length) {
    pushThinkBlock(
      thinkBlocks,
      {
        type: "reasoning",
        content: reasoningTextChunks.join(""),
      },
      "reasoning",
    );
  }

  // Prefer completed reasoning items for the summary; fall back to streamed deltas.
  const blockSummary = thinkBlocks
    .map((b) => b.summary || b.content || "")
    .filter(Boolean)
    .join("\n\n");
  const streamedSummary = summaryChunks.join("");
  const thinkingSummary =
    blockSummary ||
    streamedSummary ||
    reasoningTextChunks.join("") ||
    "";

  return {
    text: chunks.join("") || raw.slice(0, 2000),
    thinkingSummary,
    thinkBlocks,
  };
}

function preferModel(models: ProviderModel[], hints: string[]): string {
  for (const hint of hints) {
    const exact = models.find((m) => m.id === hint && m.kind !== "image");
    if (exact) return exact.id;
  }
  for (const hint of hints) {
    const partial = models.find(
      (m) => m.kind !== "image" && m.id.includes(hint),
    );
    if (partial) return partial.id;
  }
  const chat = models.find((m) => m.kind !== "image");
  if (!chat) throw new Error("No chat models available");
  return chat.id;
}

function resolveThinkingLevel(
  model: ProviderModel | undefined,
  requested?: ThinkingLevel,
): ThinkingLevel | undefined {
  const levels = model?.reasoningLevels || DEFAULT_REASONING_LEVELS;
  if (requested) {
    if (requested === "none" || requested === "minimal") {
      return levels.includes(requested) ? requested : levels[0];
    }
    if (levels.includes(requested)) return requested;
  }
  return model?.defaultReasoningLevel || "medium";
}

export async function chatCodex(
  secret: StoredProviderSecret,
  prompt: string,
  label: string,
  options?: {
    model?: string;
    thinkingLevel?: ThinkingLevel;
    includeThinking?: boolean;
  },
) {
  const listed = await listCodexModels(secret);
  const selected =
    options?.model &&
    listed.models.some((m) => m.id === options.model && m.kind !== "image")
      ? options.model
      : preferModel(listed.models, [
          "gpt-5.6-sol",
          "gpt-5.6",
          "gpt-5.5",
          "gpt-5.4",
          "gpt-5.3-codex",
          "gpt-5.2-codex",
          "codex",
          "gpt-5",
        ]);
  const modelMeta = listed.models.find((m) => m.id === selected);
  const thinkingLevel = resolveThinkingLevel(modelMeta, options?.thinkingLevel);
  const includeThinking = options?.includeThinking !== false;

  const body: Record<string, unknown> = {
    model: selected,
    instructions: "You are a helpful assistant used to test Failure AI OAuth.",
    input: userInputList(prompt),
    store: false,
    stream: true,
    include: ["reasoning.encrypted_content"],
  };
  if (thinkingLevel && thinkingLevel !== "none") {
    body.reasoning = {
      effort: thinkingLevel,
      ...(includeThinking && modelMeta?.supportsReasoningSummaries !== false
        ? { summary: "detailed" }
        : {}),
    };
  } else if (thinkingLevel === "none") {
    body.reasoning = { effort: "none" };
  }

  const { res, text, transport } = await fetchUpstream(secret, "/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(
      `${label} chat failed (${selected} via ${transport}): ${res.status} ${text.slice(0, 400)}`,
    );
  }
  const parsed = parseCodexChatPayload(text);
  return {
    text: parsed.text,
    thinking: {
      level: thinkingLevel,
      summary: parsed.thinkingSummary || undefined,
      blocks: parsed.thinkBlocks,
    } satisfies ThinkingPayload,
    model: selected,
    models: listed.models,
    providerLabel: label,
    transport,
    warning: listed.warning,
  };
}

function extractImageB64(payload: unknown): string[] {
  const images: string[] = [];
  if (!payload || typeof payload !== "object") return images;
  const root = payload as Record<string, unknown>;
  if (Array.isArray(root.data)) {
    for (const item of root.data) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      if (typeof row.b64_json === "string") images.push(row.b64_json);
      if (typeof row.base64 === "string") images.push(row.base64);
    }
  }
  // Responses-style tool output
  const output = root.output;
  if (Array.isArray(output)) {
    for (const item of output) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      if (row.type === "image_generation_call" && typeof row.result === "string") {
        images.push(row.result);
      }
      const content = row.content;
      if (Array.isArray(content)) {
        for (const c of content) {
          if (!c || typeof c !== "object") continue;
          const block = c as Record<string, unknown>;
          if (typeof block.b64_json === "string") images.push(block.b64_json);
          if (typeof block.image_base64 === "string") images.push(block.image_base64);
        }
      }
    }
  }
  return images;
}

export async function generateCodexImage(
  secret: StoredProviderSecret,
  input: {
    prompt: string;
    size?: string;
    quality?: string;
    background?: string;
    n?: number;
  },
) {
  const body = JSON.stringify({
    model: CODEX_IMAGE_MODEL,
    prompt: input.prompt,
    ...(input.size ? { size: input.size } : {}),
    ...(input.quality ? { quality: input.quality } : {}),
    ...(input.background ? { background: input.background } : {}),
    ...(input.n ? { n: input.n } : {}),
  });

  // Prefer native Codex image endpoints; openai_api fallback uses same path shape under /v1
  const { res, text, transport } = await fetchUpstream(
    secret,
    "/images/generations",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    },
  );

  if (!res.ok) {
    // Fallback: Responses API + image_generation tool on host chat model
    if (res.status === 404 || res.status === 405 || res.status === 400) {
      return generateCodexImageViaResponses(secret, input);
    }
    throw new Error(
      `Image generation failed via ${transport}: ${res.status} ${text.slice(0, 400)}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Image generation returned non-JSON");
  }
  const images = extractImageB64(parsed);
  if (!images.length) {
    throw new Error("Image generation returned no image data");
  }
  return {
    model: CODEX_IMAGE_MODEL,
    images: images.map((b64) => ({ b64_json: b64 })),
    transport,
  };
}

async function generateCodexImageViaResponses(
  secret: StoredProviderSecret,
  input: {
    prompt: string;
    size?: string;
    quality?: string;
    background?: string;
  },
) {
  const listed = await listCodexModels(secret);
  const host = preferModel(listed.models, [
    "gpt-5.6-sol",
    "gpt-5.6",
    "gpt-5.5",
    "gpt-5.4",
    "gpt-5",
  ]);
  const tool: Record<string, unknown> = {
    type: "image_generation",
  };
  if (input.size) tool.size = input.size;
  if (input.quality) tool.quality = input.quality;
  if (input.background) tool.background = input.background;

  const body = JSON.stringify({
    model: host,
    instructions: "You are Codex, OpenAI's coding agent.",
    input: userInputList(input.prompt),
    tools: [tool],
    tool_choice: { type: "image_generation" },
    store: false,
    stream: true,
  });

  const { res, text, transport } = await fetchUpstream(secret, "/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body,
  });
  if (!res.ok) {
    throw new Error(
      `Image generation (responses) failed via ${transport}: ${res.status} ${text.slice(0, 400)}`,
    );
  }

  // Collect final response JSON from SSE if needed
  let images = extractImageB64(safeJson(text));
  if (!images.length && text.includes("data:")) {
    for (const line of text.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      images.push(...extractImageB64(safeJson(data)));
      try {
        const evt = JSON.parse(data) as {
          type?: string;
          result?: string;
          partial_image_b64?: string;
        };
        if (typeof evt.result === "string") images.push(evt.result);
        if (typeof evt.partial_image_b64 === "string") {
          images.push(evt.partial_image_b64);
        }
      } catch {
        // ignore
      }
    }
  }
  images = [...new Set(images)];
  if (!images.length) {
    throw new Error("Image generation produced no image bytes");
  }
  return {
    model: CODEX_IMAGE_MODEL,
    images: images.map((b64) => ({ b64_json: b64 })),
    transport,
    hostModel: host,
  };
}

export async function editCodexImage(
  secret: StoredProviderSecret,
  input: {
    prompt: string;
    images: Array<{ dataUrl: string }>;
    size?: string;
    quality?: string;
    background?: string;
    n?: number;
  },
) {
  if (!input.images.length) throw new Error("At least one reference image is required");
  if (input.images.length > 5) throw new Error("At most 5 reference images are supported");

  const body = JSON.stringify({
    model: CODEX_IMAGE_MODEL,
    prompt: input.prompt,
    images: input.images.map((img) => ({ image_url: img.dataUrl })),
    ...(input.size ? { size: input.size } : {}),
    ...(input.quality ? { quality: input.quality } : {}),
    ...(input.background ? { background: input.background } : {}),
    ...(input.n ? { n: input.n } : {}),
  });

  const { res, text, transport } = await fetchUpstream(secret, "/images/edits", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });

  if (!res.ok) {
    // Responses API edit via input_image references
    return editCodexImageViaResponses(secret, input);
  }
  const parsed = safeJson(text);
  const images = extractImageB64(parsed);
  if (!images.length) throw new Error("Image edit returned no image data");
  return {
    model: CODEX_IMAGE_MODEL,
    images: images.map((b64) => ({ b64_json: b64 })),
    transport,
  };
}

async function editCodexImageViaResponses(
  secret: StoredProviderSecret,
  input: {
    prompt: string;
    images: Array<{ dataUrl: string }>;
    size?: string;
    quality?: string;
    background?: string;
  },
) {
  const listed = await listCodexModels(secret);
  const host = preferModel(listed.models, [
    "gpt-5.6-sol",
    "gpt-5.6",
    "gpt-5.5",
    "gpt-5.4",
    "gpt-5",
  ]);
  const tool: Record<string, unknown> = { type: "image_generation" };
  if (input.size) tool.size = input.size;
  if (input.quality) tool.quality = input.quality;
  if (input.background) tool.background = input.background;

  const content: Array<Record<string, unknown>> = [
    { type: "input_text", text: input.prompt },
    ...input.images.map((img) => ({
      type: "input_image",
      image_url: img.dataUrl,
      detail: "auto",
    })),
  ];

  const body = JSON.stringify({
    model: host,
    instructions: "You are Codex, OpenAI's coding agent.",
    input: [{ type: "message", role: "user", content }],
    tools: [tool],
    tool_choice: { type: "image_generation" },
    store: false,
    stream: true,
  });

  const { res, text, transport } = await fetchUpstream(secret, "/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body,
  });
  if (!res.ok) {
    throw new Error(
      `Image edit failed via ${transport}: ${res.status} ${text.slice(0, 400)}`,
    );
  }

  const images = new Set<string>();
  for (const line of text.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    for (const b64 of extractImageB64(safeJson(data))) images.add(b64);
    try {
      const evt = JSON.parse(data) as { result?: string };
      if (typeof evt.result === "string") images.add(evt.result);
    } catch {
      // ignore
    }
  }
  if (!images.size) throw new Error("Image edit produced no image bytes");
  return {
    model: CODEX_IMAGE_MODEL,
    images: [...images].map((b64) => ({ b64_json: b64 })),
    transport,
    hostModel: host,
  };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function exposeCodexEndpoints() {
  const relay = envBase();
  const codexBase = relay || defaultCodexBase();
  return {
    base: codexBase,
    models: `${codexBase}/models`,
    responses: `${codexBase}/responses`,
    imageGenerations: `${codexBase}/images/generations`,
    imageEdits: `${codexBase}/images/edits`,
    openaiApiFallback: openaiApiBase(),
    imageModel: CODEX_IMAGE_MODEL,
    note: relay
      ? "Using FAILURE_CODEX_BASE_URL relay (required on Cloudflare Workers)."
      : "Direct chatgpt.com calls fail on Cloudflare Workers; set FAILURE_CODEX_BASE_URL to scripts/codex-relay.mjs.",
  };
}
