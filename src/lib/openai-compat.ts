import { randomUUID } from "crypto";
import { db } from "./db";
import { verifyAccessToken } from "./oauth-server";
import { PROVIDERS, type ProviderId } from "./providers-meta";
import { listProviderModels, runProviderChat } from "./chat";
import type { ThinkingLevel } from "./codex-client";

const PROVIDER_IDS = new Set(PROVIDERS.map((p) => p.id));

export type OpenAiMessage = {
  role: string;
  content?: string | Array<{ type?: string; text?: string }>;
  name?: string;
};

export type OpenAiChatRequest = {
  model: string;
  messages: OpenAiMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  /** OpenAI reasoning-style hint → Failure thinkingLevel */
  reasoning_effort?: string;
  thinking?: { type?: string; budget_tokens?: number } | string;
};

export class OpenAiCompatError extends Error {
  status: number;
  type: string;
  code: string;

  constructor(
    status: number,
    message: string,
    opts?: { type?: string; code?: string },
  ) {
    super(message);
    this.status = status;
    this.type = opts?.type || "invalid_request_error";
    this.code = opts?.code || "invalid_request";
  }
}

export function openAiErrorResponse(error: unknown) {
  if (error instanceof OpenAiCompatError) {
    return Response.json(
      {
        error: {
          message: error.message,
          type: error.type,
          code: error.code,
          param: null,
        },
      },
      {
        status: error.status,
        headers: corsHeaders(),
      },
    );
  }
  const message = error instanceof Error ? error.message : "Internal error";
  return Response.json(
    {
      error: {
        message,
        type: "server_error",
        code: "internal_error",
        param: null,
      },
    },
    { status: 500, headers: corsHeaders() },
  );
}

export function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers":
      "Authorization, Content-Type, OpenAI-Beta, X-Failure-Provider",
    "Access-Control-Max-Age": "86400",
  };
}

export function optionsResponse() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function requireFailureBearer(req: Request): Promise<{
  userId: string;
  scope: string;
  clientId: string;
}> {
  const header = req.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) {
    throw new OpenAiCompatError(401, "Missing Bearer API key or access token", {
      type: "invalid_request_error",
      code: "invalid_api_key",
    });
  }

  // Personal API keys: fsk_… (persistent OPENAI_API_KEY)
  if (token.startsWith("fsk_")) {
    const { hashToken } = await import("./oauth-server");
    const record = await db.findApiKeyByHash(hashToken(token));
    if (!record) {
      throw new OpenAiCompatError(401, "Invalid API key", {
        code: "invalid_api_key",
      });
    }
    const user = await db.findUserById(record.userId);
    if (!user) {
      throw new OpenAiCompatError(401, "Invalid API key", {
        code: "invalid_api_key",
      });
    }
    void db.touchApiKey(record.id);
    return {
      userId: user.id,
      scope: "openid profile email providers",
      clientId: "fail_api_key",
    };
  }

  try {
    const payload = await verifyAccessToken(token);
    const userId = String(payload.sub || "");
    if (!userId) {
      throw new OpenAiCompatError(401, "Invalid access token", {
        code: "invalid_api_key",
      });
    }
    const user = await db.findUserById(userId);
    if (!user) {
      throw new OpenAiCompatError(401, "Invalid access token", {
        code: "invalid_api_key",
      });
    }
    const scope = String(payload.scope || "");
    if (!scope.split(/\s+/).includes("providers")) {
      throw new OpenAiCompatError(
        403,
        'Access token missing "providers" scope. Re-authorize with scope including providers.',
        { type: "permission_error", code: "insufficient_scope" },
      );
    }
    return {
      userId: user.id,
      scope,
      clientId: String(payload.client_id || payload.aud || ""),
    };
  } catch (error) {
    if (error instanceof OpenAiCompatError) throw error;
    throw new OpenAiCompatError(401, "Invalid API key or access token", {
      code: "invalid_api_key",
    });
  }
}

function contentToText(
  content: OpenAiMessage["content"],
): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      if (typeof part.text === "string") return part.text;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

/** Flatten OpenAI messages into a single prompt for provider clients. */
export function flattenOpenAiMessages(messages: OpenAiMessage[]): string {
  if (!Array.isArray(messages) || !messages.length) {
    throw new OpenAiCompatError(400, "messages must be a non-empty array");
  }
  const systems: string[] = [];
  const turns: string[] = [];
  for (const msg of messages) {
    const text = contentToText(msg.content).trim();
    if (!text) continue;
    const role = (msg.role || "user").toLowerCase();
    if (role === "system" || role === "developer") {
      systems.push(text);
    } else if (role === "assistant") {
      turns.push(`Assistant: ${text}`);
    } else if (role === "tool" || role === "function") {
      turns.push(`Tool${msg.name ? ` (${msg.name})` : ""}: ${text}`);
    } else {
      turns.push(`User: ${text}`);
    }
  }
  if (!turns.length && !systems.length) {
    throw new OpenAiCompatError(400, "messages contained no text content");
  }
  // Single user message with optional system — keep it simple for providers.
  if (turns.length === 1 && turns[0].startsWith("User: ") && !systems.length) {
    return turns[0].slice("User: ".length);
  }
  const body = turns.join("\n\n");
  if (systems.length) {
    return `System:\n${systems.join("\n\n")}\n\n${body}`.trim();
  }
  return body;
}

