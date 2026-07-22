"use client";

import { useEffect, useMemo, useState } from "react";
import { PROVIDERS, type ProviderId } from "@/lib/providers-meta";

type Connection = {
  id: string;
  provider: ProviderId;
  status: string;
  label?: string;
  connectedAt: string;
};

type CodexFlow = {
  flowId: string;
  authorizeUrl: string;
  instructions: string[];
};

type GrokFlow = {
  flowId: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  interval: number;
};

export function ProviderConnectors({
  initialConnections,
}: {
  initialConnections: Connection[];
}) {
  const [connections, setConnections] = useState(initialConnections);
  const [active, setActive] = useState<ProviderId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [codexFlow, setCodexFlow] = useState<CodexFlow | null>(null);
  const [codexCode, setCodexCode] = useState("");
  const [chatgptToken, setChatgptToken] = useState("");
  const [chatgptRefresh, setChatgptRefresh] = useState("");
  const [claudeToken, setClaudeToken] = useState("");
  const [claudeAck, setClaudeAck] = useState(false);
  const [grokFlow, setGrokFlow] = useState<GrokFlow | null>(null);
  const [cursorKey, setCursorKey] = useState("");

  const byProvider = useMemo(() => {
    const map = new Map<string, Connection>();
    for (const c of connections) map.set(c.provider, c);
    return map;
  }, [connections]);

  async function refresh() {
    const res = await fetch("/api/providers");
    if (!res.ok) return;
    const data = await res.json();
    setConnections(data.connections);
  }

  async function call(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/providers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error || "Request failed");
      throw new Error(data.error || "Request failed");
    }
    return data;
  }

  useEffect(() => {
    if (!grokFlow) return;
    let cancelled = false;
    const timer = setInterval(async () => {
      try {
        const data = await call({
          action: "grok_poll",
          flowId: grokFlow.flowId,
        });
        if (cancelled) return;
        if (data.status === "connected") {
          setGrokFlow(null);
          setActive(null);
          await refresh();
        }
      } catch {
        // keep polling until expiry surfaces as error once
      }
    }, Math.max(3, grokFlow.interval) * 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [grokFlow]);

  return (
    <div className="provider-grid">
      {PROVIDERS.map((provider) => {
        const conn = byProvider.get(provider.id);
        const open = active === provider.id;
        return (
          <article
            key={provider.id}
            className={`provider-panel ${conn ? "is-connected" : ""}`}
          >
            <header className="provider-panel__head">
              <div>
                <p className="provider-panel__short">{provider.short}</p>
                <h3>{provider.name}</h3>
                <p>{provider.description}</p>
              </div>
              <span className={`status-pill ${conn ? "on" : "off"}`}>
                {conn ? "Connected" : "Not connected"}
              </span>
            </header>

            {provider.risk && (
              <p className="risk-banner">{provider.risk}</p>
            )}

            <div className="provider-panel__actions">
              {!conn && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setActive(open ? null : provider.id);
                    setError(null);
                  }}
                >
                  {open ? "Close" : "Connect"}
                </button>
              )}
              {conn && (
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={busy}
                  onClick={async () => {
                    await call({
                      action: "disconnect",
                      provider: provider.id,
                    });
                    await refresh();
                  }}
                >
                  Disconnect
                </button>
              )}
            </div>

            {open && provider.id === "codex" && (
              <div className="provider-form">
                {!codexFlow ? (
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={busy}
                    onClick={async () => {
                      const data = await call({ action: "codex_start" });
                      setCodexFlow(data);
                      window.open(data.authorizeUrl, "_blank", "noopener");
                    }}
                  >
                    Start Codex desktop OAuth
                  </button>
                ) : (
                  <>
                    <ol>
                      {codexFlow.instructions.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ol>
                    <a
                      className="text-link"
                      href={codexFlow.authorizeUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open authorize URL
                    </a>
                    <textarea
                      value={codexCode}
                      onChange={(e) => setCodexCode(e.target.value)}
                      placeholder="Paste callback URL or code"
                      rows={3}
                    />
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={busy || !codexCode}
                      onClick={async () => {
                        await call({
                          action: "codex_complete",
                          flowId: codexFlow.flowId,
                          callbackUrlOrCode: codexCode,
                        });
                        setCodexFlow(null);
                        setCodexCode("");
                        setActive(null);
                        await refresh();
                      }}
                    >
                      Complete Codex connection
                    </button>
                  </>
                )}
              </div>
            )}

            {open && provider.id === "chatgpt" && (
              <div className="provider-form">
                <p>
                  Use{" "}
                  <a
                    href="https://github.com/EvanZhouDev/openai-oauth"
                    target="_blank"
                    rel="noreferrer"
                    className="text-link"
                  >
                    openai-oauth
                  </a>{" "}
                  / Sign in with ChatGPT, then paste the resulting tokens.
                </p>
                <input
                  value={chatgptToken}
                  onChange={(e) => setChatgptToken(e.target.value)}
                  placeholder="Access token"
                />
                <input
                  value={chatgptRefresh}
                  onChange={(e) => setChatgptRefresh(e.target.value)}
                  placeholder="Refresh token (optional)"
                />
                <button
                  type="button"
                  className="btn-primary"
                  disabled={busy || !chatgptToken}
                  onClick={async () => {
                    await call({
                      action: "chatgpt_connect",
                      accessToken: chatgptToken,
                      refreshToken: chatgptRefresh || undefined,
                    });
                    setChatgptToken("");
                    setChatgptRefresh("");
                    setActive(null);
                    await refresh();
                  }}
                >
                  Connect ChatGPT
                </button>
              </div>
            )}

            {open && provider.id === "claude" && (
              <div className="provider-form">
                <p className="risk-banner">
                  Warning: connecting Claude Code OAuth here may risk account
                  deletion under Anthropic’s Consumer Terms.
                </p>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={claudeAck}
                    onChange={(e) => setClaudeAck(e.target.checked)}
                  />
                  <span>I understand and accept the account deletion risk</span>
                </label>
                <input
                  value={claudeToken}
                  onChange={(e) => setClaudeToken(e.target.value)}
                  placeholder="Paste output from claude setup-token"
                />
                <button
                  type="button"
                  className="btn-primary"
                  disabled={busy || !claudeToken || !claudeAck}
                  onClick={async () => {
                    await call({
                      action: "claude_connect",
                      setupToken: claudeToken,
                      acknowledgeRisk: true,
                    });
                    setClaudeToken("");
                    setClaudeAck(false);
                    setActive(null);
                    await refresh();
                  }}
                >
                  Connect Claude Code
                </button>
              </div>
            )}

            {open && provider.id === "grok" && (
              <div className="provider-form">
                {!grokFlow ? (
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={busy}
                    onClick={async () => {
                      const data = await call({ action: "grok_start" });
                      setGrokFlow(data);
                      window.open(
                        data.verificationUriComplete || data.verificationUri,
                        "_blank",
                        "noopener",
                      );
                    }}
                  >
                    Start Grok Build OAuth
                  </button>
                ) : (
                  <>
                    <p>
                      Enter this code at{" "}
                      <a
                        className="text-link"
                        href={grokFlow.verificationUri}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {grokFlow.verificationUri}
                      </a>
                    </p>
                    <p className="user-code">{grokFlow.userCode}</p>
                    <p className="muted">Waiting for approval…</p>
                  </>
                )}
              </div>
            )}

            {open && provider.id === "cursor" && (
              <div className="provider-form">
                <p>
                  Create a user API key at{" "}
                  <a
                    className="text-link"
                    href="https://cursor.com/dashboard/integrations"
                    target="_blank"
                    rel="noreferrer"
                  >
                    cursor.com/dashboard/integrations
                  </a>
                  .
                </p>
                <input
                  value={cursorKey}
                  onChange={(e) => setCursorKey(e.target.value)}
                  placeholder="Cursor account API key"
                />
                <button
                  type="button"
                  className="btn-primary"
                  disabled={busy || !cursorKey}
                  onClick={async () => {
                    await call({
                      action: "cursor_connect",
                      accountKey: cursorKey,
                    });
                    setCursorKey("");
                    setActive(null);
                    await refresh();
                  }}
                >
                  Connect Cursor
                </button>
              </div>
            )}
          </article>
        );
      })}
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}
