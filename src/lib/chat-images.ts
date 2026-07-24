/**
 * OpenAI multimodal image_url helpers for /v1 chat.completions.
 *
 * Accepts:
 *   { type: "image_url", image_url: { url: "https://..." | "data:image/...", detail?: "auto"|"low"|"high" } }
 *   { type: "image_url", image_url: "https://..." }
 */

export type ChatImageDetail = "auto" | "low" | "high";

export type ChatImage = {
  url: string;
  detail?: ChatImageDetail;
};

const MAX_IMAGES = 16;

export function isLikelyImageUrl(url: string): boolean {
  const value = url.trim();
  if (!value) return false;
  if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(value)) return true;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

export function normalizeChatImage(
  raw: unknown,
): ChatImage | null {
  if (!raw || typeof raw !== "object") return null;
  const part = raw as Record<string, unknown>;
  const type = typeof part.type === "string" ? part.type.toLowerCase() : "";
  if (type && type !== "image_url") return null;

  let url = "";
  let detail: ChatImageDetail | undefined;
  const imageUrl = part.image_url;
  if (typeof imageUrl === "string") {
    url = imageUrl.trim();
  } else if (imageUrl && typeof imageUrl === "object") {
    const obj = imageUrl as Record<string, unknown>;
    if (typeof obj.url === "string") url = obj.url.trim();
    if (
      obj.detail === "auto" ||
      obj.detail === "low" ||
      obj.detail === "high"
    ) {
      detail = obj.detail;
    }
  }
  if (!isLikelyImageUrl(url)) return null;
  return detail ? { url, detail } : { url };
}

/** OpenAI chat.completions user content parts (text + image_url). */
export function toOpenAiUserContent(
  prompt: string,
  images?: ChatImage[],
): string | Array<Record<string, unknown>> {
  if (!images?.length) return prompt;
  const parts: Array<Record<string, unknown>> = [];
  if (prompt.trim()) {
    parts.push({ type: "text", text: prompt });
  }
  for (const image of images) {
    parts.push({
      type: "image_url",
      image_url: image.detail
        ? { url: image.url, detail: image.detail }
        : { url: image.url },
    });
  }
  return parts;
}

/** Codex Responses API message content (input_text + input_image). */
export function toCodexUserContent(
  prompt: string,
  images?: ChatImage[],
): Array<Record<string, unknown>> {
  const parts: Array<Record<string, unknown>> = [];
  if (prompt.trim() || !images?.length) {
    parts.push({ type: "input_text", text: prompt || "" });
  }
  for (const image of images || []) {
    parts.push({
      type: "input_image",
      image_url: image.url,
      detail: image.detail || "auto",
    });
  }
  return parts;
}

/** Anthropic Messages API content blocks. */
export function toClaudeUserContent(
  prompt: string,
  images?: ChatImage[],
): string | Array<Record<string, unknown>> {
  if (!images?.length) return prompt;
  const parts: Array<Record<string, unknown>> = [];
  for (const image of images) {
    if (image.url.startsWith("data:image/")) {
      const match = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(image.url);
      if (!match) {
        throw new Error("Invalid data:image URL for Claude vision");
      }
      parts.push({
        type: "image",
        source: {
          type: "base64",
          media_type: match[1].toLowerCase(),
          data: match[2],
        },
      });
    } else {
      parts.push({
        type: "image",
        source: { type: "url", url: image.url },
      });
    }
  }
  if (prompt.trim()) {
    parts.push({ type: "text", text: prompt });
  }
  return parts;
}

export function assertImageLimit(images: ChatImage[]) {
  if (images.length > MAX_IMAGES) {
    throw new Error(
      `Too many images (${images.length}). Maximum is ${MAX_IMAGES}.`,
    );
  }
}
