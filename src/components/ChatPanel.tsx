"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { PROVIDERS, type ProviderId } from "@/lib/providers-meta";

type Connection = {
  provider: ProviderId;
  status: string;
  label?: string;
};

type ThinkingLevel =
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

type ProviderModel = {
  id: string;
  name?: string;
  kind?: "chat" | "image";
  reasoningLevels?: ThinkingLevel[];
  defaultReasoningLevel?: ThinkingLevel;
  supportsReasoningSummaries?: boolean;
};

type ThinkBlock = {
  type: "reasoning" | "thinking" | string;
  id?: string;
  summary?: string;
  content?: string;
  encryptedContent?: string;
  hasEncryptedContent?: boolean;
  signature?: string;
};

type Message = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  provider?: ProviderId;
  model?: string;
  thinkingLevel?: ThinkingLevel;
  thinkingSummary?: string;
  thinkBlocks?: ThinkBlock[];
  images?: string[];
};

export function ChatPanel({
  initialConnections,
}: {
  initialConnections: Connection[];
}) {
  const connected = useMemo(
    () =>
      PROVIDERS.filter((p) =>
        initialConnections.some(
          (c) => c.provider === p.id && c.status === "connected",
        ),
      ),
    [initialConnections],
  );

  const [provider, setProvider] = useState<ProviderId | "">(
    connected[0]?.id || "",
  );
  const [models, setModels] = useState<ProviderModel[]>([]);
  const [model, setModel] = useState("");
  const [modelsFor, setModelsFor] = useState<ProviderId | "">("");
  const [modelsMeta, setModelsMeta] = useState<string | null>(null);
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>("medium");
  const [prompt, setPrompt] = useState("Say hello in one short sentence.");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [editImages, setEditImages] = useState<string[]>([]);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "system",
      text: connected.length
        ? "Choose a provider and model. Codex, Antigravity, and Claude support thinking levels and think blocks."
        : "Connect a provider first, then come back to test live models.",
    },
  ]);

  const loadingModels = Boolean(provider) && modelsFor !== provider;
  const selectedModel = models.find((m) => m.id === model);
  const isImageModel =
    selectedModel?.kind === "image" || model === "gpt-image-2";
  const supportsImages = provider === "codex";
  const supportsThinking =
    !isImageModel &&
    (provider === "codex" ||
      provider === "antigravity" ||
      provider === "claude" ||
      provider === "mimo") &&
    Boolean(
      selectedModel?.reasoningLevels?.length ||
        provider === "claude" ||
        provider === "antigravity" ||
        provider === "mimo",
    );

  const thinkingOptions = selectedModel?.reasoningLevels?.length
    ? selectedModel.reasoningLevels
    : provider === "claude" ||
        provider === "antigravity" ||
        provider === "mimo"
      ? (["none", "low", "medium", "high"] as ThinkingLevel[])
      : (["low", "medium", "high", "xhigh"] as ThinkingLevel[]);

  useEffect(() => {
    if (!provider) return;
    let cancelled = false;
    const providerId = provider;

    fetch(`/api/chat/models?provider=${encodeURIComponent(providerId)}`)
      .then(async (res) => {
        const raw = await res.text();
        let data: {
          error?: string;
          models?: ProviderModel[];
          warning?: string;
          source?: string;
          transport?: string;
        } = {};
        try {
          data = raw.trim() ? (JSON.parse(raw) as typeof data) : {};
        } catch {
          throw new Error(
            res.ok
              ? `Models response was not JSON: ${raw.slice(0, 160)}`
              : `Models request failed (${res.status}): ${raw.slice(0, 160)}`,
          );
        }
        if (cancelled) return;
        if (!res.ok) throw new Error(data.error || "Failed to fetch models");
        const next = (data.models || []) as ProviderModel[];
        setModels(next);
        const first = next[0];
        setModel(first?.id || "");
        setThinkingLevel(first?.defaultReasoningLevel || "medium");
        setModelsFor(providerId);
        setError(null);
        setWarning(data.warning || null);
        setModelsMeta(
          next.length
            ? `${next.length} models · ${data.source || "live"}${data.transport ? `/${data.transport}` : ""}`
            : data.source === "error"
              ? "Catalog fetch failed"
              : "No models",
        );
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setModels([]);
        setModel("");
        setModelsFor(providerId);
        setModelsMeta(null);
        setError(err instanceof Error ? err.message : "Failed to fetch models");
      });

    return () => {
      cancelled = true;
    };
  }, [provider]);

  function selectModel(nextId: string) {
    setModel(nextId);
    setEditImages([]);
    const next = models.find((m) => m.id === nextId);
    if (next?.kind === "image" || nextId === "gpt-image-2") {
      setPrompt("A crisp product photo of a ceramic mug on oak");
    }
    if (
      next?.defaultReasoningLevel &&
      next.reasoningLevels?.includes(next.defaultReasoningLevel)
    ) {
      setThinkingLevel(next.defaultReasoningLevel);
    } else if (next?.reasoningLevels?.length) {
      setThinkingLevel(next.reasoningLevels[0]);
    }
  }

  async function refreshModels() {
    if (!provider) return;
    setModelsFor("");
    setError(null);
    try {
      const res = await fetch(
        `/api/chat/models?provider=${encodeURIComponent(provider)}`,
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to fetch models");
      const next = (data.models || []) as ProviderModel[];
      setModels(next);
      setModel((current) =>
        next.some((m) => m.id === current) ? current : next[0]?.id || "",
      );
      setModelsFor(provider);
      setWarning(data.warning || null);
      setModelsMeta(
        next.length
          ? `${next.length} models · ${data.source || "live"}${data.transport ? `/${data.transport}` : ""}`
          : "No models",
      );
    } catch (err) {
      setModelsFor(provider);
      setError(err instanceof Error ? err.message : "Failed to fetch models");
    }
  }

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    const urls: string[] = [];
    for (const file of Array.from(files).slice(0, 5)) {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = "";
      for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      }
      urls.push(`data:${file.type || "image/png"};base64,${btoa(binary)}`);
    }
    setEditImages(urls);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!provider || !prompt.trim() || !model || busy) return;
    setBusy(true);
    setError(null);
    const userMsg: Message = {
      id: `u-${Date.now()}`,
      role: "user",
      text: prompt.trim(),
      provider,
      model,
      images: isImageModel && editImages.length ? editImages : undefined,
    };
    setMessages((m) => [...m, userMsg]);
    try {
      if (isImageModel && supportsImages) {
        const res = await fetch("/api/images", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            editImages.length
              ? {
                  action: "edit",
                  provider,
                  prompt: prompt.trim(),
                  images: editImages.map((dataUrl) => ({ dataUrl })),
                }
              : {
                  action: "generate",
                  provider,
                  prompt: prompt.trim(),
                },
          ),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Image request failed");
        const images = (data.images || [])
          .map((img: { b64_json?: string }) => img.b64_json)
          .filter(Boolean)
          .map((b64: string) => `data:image/png;base64,${b64}`);
        setMessages((m) => [
          ...m,
          {
            id: `a-${Date.now()}`,
            role: "assistant",
            text: images.length
              ? `Generated ${images.length} image(s) with ${data.model}.`
              : "(empty image response)",
            provider,
            model: data.model,
            images,
          },
        ]);
      } else {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider,
            prompt: prompt.trim(),
            model,
            thinkingLevel: supportsThinking ? thinkingLevel : undefined,
            includeThinking: true,
          }),
        });
        const raw = await res.text();
        let data: {
          error?: string;
          models?: ProviderModel[];
          warning?: string;
          text?: string;
          model?: string;
          thinking?: {
            level?: ThinkingLevel;
            summary?: string;
            blocks?: ThinkBlock[];
          };
        };
        try {
          data = raw.trim() ? (JSON.parse(raw) as typeof data) : {};
        } catch {
          throw new Error(
            `Chat failed (${res.status}): ${raw.slice(0, 160) || "non-JSON response"}`,
          );
        }
        if (!res.ok) throw new Error(data.error || "Chat failed");
        if (Array.isArray(data.models) && data.models.length) {
          setModels(data.models);
          setModelsFor(provider);
        }
        if (data.warning) setWarning(data.warning);
        setMessages((m) => [
          ...m,
          {
            id: `a-${Date.now()}`,
            role: "assistant",
            text: data.text || "(empty response)",
            provider,
            model: data.model,
            thinkingLevel: data.thinking?.level,
            thinkingSummary: data.thinking?.summary,
            thinkBlocks: Array.isArray(data.thinking?.blocks)
              ? data.thinking.blocks
              : undefined,
          },
        ]);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Request failed";
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="chat-shell">
      <div
        className={`chat-toolbar ${supportsThinking ? "has-thinking" : ""}`}
      >
        <label>
          <span>Provider</span>
          <select
            value={provider}
            onChange={(e) => {
              setProvider(e.target.value as ProviderId);
              setModelsFor("");
              setModels([]);
              setModel("");
              setModelsMeta(null);
              setEditImages([]);
            }}
            disabled={!connected.length}
          >
            {!connected.length && (
              <option value="">No providers connected</option>
            )}
            {connected.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Model {loadingModels ? "· fetching" : "· live"}</span>
          <select
            value={model}
            onChange={(e) => selectModel(e.target.value)}
            disabled={!models.length || loadingModels}
          >
            {!models.length && (
              <option value="">
                {loadingModels ? "Loading models…" : "No models"}
              </option>
            )}
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.kind === "image" ? "[image] " : ""}
                {m.name && m.name !== m.id ? `${m.name} (${m.id})` : m.id}
              </option>
            ))}
          </select>
        </label>
        {supportsThinking ? (
          <label>
            <span>Thinking</span>
            <select
              value={thinkingLevel}
              onChange={(e) =>
                setThinkingLevel(e.target.value as ThinkingLevel)
              }
              disabled={busy}
            >
              {thinkingOptions.map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <div className="chat-toolbar__spacer" aria-hidden />
        )}
        <button
          type="button"
          className="btn-secondary"
          onClick={refreshModels}
          disabled={!provider || loadingModels}
        >
          Refresh
        </button>
      </div>

      {modelsMeta && <p className="chat-meta muted">{modelsMeta}</p>}

      <div className="chat-log" aria-live="polite">
        {messages.map((msg) => (
          <article
            key={msg.id}
            className={`chat-bubble chat-bubble--${msg.role}`}
          >
            <header>
              {msg.role === "user"
                ? "You"
                : msg.role === "assistant"
                  ? msg.provider || "Assistant"
                  : "System"}
              {msg.model ? <span>· {msg.model}</span> : null}
              {msg.thinkingLevel ? (
                <span>· think:{msg.thinkingLevel}</span>
              ) : null}
            </header>
            {msg.thinkBlocks?.length ? (
              msg.thinkBlocks.map((block, idx) => {
                const body =
                  block.summary ||
                  block.content ||
                  (block.hasEncryptedContent || block.encryptedContent
                    ? "(encrypted reasoning item — usable for multi-turn continuity)"
                    : "");
                if (!body) return null;
                return (
                  <details
                    key={`${msg.id}-think-${block.id || idx}`}
                    className="think-block"
                    open={idx === 0}
                  >
                    <summary>
                      Think block
                      {block.type ? ` · ${block.type}` : ""}
                      {block.hasEncryptedContent || block.encryptedContent
                        ? " · encrypted"
                        : ""}
                    </summary>
                    <pre>{body}</pre>
                  </details>
                );
              })
            ) : msg.thinkingSummary ? (
              <details className="think-block" open>
                <summary>Thinking</summary>
                <pre>{msg.thinkingSummary}</pre>
              </details>
            ) : null}
            <p>{msg.text}</p>
            {msg.images?.length ? (
              <div className="chat-images">
                {msg.images.map((src) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={src.slice(0, 64)} src={src} alt="Generated" />
                ))}
              </div>
            ) : null}
          </article>
        ))}
      </div>

      <form className="chat-compose" onSubmit={onSubmit}>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          placeholder={
            isImageModel
              ? "Describe the image to generate or edit…"
              : "Type a test prompt…"
          }
          disabled={!connected.length || busy}
        />
        {isImageModel && supportsImages ? (
          <label className="chat-image-input">
            <span>Optional reference images for edit (up to 5)</span>
            <div className="file-pill">
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => onFiles(e.target.files)}
                disabled={busy}
              />
              <em>
                {editImages.length
                  ? `${editImages.length} reference image(s) attached`
                  : "Choose images"}
              </em>
            </div>
          </label>
        ) : null}
        <button
          className="btn-primary"
          type="submit"
          disabled={
            !connected.length ||
            busy ||
            loadingModels ||
            !provider ||
            !model ||
            !prompt.trim()
          }
        >
          {busy
            ? isImageModel
              ? "Generating…"
              : "Sending…"
            : isImageModel
              ? editImages.length
                ? "Edit image"
                : "Generate image"
              : "Send"}
        </button>
      </form>
      {warning && <p className="notice">{warning}</p>}
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}
