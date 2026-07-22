import { createHash, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, createDecipheriv, randomBytes } from "crypto";
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

/** Same flow as MiMo Code CLI (`plugin/mimo.ts`). */
export const MIMO_OAUTH = {
  platformUrl: MIMO_API.platformUrl,
  kn: "mimocode",
};

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
    "X-Mimo-Source": "failure-ai-oauth",
  };
}

export function generateMimoOAuthKeyPair(): {
  publicKey: string;
  privateKeyDerBase64: string;
} {
  const keyPair = generateKeyPairSync("x25519", {
    publicKeyEncoding: { type: "spki", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "der" },
  });
  return {
    publicKey: Buffer.from(keyPair.publicKey).toString("base64url"),
    privateKeyDerBase64: Buffer.from(keyPair.privateKey).toString("base64"),
  };
}

export function buildMimoAuthorizeUrl(input: {
  publicKey: string;
  keyName: string;
  /** Manual paste flow uses the platform code callback. */
  manual?: boolean;
}): string {
  const redirectUri = input.manual
    ? `${MIMO_OAUTH.platformUrl}/authorize/code/callback`
    : `${MIMO_OAUTH.platformUrl}/authorize/code/callback`;
  const params = new URLSearchParams({
    pk: input.publicKey,
    redirect_uri: redirectUri,
    kn: MIMO_OAUTH.kn,
    key_name: input.keyName,
  });
  return `${MIMO_OAUTH.platformUrl}/authorize?${params.toString()}`;
}

export function newMimoKeyName(): string {
  return `failure-oauth-key-${randomBytes(4).toString("hex")}`;
}

/**
 * Decrypt the `u` / paste code from Xiaomi MiMo platform OAuth.
 * Format: ephemeralPublicKey(32) + nonce(12) + ciphertext + tag(16)
 */
export function decryptMimoOAuthPayload(
  privateKeyDerBase64: string,
  encryptedBase64Url: string,
): { sk?: string; uid: string; url?: string } {
  const encrypted = Buffer.from(encryptedBase64Url.trim(), "base64url");
  if (encrypted.length < 32 + 12 + 16) {
    throw new Error("MiMo OAuth code looks truncated or invalid");
  }
  const ephemeralPub = encrypted.subarray(0, 32);
  const nonce = encrypted.subarray(32, 44);
  const ciphertextAndTag = encrypted.subarray(44);
  const tag = ciphertextAndTag.subarray(ciphertextAndTag.length - 16);
  const ciphertext = ciphertextAndTag.subarray(0, ciphertextAndTag.length - 16);

  const privateKey = createPrivateKey({
    key: Buffer.from(privateKeyDerBase64, "base64"),
    format: "der",
    type: "pkcs8",
  });
  const ephemeralPublicKey = createPublicKey({
    key: Buffer.concat([
      Buffer.from("302a300506032b656e032100", "hex"),
      ephemeralPub,
    ]),
    format: "der",
    type: "spki",
  });

  const sharedSecret = diffieHellman({ privateKey, publicKey: ephemeralPublicKey });
  const derivedKey = createHash("sha256").update(sharedSecret).digest();
  const decipher = createDecipheriv("aes-256-gcm", derivedKey, nonce);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(decrypted.toString("utf-8")) as {
    sk?: string;
    uid: string;
    url?: string;
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
        content: "You are MiMo, an AI assistant developed by Xiaomi.",
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
    authorize: `${MIMO_OAUTH.platformUrl}/authorize`,
  };
}
