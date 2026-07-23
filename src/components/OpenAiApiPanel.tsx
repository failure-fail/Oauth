"use client";

import { useMemo, useState, type CSSProperties } from "react";
import type { ProviderId } from "@/lib/providers-meta";
import { PROVIDERS } from "@/lib/providers-meta";

type Connection = {
  provider: ProviderId;
  status: string;
  label?: string;
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
  const [token, setToken] = useState<string | null>(null);
  const [expiresIn, setExpiresIn] = useState<number | null>(null);
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

  async function mintToken() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/openai-token", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to mint token");
      setToken(data.access_token);
      setExpiresIn(data.expires_in);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to mint token");
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
export OPENAI_API_KEY=${token || "<failure_access_token>"}`;

  const sdkSnippet = `import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: "${v1}",
});

const chat = await client.chat.completions.create({
  model: "${sampleModel}",
  messages: [{ role: "user", content: "Say hello in one sentence." }],
});

console.log(chat.choices[0].message.content);`;

  const curlSnippet = `curl ${v1}/chat/completions \\
  -H "Authorization: Bearer ${token || "$OPENAI_API_KEY"}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${sampleModel}",
    "messages": [{"role":"user","content":"Hello"}]
  }'`;

  return (
    <div className="openai-panel">
      <section className="openai-panel__card">
        <h2 className="openai-panel__h">Base URL</h2>
        <p className="muted">
          Point any OpenAI-compatible SDK at Failure. Auth is your Failure
          access token with the <code>providers</code> scope.
        </p>
        <code className="code-block">{v1}</code>
        <div className="hero-cta">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => copy("base", v1)}
          >
            {copied === "base" ? "Copied" : "Copy base URL"}
          </button>
        </div>
      </section>

      <section className="openai-panel__card">
        <h2 className="openai-panel__h">Test access token</h2>
        <p className="muted">
          Mint a short-lived token for local testing (same JWT your apps get
          after Sign in with Failure). Expires in about an hour — no refresh
          token.
        </p>
        <div className="hero-cta">
          <button
            type="button"
            className="btn-primary"
            onClick={mintToken}
            disabled={busy}
          >
            {busy ? "Minting…" : token ? "Mint another token" : "Mint test token"}
          </button>
          {token ? (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => copy("token", token)}
            >
              {copied === "token" ? "Copied" : "Copy token"}
            </button>
          ) : null}
        </div>
        {expiresIn ? (
          <p className="chat-meta muted">expires_in · {expiresIn}s</p>
        ) : null}
        {token ? (
          <code className="code-block openai-panel__token">{token}</code>
        ) : null}
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