export function parseModelRef(
  model: string,
  hintProvider?: string | null,
): { provider: ProviderId; model: string } {
  const raw = (model || "").trim();
  if (!raw) {
    throw new OpenAiCompatError(400, "model is required");
  }
  const hint = (hintProvider || "").trim().toLowerCase();
  if (hint && PROVIDER_IDS.has(hint as ProviderId)) {
    // Allow "gpt-x" with X-Failure-Provider, or "codex/gpt-x" still wins on slash.
    if (!raw.includes("/") && !raw.includes(":")) {
      return { provider: hint as ProviderId, model: raw };
    }
  }
  const slash = raw.indexOf("/");
  const colon = raw.indexOf(":");
  let providerPart = "";
  let modelPart = raw;
  if (slash > 0) {
    providerPart = raw.slice(0, slash).toLowerCase();
    modelPart = raw.slice(slash + 1);
  } else if (colon > 0) {
    providerPart = raw.slice(0, colon).toLowerCase();
    modelPart = raw.slice(colon + 1);
  }
  if (providerPart && PROVIDER_IDS.has(providerPart as ProviderId)) {
    if (!modelPart) {
      throw new OpenAiCompatError(400, `model id "${raw}" is missing the model name`);
    }
    return { provider: providerPart as ProviderId, model: modelPart };
  }
  throw new OpenAiCompatError(
    400,
    `Unknown model "${raw}". Use provider/model (e.g. codex/gpt-5.6-sol, kimi/kimi-for-coding).`,
    { code: "model_not_found" },
  );
}

export function mapThinkingLevel(
  body: OpenAiChatRequest,
): ThinkingLevel | undefined {
  const effort =
    (typeof body.reasoning_effort === "string" && body.reasoning_effort) ||
    (typeof body.thinking === "string" && body.thinking) ||
    (body.thinking &&
    typeof body.thinking === "object" &&
    body.thinking.type === "enabled"
      ? "medium"
      : undefined);
  if (!effort) return undefined;
  const normalized = effort.toLowerCase();
  const allowed: ThinkingLevel[] = [
    "none",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
  ];
  if (allowed.includes(normalized as ThinkingLevel)) {
    return normalized as ThinkingLevel;
  }
  if (normalized === "max" || normalized === "xhigh") return "xhigh";
  return "medium";
}

export function encodeModelId(provider: ProviderId, modelId: string) {
  return `${provider}/${modelId}`;
}

export async function listOpenAiModels(userId: string) {
  const connections = (await db.listConnections(userId)).filter(
    (c) => c.status === "connected",
  );
  const data: Array<{
    id: string;
    object: "model";
    created: number;
    owned_by: string;
  }> = [];
  const created = Math.floor(Date.now() / 1000);
  for (const conn of connections) {
    const provider = conn.provider as ProviderId;
    try {
      const listed = await listProviderModels({ provider, connection: conn });
      for (const model of listed.models) {
        if (model.kind === "image") continue;
        data.push({
          id: encodeModelId(provider, model.id),
          object: "model",
          created,
          owned_by: provider,
        });
      }
    } catch {
      // Skip providers that fail catalog fetch; user can still try chat with an explicit id.
    }
  }
  return { object: "list" as const, data };
}

export async function runOpenAiChat(input: {
  userId: string;
  model: string;
  messages: OpenAiMessage[];
  providerHint?: string | null;
  thinkingLevel?: ThinkingLevel;
}) {
  const { provider, model } = parseModelRef(input.model, input.providerHint);
  const conn = await db.getConnection(input.userId, provider);
  if (!conn || conn.status !== "connected") {
    throw new OpenAiCompatError(
      400,
      `Provider "${provider}" is not connected for this user.`,
      { code: "provider_not_connected" },
    );
  }
  const prompt = flattenOpenAiMessages(input.messages);
  const result = await runProviderChat({
    provider,
    connection: conn,
    prompt,
    model,
    thinkingLevel: input.thinkingLevel,
    includeThinking: true,
  });
  return {
    provider,
    modelUsed: result.model || model,
    modelRef: encodeModelId(provider, result.model || model),
    text: result.text || "",
    warning: "warning" in result ? result.warning : undefined,
  };
}

export function openAiChatCompletionObject(input: {
  modelRef: string;
  text: string;
  id?: string;
  created?: number;
}) {
  const id = input.id || `chatcmpl_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
  const created = input.created || Math.floor(Date.now() / 1000);
  return {
    id,
    object: "chat.completion",
    created,
    model: input.modelRef,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: input.text,
        },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    },
  };
}

/** Emit a minimal OpenAI SSE stream from a completed reply (providers are non-stream here). */
export function openAiChatCompletionStream(input: {
  modelRef: string;
  text: string;
}) {
  const id = `chatcmpl_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
  const created = Math.floor(Date.now() / 1000);
  const chunk = (delta: Record<string, unknown>, finish: string | null) =>
    `data: ${JSON.stringify({
      id,
      object: "chat.completion.chunk",
      created,
      model: input.modelRef,
      choices: [
        {
          index: 0,
          delta,
          finish_reason: finish,
        },
      ],
    })}\n\n`;

  const body =
    chunk({ role: "assistant", content: "" }, null) +
    chunk({ content: input.text }, null) +
    chunk({}, "stop") +
    "data: [DONE]\n\n";

  return new Response(body, {
    status: 200,
    headers: {
      ...corsHeaders(),
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
