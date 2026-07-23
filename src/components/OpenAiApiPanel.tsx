"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { ProviderId } from "@/lib/providers-meta";
import { PROVIDERS } from "@/lib/providers-meta";

type Connection = {
  provider: ProviderId;
  status: string;
  label?: string;
};

type KeyRow = {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt?: string | null;
};

const EXAMPLE_MODELS: Partial<Record<ProviderId, string>> = {
  codex: "gpt-5.6-sol",
  copilot: "gpt-4.1",
  claude: "claude-sonnet-4-20250514",
  kimi: "kimi-for-coding",
  mimo: "mimo-v2.5-pro",
  grok: "grok-4",
  antigravity: "gemini-2.5-pro",
};

export function OpenAiApiPanel({
  baseUrl,
  connections,
}: {
  baseUrl: string;
  connections: Connection[];
}) {
  const v1 = `${baseUrl.replace(/\/$/, "")}/v1`;
  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [freshKey, setFreshKey] = useState<string | null>(null);
  const [keyName, setKeyName] = useState("Default");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const linked = useMemo(
    () =>
      PROVIDERS.filter((p) =>
        connections.some((c) => c.provider === p.id && c.status === "connected"),
      ),
    [connections],
  );

  const sampleModel =
    linked.length > 0
      ? `${linked[0].id}/${EXAMPLE_MODELS[linked[0].id] || "default"}`
      : "codex/gpt-5.6-sol";

  const displayKey = freshKey || "<fsk_your_api_key>";

  async function refreshKeys() {
    const res = await fetch("/api/auth/api-keys");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to load keys");
    setKeys(data.keys || []);
  }

  useEffect(() => {
    refreshKeys().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "Failed to load keys");
    });
  }, []);

  async function createKey() {
    setBusy(true);
    setError(null);
    setFreshKey(null);
    try {
      const res = await fetch("/api/auth/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: keyName.trim() || "Default" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create key");
      setFreshKey(data.key);
      await refreshKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create key");
    } finally {
      setBusy(false);
    }
  }

  async function revokeKey(id: string) {
    if (!confirm("Revoke this API key? Apps using it will stop working.")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/auth/api-keys?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to revoke key");
      if (freshKey) setFreshKey(null);
      await refreshKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke key");
    } finally {
      setBusy(false);
    }
  }

  async function copy(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      setError("Clipboard unavailable");
    }
  }

  const envSnippet = `export OPENAI_BASE_URL=${v1}
export OPENAI_API_KEY=${displayKey}`;

  const sdkSnippet = `import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY, // fsk_…
  baseURL: "${v1}",
});

const chat = await client.chat.completions.create({
  model: "${sampleModel}",
  messages: [{ role: "user", content: "Say hello in one sentence." }],
});

console.log(chat.choices[0].message.content);`;

  const curlSnippet = `curl ${v1}/chat/completions \\
  -H "Authorization: Bearer ${displayKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${sampleModel}",
    "messages": [{"role":"user","content":"Hello"}]
  }'`;

  return (
    <div className="openai-panel">
      <section className="openai-panel__card">
        <h2 className="openai-panel__h">Your API key</h2>
        <p className="muted">
          Create a persistent <code>fsk_…</code> key and use it as{" "}
          <code>OPENAI_API_KEY</code> against <code>{v1}</code>. The full key is
          shown once at creation — Failure only stores a hash.
        </p>
        <label className="openai-panel__label">
          <span>Name</span>
          <input
            value={keyName}
            onChange={(e) => setKeyName(e.target.value)}
            placeholder="Default"
            maxLength={80}
            disabled={busy}
          />
        </label>
        <div className="hero-cta">
          <button
            type="button"
            className="btn-primary"
            onClick={createKey}
            disabled={busy}
          >
            {busy ? "Working…" : "Create API key"}
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => copy("base", v1)}
          >
            {copied === "base" ? "Copied" : "Copy base URL"}
          </button>
        </div>
        {freshKey ? (
          <div className="openai-panel__fresh">
            <p className="form-error" style={{ color: "var(--ember)" }}>
              Copy this key now — it won’t be shown again.
            </p>
            <code className="code-block openai-panel__token">{freshKey}</code>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => copy("fresh", freshKey)}
            >
              {copied === "fresh" ? "Copied" : "Copy API key"}
            </button>
          </div>
        ) : null}
        {keys.length ? (
          <ul className="openai-panel__keys">
            {keys.map((k) => (
              <li key={k.id}>
                <div>
                  <strong>{k.name}</strong>
                  <span className="muted">
                    {" "}
                    · {k.prefix}
                    {k.lastUsedAt
                      ? ` · last used ${new Date(k.lastUsedAt).toLocaleString()}`
                      : " · never used"}
                  </span>
                </div>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => revokeKey(k.id)}
                  disabled={busy}
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No API keys yet — create one to get started.</p>
        )}
        {error ? <p className="form-error">{error}</p> : null}
      </section>

      <section className="openai-panel__card">
        <h2 className="openai-panel__h">Your model ids</h2>
        <p className="muted">
          Use <code>provider/model</code>. Only connected providers work.
        </p>
        {linked.length ? (
          <ul className="openai-panel__models">
            {linked.map((p) => {
              const id = `${p.id}/${EXAMPLE_MODELS[p.id] || "…"}`;
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    className="openai-panel__model"
                    style={{ "--provider-accent": p.accent } as CSSProperties}
                    onClick={() => copy(id, id)}
                  >
                    <span>{id}</span>
                    <em>{copied === id ? "copied" : p.name}</em>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="muted">
            No providers connected yet —{" "}
            <a className="text-link" href="/account/providers">
              connect one
            </a>{" "}
            first.
          </p>
        )}
        <p className="chat-meta muted">
          List live catalogs with <code>GET {v1}/models</code>.
        </p>
      </section>

      <section className="openai-panel__card">
        <h2 className="openai-panel__h">Env</h2>
        <code className="code-block">{envSnippet}</code>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => copy("env", envSnippet)}
        >
          {copied === "env" ? "Copied" : "Copy env"}
        </button>
      </section>

      <section className="openai-panel__card">
        <h2 className="openai-panel__h">OpenAI SDK</h2>
        <code className="code-block">{sdkSnippet}</code>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => copy("sdk", sdkSnippet)}
        >
          {copied === "sdk" ? "Copied" : "Copy SDK snippet"}
        </button>
      </section>

      <section className="openai-panel__card">
        <h2 className="openai-panel__h">curl</h2>
        <code className="code-block">{curlSnippet}</code>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => copy("curl", curlSnippet)}
        >
          {copied === "curl" ? "Copied" : "Copy curl"}
        </button>
      </section>
    </div>
  );
}
