"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { PROVIDERS, type ProviderId } from "@/lib/providers-meta";

type Connection = {
  provider: ProviderId;
  status: string;
  label?: string;
};

type ProviderModel = { id: string; name?: string };

type Message = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  provider?: ProviderId;
  model?: string;
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
  const [prompt, setPrompt] = useState("Say hello in one short sentence.");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "system",
      text: connected.length
        ? "Pick a connected provider. Models are fetched live from that provider."
        : "No providers connected yet. Link one under Providers, then come back.",
    },
  ]);

  const loadingModels = Boolean(provider) && modelsFor !== provider;

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
        setModel(next[0]?.id || "");
        setModelsFor(providerId);
        setError(null);
        setMessages((m) => [
          ...m,
          {
            id: `models-${Date.now()}`,
            role: "system",
            text: next.length
              ? `Fetched ${next.length} live models from ${providerId}.`
              : `No models returned by ${providerId}.`,
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
    } catch (err) {
      setModelsFor(provider);
      setError(err instanceof Error ? err.message : "Failed to fetch models");
    }
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
    };
    setMessages((m) => [...m, userMsg]);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          prompt: prompt.trim(),
          model,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Chat failed");
      if (Array.isArray(data.models) && data.models.length) {
        setModels(data.models);
        setModelsFor(provider);
      }
      setMessages((m) => [
        ...m,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          text: data.text || "(empty response)",
          provider,
          model: data.model,
        },
      ]);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Chat failed";
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
          <span>Model {loadingModels ? "(fetching live…)" : "(live)"}</span>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            disabled={!models.length || loadingModels}
          >
            {!models.length && (
              <option value="">
                {loadingModels ? "Loading models…" : "No models"}
              </option>
            )}
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name && m.name !== m.id ? `${m.name} (${m.id})` : m.id}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn-secondary"
          onClick={refreshModels}
          disabled={!provider || loadingModels}
        >
          Refresh models
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
            <p>{msg.text}</p>
          </article>
        ))}
      </div>

      <form className="chat-compose" onSubmit={onSubmit}>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          placeholder="Type a test prompt…"
          disabled={!connected.length || busy}
        />
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
          {busy ? "Sending…" : "Send test"}
        </button>
      </form>
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}
