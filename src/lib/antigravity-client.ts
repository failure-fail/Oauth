import { ANTIGRAVITY_OAUTH } from "./config";
import type { StoredProviderSecret } from "./providers";
import type { ProviderModel, ThinkingLevel, ThinkBlock, ThinkingPayload } from "./codex-client";

const FALLBACK_MODELS: ProviderModel[] = [
  {
    id: "gemini-3-pro-high",
    name: "Gemini 3 Pro High",
    kind: "chat",
    reasoningLevels: ["low", "medium", "high"],
    defaultReasoningLevel: "medium",
    supportsReasoningSummaries: true,
  },
  {
    id: "gemini-3-pro-low",
    name: "Gemini 3 Pro Low",
    kind: "chat",
    reasoningLevels: ["low", "medium", "high"],
    defaultReasoningLevel: "low",
    supportsReasoningSummaries: true,
  },
  {
    id: "claude-sonnet-4-6",
    name: "Claude Sonnet 4.6",
    kind: "chat",
    reasoningLevels: ["none", "low", "medium", "high"],
    defaultReasoningLevel: "medium",
    supportsReasoningSummaries: true,
  },
  {
    id: "claude-opus-4-6-thinking",
    name: "Claude Opus 4.6 Thinking",
    kind: "chat",
    reasoningLevels: ["low", "medium", "high"],
    defaultReasoningLevel: "high",
    supportsReasoningSummaries: true,
  },
  {
    id: "gpt-oss-120b-medium",
    name: "GPT-OSS 120B Medium",
    kind: "chat",
  },
];

export function antigravityHeaders(
  secret: StoredProviderSecret,
  extra?: Record<string, string>,
): Record<string, string> {
  const token = secret.accessToken;
  if (!token) throw new Error("Antigravity access token missing");
  const platform =
    process.platform === "win32"
      ? "WINDOWS"
      : process.platform === "darwin"
        ? "MACOS"
        : "LINUX";
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": `antigravity/${ANTIGRAVITY_OAUTH.version} darwin/arm64`,
    "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
    "Client-Metadata": JSON.stringify({
      ideType: "ANTIGRAVITY",
      platform,
      pluginType: "GEMINI",
    }),
    ...extra,
  };
}

function projectId(secret: StoredProviderSecret): string {
  return (
    secret.projectId ||
    (typeof secret.raw?.projectId === "string" ? secret.raw.projectId : "") ||
    ANTIGRAVITY_OAUTH.defaultProjectId
  );
}

function endpointBases(): string[] {
  return [
    ANTIGRAVITY_OAUTH.endpoints.prod,
    ANTIGRAVITY_OAUTH.endpoints.daily,
    ANTIGRAVITY_OAUTH.endpoints.autopush,
  ];
}

