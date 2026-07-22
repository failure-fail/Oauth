"use client";

import { FormEvent, useMemo, useState } from "react";
import { PROVIDERS, type ProviderId } from "@/lib/providers-meta";

type Connection = {
  provider: ProviderId;
  status: string;
  label?: string;
};

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
  const [prompt, setPrompt] = useState("Say hello in one short sentence.");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "system",
      text: connected.length
        ? "Pick a connected provider and send a test prompt."
        : "No providers connected yet. Link one under Providers, then come back.",
    },
  ]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!provider || !prompt.trim() || busy) return;
    setBusy(true);
    setError(null);
    const userMsg: Message = {
      id: `u-${Date.now()}`,
      role: "user",
      text: prompt.trim(),
      provider,
    };
    setMessages((m) => [...m, userMsg]);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, prompt: prompt.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Chat failed");
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
            onChange={(e) => setProvider(e.target.value as ProviderId)}
            disabled={!connected.length}
          >
            {!connected.length && <option value="">No providers connected</option>}
            {connected.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <p className="muted">
          {connected.length
            ? `${connected.length} connected — replies use your linked credentials.`
            : "Connect Codex, ChatGPT, Claude, Grok, or Cursor first."}
        </p>
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
          disabled={!connected.length || busy || !provider || !prompt.trim()}
        >
          {busy ? "Sending…" : "Send test"}
        </button>
      </form>
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}
