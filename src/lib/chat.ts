import type { ProviderId } from "./config";
import { readProviderSecret, type StoredProviderSecret } from "./providers";

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const json = Buffer.from(part, "base64url").toString("utf8");
    return JSON.parse(json) as Record<string, unknown>;
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
      if (typeof json.delta === "string") chunks.push(json.delta);
      const outputText = json.output_text;
      if (typeof outputText === "string") chunks.push(outputText);
      const choices = json.choices as Array<{ delta?: { content?: string }; message?: { content?: string } }> | undefined;
      if (choices?.[0]?.delta?.content) chunks.push(choices[0].delta.content);
      if (choices?.[0]?.message?.content) chunks.push(choices[0].message.content);
      // Codex responses SSE shapes
      if (json.type === "response.output_text.delta" && typeof json.delta === "string") {
        chunks.push(json.delta);
      }
      if (json.type === "response.completed") {
        const response = json.response as { output_text?: string } | undefined;
        if (response?.output_text) chunks.push(response.output_text);
      }
    } catch {
      // ignore non-json frames
    }
  }
  return chunks.join("") || raw.slice(0, 2000);
}

async function chatCodexLike(
  secret: StoredProviderSecret,
  prompt: string,
  label: string,
) {
  const token = secret.accessToken;
  if (!token) throw new Error(`${label} access token missing`);
  const accountId = chatgptAccountId(token);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "text/event-stream",
    "OpenAI-Beta": "responses=experimental",
    originator: "codex_cli_rs",
  };
  if (accountId) headers["ChatGPT-Account-Id"] = accountId;

  const body = {
    model: "gpt-5.4-mini",
    instructions: "You are a helpful assistant used to test Failure AI OAuth.",
    input: prompt,
    store: false,
    stream: true,
  };

  const res = await fetch("https://chatgpt.com/backend-api/codex/responses", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    // fallback model
    const retry = await fetch("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      headers,
      body: JSON.stringify({ ...body, model: "gpt-5" }),
    });
    if (!retry.ok) {
      const text = await res.text();
      throw new Error(`${label} chat failed: ${res.status} ${text.slice(0, 400)}`);
    }
    const text = await readSseText(retry);
    return { text, model: "gpt-5", providerLabel: label };
  }
  const text = await readSseText(res);
  return { text, model: "gpt-5.4-mini", providerLabel: label };
}

async function chatClaude(secret: StoredProviderSecret, prompt: string) {
  const token = secret.setupToken || secret.accessToken;
  if (!token) throw new Error("Claude token missing");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "oauth-2025-04-20",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 512,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Claude chat failed: ${res.status} ${text.slice(0, 400)}`);
  }
  const json = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
    model?: string;
  };
  const text = (json.content || [])
    .filter((c) => c.type === "text" && c.text)
    .map((c) => c.text)
    .join("\n");
  return { text: text || JSON.stringify(json).slice(0, 1000), model: json.model || "claude", providerLabel: "Claude Code" };
}

async function chatGrok(secret: StoredProviderSecret, prompt: string) {
  const token = secret.accessToken;
  if (!token) throw new Error("Grok access token missing");
  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "grok-4",
      messages: [
        { role: "system", content: "You are a helpful assistant used to test Failure AI OAuth." },
        { role: "user", content: prompt },
      ],
      max_tokens: 512,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Grok chat failed: ${res.status} ${text.slice(0, 400)}`);
  }
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    model?: string;
  };
  return {
    text: json.choices?.[0]?.message?.content || JSON.stringify(json).slice(0, 1000),
    model: json.model || "grok-4",
    providerLabel: "Grok Build",
  };
}

async function chatCursor(secret: StoredProviderSecret, prompt: string) {
  const key = secret.accountKey || secret.accessToken;
  if (!key) throw new Error("Cursor account key missing");
  const me = await fetch("https://api.cursor.com/v1/me", {
    headers: {
      Authorization: `Bearer ${key}`,
    },
  });
  if (!me.ok) {
    // try basic auth style used by Cursor docs
    const basic = Buffer.from(`${key}:`).toString("base64");
    const meBasic = await fetch("https://api.cursor.com/v1/me", {
      headers: { Authorization: `Basic ${basic}` },
    });
    if (!meBasic.ok) {
      const text = await me.text();
      throw new Error(`Cursor key check failed: ${me.status} ${text.slice(0, 400)}`);
    }
    const info = await meBasic.json();
    return {
      text: `Cursor account key is valid.\n\nKey info: ${JSON.stringify(info, null, 2)}\n\nPrompt received: ${prompt}\n\nNote: Cursor user API keys authenticate Cloud Agents / CLI, not a public chat-completions API.`,
      model: "cursor-api-key",
      providerLabel: "Cursor",
    };
  }
  const info = await me.json();
  return {
    text: `Cursor account key is valid.\n\nKey info: ${JSON.stringify(info, null, 2)}\n\nPrompt received: ${prompt}\n\nNote: Cursor user API keys authenticate Cloud Agents / CLI, not a public chat-completions API.`,
    model: "cursor-api-key",
    providerLabel: "Cursor",
  };
}

export async function runProviderChat(input: {
  provider: ProviderId;
  encryptedPayload: string;
  prompt: string;
}) {
  const secret = readProviderSecret(input.encryptedPayload);
  switch (input.provider) {
    case "codex":
      return chatCodexLike(secret, input.prompt, "Codex");
    case "chatgpt":
      return chatCodexLike(secret, input.prompt, "ChatGPT");
    case "claude":
      return chatClaude(secret, input.prompt);
    case "grok":
      return chatGrok(secret, input.prompt);
    case "cursor":
      return chatCursor(secret, input.prompt);
    default:
      throw new Error("Unsupported provider");
  }
}