async function postJson(
  secret: StoredProviderSecret,
  path: string,
  body: unknown,
  accept?: string,
): Promise<{ base: string; json: unknown; text: string; ok: boolean; status: number }> {
  const errors: string[] = [];
  for (const base of endpointBases()) {
    try {
      const res = await fetch(`${base}${path}`, {
        method: "POST",
        headers: antigravityHeaders(
          secret,
          accept ? { Accept: accept } : undefined,
        ),
        body: JSON.stringify(body),
      });
      const text = await res.text();
      if (res.ok) {
        let json: unknown = null;
        try {
          json = JSON.parse(text);
        } catch {
          json = null;
        }
        return { base, json, text, ok: true, status: res.status };
      }
      errors.push(`${base}: ${res.status} ${text.slice(0, 160)}`);
    } catch (error) {
      errors.push(
        `${base}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  throw new Error(`Antigravity request failed (${path}): ${errors.join(" | ")}`);
}

function thinkingBudget(level?: ThinkingLevel): number | null {
  switch (level) {
    case undefined:
    case "medium":
      return 8192;
    case "none":
      return null;
    case "minimal":
    case "low":
      return 4096;
    case "high":
    case "xhigh":
    case "max":
      return 16384;
    default:
      return 8192;
  }
}

export async function listAntigravityModels(
  secret: StoredProviderSecret,
): Promise<{
  models: ProviderModel[];
  source: "live" | "fallback";
  warning?: string;
  projectId: string;
}> {
  const project = projectId(secret);
  try {
    const { json } = await postJson(secret, "/v1internal:fetchAvailableModels", {
      project,
    });
    const root = (json || {}) as {
      models?: Record<
        string,
        { displayName?: string; quotaInfo?: { isExhausted?: boolean } }
      >;
    };
    const models: ProviderModel[] = [];
    for (const [id, info] of Object.entries(root.models || {})) {
      const thinking = /thinking|gemini-3|claude-opus|claude-sonnet/i.test(id);
      models.push({
        id,
        name: info.displayName || id,
        kind: "chat",
        reasoningLevels: thinking
          ? (["none", "low", "medium", "high"] as ThinkingLevel[])
          : undefined,
        defaultReasoningLevel: thinking ? "medium" : undefined,
        supportsReasoningSummaries: thinking,
      });
    }
    if (!models.length) {
      return {
        models: FALLBACK_MODELS,
        source: "fallback",
        warning: "Antigravity returned an empty model list; using known models.",
        projectId: project,
      };
    }
    return { models, source: "live", projectId: project };
  } catch (error) {
    return {
      models: FALLBACK_MODELS,
      source: "fallback",
      warning:
        error instanceof Error
          ? `${error.message} — using known Antigravity models.`
          : "Live Antigravity models failed — using known models.",
      projectId: project,
    };
  }
}

function preferModel(models: ProviderModel[], hints: string[]): string {
  for (const hint of hints) {
    const exact = models.find((m) => m.id === hint);
    if (exact) return exact.id;
  }
  for (const hint of hints) {
    const partial = models.find((m) => m.id.includes(hint));
    if (partial) return partial.id;
  }
  if (!models[0]) throw new Error("No Antigravity models available");
  return models[0].id;
}

function extractTextAndThinking(payload: unknown): {
  text: string;
  thinking: ThinkingPayload;
} {
  const blocks: ThinkBlock[] = [];
  const textParts: string[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    const row = node as Record<string, unknown>;
    if (Array.isArray(row.candidates)) walk(row.candidates);
    if (row.response) walk(row.response);
    if (row.content) walk(row.content);
    if (Array.isArray(row.parts)) {
      for (const part of row.parts as Array<Record<string, unknown>>) {
        const text = typeof part.text === "string" ? part.text : "";
        if (!text) continue;
        if (part.thought === true || part.thoughtSignature) {
          blocks.push({
            type: "thinking",
            content: text,
            summary: text,
            signature:
              typeof part.thoughtSignature === "string"
                ? part.thoughtSignature
                : undefined,
            raw: part,
          });
        } else {
          textParts.push(text);
        }
      }
    }
  };
  walk(payload);
  return {
    text: textParts.join(""),
    thinking: {
      summary: blocks.map((b) => b.content || b.summary || "").filter(Boolean).join("\n\n") || undefined,
      blocks,
    },
  };
}

function parseSse(raw: string): unknown[] {
  const events: unknown[] = [];
  for (const line of raw.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    try {
      events.push(JSON.parse(data));
    } catch {
      // ignore
    }
  }
  return events;
}

export async function chatAntigravity(
  secret: StoredProviderSecret,
  prompt: string,
  options?: {
    model?: string;
    thinkingLevel?: ThinkingLevel;
    includeThinking?: boolean;
  },
) {
  const listed = await listAntigravityModels(secret);
  const selected =
    options?.model && listed.models.some((m) => m.id === options.model)
      ? options.model
      : preferModel(listed.models, [
          "gemini-3-pro-high",
          "claude-sonnet-4-6",
          "claude-opus-4-6-thinking",
          "gemini",
          "claude",
        ]);
  const budget = thinkingBudget(options?.thinkingLevel);
  const includeThinking = options?.includeThinking !== false;
  const project = listed.projectId;
  const requestBody: Record<string, unknown> = {
    project,
    model: selected,
    userAgent: "antigravity",
    requestType: "agent",
    requestId: `failure-${Date.now()}`,
    request: {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      systemInstruction: {
        parts: [
          {
            text: "You are Antigravity, used via Failure AI OAuth for integration testing.",
          },
        ],
      },
      generationConfig: {
        maxOutputTokens: budget ? Math.max(budget + 2048, 4096) : 2048,
        ...(budget && includeThinking
          ? {
              thinkingConfig: {
                thinkingBudget: budget,
                includeThoughts: true,
              },
            }
          : {}),
      },
    },
  };

  const { text, json, base } = await postJson(
    secret,
    "/v1internal:streamGenerateContent?alt=sse",
    requestBody,
    "text/event-stream",
  );

  const events = text.includes("data:") ? parseSse(text) : [json];
  const merged = extractTextAndThinking(events.length ? events : json);
  return {
    text: merged.text || text.slice(0, 2000),
    thinking: {
      level: options?.thinkingLevel || (budget ? "medium" : "none"),
      summary: merged.thinking.summary,
      blocks: merged.thinking.blocks,
    } satisfies ThinkingPayload,
    model: selected,
    models: listed.models,
    providerLabel: "Antigravity",
    transport: base,
    warning: listed.warning,
    projectId: project,
  };
}

export function antigravityCredentialEndpoints() {
  const prod = ANTIGRAVITY_OAUTH.endpoints.prod;
  return {
    base: prod,
    loadCodeAssist: `${prod}/v1internal:loadCodeAssist`,
    fetchAvailableModels: `${prod}/v1internal:fetchAvailableModels`,
    generateContent: `${prod}/v1internal:generateContent`,
    streamGenerateContent: `${prod}/v1internal:streamGenerateContent?alt=sse`,
    authorize: ANTIGRAVITY_OAUTH.authorizeUrl,
    token: ANTIGRAVITY_OAUTH.tokenUrl,
    fallbacks: [
      ANTIGRAVITY_OAUTH.endpoints.daily,
      ANTIGRAVITY_OAUTH.endpoints.autopush,
    ],
  };
}
