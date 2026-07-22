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

type Message = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  provider?: ProviderId;
  model?: string;
  thinkingSummary?: string;
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
        ? "Choose a provider and model. Codex/ChatGPT support thinking levels and GPT Image 2."
        : "Connect a provider first, then come back to test live models.",
    },
  ]);

  const loadingModels = Boolean(provider) && modelsFor !== provider;
  const selectedModel = models.find((m) => m.id === model);
  const isImageModel =
    selectedModel?.kind === "image" || model === "gpt-image-2";
  const supportsImages = provider === "codex" || provider === "chatgpt";
  const supportsThinking =
    supportsImages &&
    !isImageModel &&
    Boolean(selectedModel?.reasoningLevels?.length);

  const thinkingOptions =
    selectedModel?.reasoningLevels?.length
      ? selectedModel.reasoningLevels
      : (["low", "medium", "high", "xhigh"] as ThinkingLevel[]);

  useEffect(() => {
    if (!provider) return;
    let cancelled = false;
    const providerId = provider;

    fetch(`/api/chat/models?provider=${encodeURIComponent(providerId)}`)
      .then(async (res) => {
        const data = await res.json();
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
        setMessages((m) => [
          ...m,
          {
            id: `models-${Date.now()}`,
            role: "system",
            text: next.length
              ? `Loaded ${next.length} live models from ${providerId}${data.source ? ` · ${data.source}` : ""}${data.transport ? `/${data.transport}` : ""}.`
              : `No live models from ${providerId}${data.source === "error" ? " (catalog fetch failed — nothing guessed)" : ""}.`,
            provider: providerId,
          },
        ]);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setModels([]);
        setModel("");
        setModelsFor(providerId);
        setError(err instanceof Error ? err.message : "Failed to fetch models");
      });

    return () => {
      cancelled = true;
    };
  }, [provider]);

  useEffect(() => {
    if (!selectedModel) return;
    if (
      selectedModel.defaultReasoningLevel &&
      selectedModel.reasoningLevels?.includes(selectedModel.defaultReasoningLevel)
    ) {
      setThinkingLevel(selectedModel.defaultReasoningLevel);
    } else if (selectedModel.reasoningLevels?.length) {
      setThinkingLevel(selectedModel.reasoningLevels[0]);
    }
  }, [selectedModel?.id]);

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
        const data = await res.json();
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
            thinkingSummary: data.thinking?.summary,
          },
        ]);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Request failed";
      setError(message);
      setMessages((m) => [
        ...m,
        {
          id: `e-${Date.now()}`,
          role: "system",
          text: message,
          provider,
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="chat-shell">
      <div className="chat-toolbar">
        <label>
          <span>Provider</span>
          <select
            value={provider}
            onChange={(e) => {
              setProvider(e.target.value as ProviderId);
              setModelsFor("");
              setModels([]);
              setModel("");
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
            onChange={(e) => {
              setModel(e.target.value);
              setEditImages([]);
              const next = models.find((m) => m.id === e.target.value);
              if (next?.kind === "image" || e.target.value === "gpt-image-2") {
                setPrompt("A crisp product photo of a ceramic mug on oak");
              }
            }}
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
        ) : null}
        <button
          type="button"
          className="btn-secondary"
          onClick={refreshModels}
          disabled={!provider || loadingModels}
        >
          Refresh
        </button>
      </div>

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
            </header>
            {msg.thinkingSummary ? (
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
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => onFiles(e.target.files)}
              disabled={busy}
            />
            {editImages.length ? (
              <em>{editImages.length} reference image(s) attached</em>
            ) : null}
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
