"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { PROVIDERS, type ProviderId, type ProviderMeta } from "@/lib/providers-meta";

type Connection = {
  id: string;
  provider: ProviderId;
  status: string;
  label?: string;
  connectedAt: string;
};

type CodexFlow = {
  flowId: string;
  bridgeToken: string;
  authorizeUrl: string;
  bridgeCommand: string;
  redirectUri: string;
  port: number;
  instructions: string[];
};

type AntigravityFlow = {
  flowId: string;
  authorizeUrl: string;
  redirectUri: string;
  port: number;
  instructions: string[];
};

type GrokFlow = {
  flowId: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  interval: number;
};

type CopilotFlow = {
  flowId: string;
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  interval: number;
};

type MimoFlow = {
  flowId: string;
  authorizeUrl: string;
  keyName: string;
  instructions: string[];
};

const GLYPH: Record<ProviderId, string> = {
  codex: "C",
  antigravity: "A",
  copilot: "GH",
  mimo: "米",
  claude: "◆",
  grok: "G",
};

function ProviderGlyph({ id }: { id: ProviderId }) {
  return <span className="provider-btn__glyph">{GLYPH[id]}</span>;
}

function ProviderButton({
  provider,
  connected,
  busy,
  onClick,
  label,
}: {
  provider: ProviderMeta;
  connected: boolean;
  busy?: boolean;
  onClick: () => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      className={`provider-btn ${connected ? "is-connected" : ""}`}
      style={
        {
          "--provider-accent": provider.accent,
          "--provider-accent-soft": provider.accentSoft,
        } as CSSProperties
      }
      disabled={busy}
      onClick={onClick}
    >
      <span className="provider-btn__shine" aria-hidden />
      <ProviderGlyph id={provider.id} />
      <span className="provider-btn__copy">
        <strong>
          {label || (connected ? provider.connectedLabel : provider.buttonLabel)}
        </strong>
        <em>{provider.short}</em>
      </span>
      <span className={`provider-btn__status ${connected ? "on" : "off"}`}>
        {connected ? "Connected" : "Connect"}
      </span>
    </button>
  );
}

export function ProvidersConfig({
  initialConnections,
}: {
  initialConnections: Connection[];
}) {
  const [connections, setConnections] = useState(initialConnections);
  const [active, setActive] = useState<ProviderId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [codexFlow, setCodexFlow] = useState<CodexFlow | null>(null);
  const [codexCode, setCodexCode] = useState("");
  const [antigravityFlow, setAntigravityFlow] = useState<AntigravityFlow | null>(
    null,
  );
  const [antigravityCode, setAntigravityCode] = useState("");
  const [claudeToken, setClaudeToken] = useState("");
  const [claudeAck, setClaudeAck] = useState(false);
  const [grokFlow, setGrokFlow] = useState<GrokFlow | null>(null);
  const [copilotFlow, setCopilotFlow] = useState<CopilotFlow | null>(null);
  const [copilotPollNote, setCopilotPollNote] = useState<string | null>(null);
  const [copilotChecking, setCopilotChecking] = useState(false);
  const [mimoFlow, setMimoFlow] = useState<MimoFlow | null>(null);
  const [mimoCode, setMimoCode] = useState("");
  const [mimoApiKey, setMimoApiKey] = useState("");
  const [mimoBaseUrl, setMimoBaseUrl] = useState("");

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
    if (!codexFlow) return;
    let cancelled = false;
    const timer = setInterval(async () => {
      const res = await fetch("/api/providers");
      if (!res.ok || cancelled) return;
      const data = await res.json();
      const connected = (data.connections || []).some(
        (c: Connection) => c.provider === "codex" && c.status === "connected",
      );
      if (connected) {
        setCodexFlow(null);
        setCodexCode("");
        setActive(null);
        setMessage("Codex connected via desktop OAuth.");
        setConnections(data.connections);
      }
    }, 2500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [codexFlow]);

  useEffect(() => {
    if (!grokFlow) return;
    const flowId = grokFlow.flowId;
    let cancelled = false;
    let delayMs = Math.max(3, grokFlow.interval) * 1000;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function pollOnce() {
      try {
        const res = await fetch("/api/providers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "grok_poll",
            flowId,
          }),
        });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          if (
            typeof data.error === "string" &&
            !/authorization_pending|slow_down/i.test(data.error)
          ) {
            setError(data.error);
            setGrokFlow(null);
          }
          return;
        }
        if (data.status === "connected") {
          setGrokFlow(null);
          setActive(null);
          setError(null);
          setMessage("Grok Build connected.");
          await refresh();
          return;
        }
        if (data.status === "slow_down") {
          delayMs = Math.min(delayMs + 2000, 15000);
        }
      } catch {
        // keep polling
      }
    }

    async function loop() {
      await pollOnce();
      if (cancelled) return;
      timer = setTimeout(loop, delayMs);
    }

    void loop();
    const onResume = () => {
      if (document.visibilityState === "visible") void pollOnce();
    };
    window.addEventListener("focus", onResume);
    document.addEventListener("visibilitychange", onResume);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener("focus", onResume);
      document.removeEventListener("visibilitychange", onResume);
    };
  }, [grokFlow]);

  useEffect(() => {
    if (!copilotFlow) return;
    const flowId = copilotFlow.flowId;
    const deviceCode = copilotFlow.deviceCode;
    let cancelled = false;
    let delayMs = Math.max(5, copilotFlow.interval) * 1000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let checks = 0;
    let inFlight = false;

    async function pollOnce(manual = false) {
      if (inFlight) return "pending" as const;
      inFlight = true;
      if (manual) setCopilotChecking(true);
      try {
        const res = await fetch("/api/providers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "copilot_poll",
            flowId,
            deviceCode,
          }),
        });
        const data = await res.json();
        if (cancelled) return "done" as const;
        checks += 1;
        if (!res.ok) {
          const err =
            typeof data.error === "string" ? data.error : "Copilot poll failed";
          if (/authorization_pending|slow_down/i.test(err)) {
            setCopilotPollNote(
              `Still waiting for GitHub… (check #${checks})`,
            );
            return "pending" as const;
          }
          // A parallel poll may have already connected this account.
          if (/incorrect_device_code|expired_token/i.test(err)) {
            const probe = await fetch("/api/providers");
            if (probe.ok) {
              const list = await probe.json();
              const connected = (list.connections || []).some(
                (c: Connection) =>
                  c.provider === "copilot" && c.status === "connected",
              );
              if (connected) {
                setCopilotFlow(null);
                setActive(null);
                setError(null);
                setCopilotPollNote(null);
                setMessage("GitHub Copilot connected.");
                setConnections(list.connections);
                return "done" as const;
              }
            }
          }
          setError(err);
          setCopilotFlow(null);
          setCopilotPollNote(null);
          return "done" as const;
        }
        if (data.status === "connected") {
          setCopilotFlow(null);
          setActive(null);
          setError(null);
          setCopilotPollNote(null);
          setMessage("GitHub Copilot connected.");
          await refresh();
          return "done" as const;
        }
        if (data.status === "slow_down") {
          delayMs = Math.min(delayMs + 5000, 20000);
          setCopilotPollNote(
            `GitHub asked us to slow down — retrying (check #${checks})…`,
          );
          return "pending" as const;
        }
        if (typeof data.interval === "number" && data.interval > 0) {
          delayMs = Math.max(delayMs, data.interval * 1000);
        }
        setCopilotPollNote(
          `Waiting for GitHub approval… (check #${checks})`,
        );
        return "pending" as const;
      } catch (err) {
        setCopilotPollNote(
          err instanceof Error
            ? `Poll error: ${err.message}`
            : "Poll error — retrying…",
        );
        return "pending" as const;
      } finally {
        inFlight = false;
        if (manual) setCopilotChecking(false);
      }
    }

    async function loop() {
      const result = await pollOnce();
      if (cancelled || result === "done") return;
      timer = setTimeout(loop, delayMs);
    }

    // Respect GitHub's interval — do not poll immediately (causes slow_down
    // / races that redeem the device code before the success path finishes).
    timer = setTimeout(loop, delayMs);
    const onResume = () => {
      if (document.visibilityState === "visible") void pollOnce();
    };
    window.addEventListener("focus", onResume);
    document.addEventListener("visibilitychange", onResume);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener("focus", onResume);
      document.removeEventListener("visibilitychange", onResume);
    };
  }, [copilotFlow]);

  async function checkCopilotNow() {
    if (!copilotFlow || copilotChecking) return;
    const flowId = copilotFlow.flowId;
    const deviceCode = copilotFlow.deviceCode;
    setCopilotChecking(true);
    try {
      const res = await fetch("/api/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "copilot_poll",
          flowId,
          deviceCode,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const err =
          typeof data.error === "string" ? data.error : "Copilot poll failed";
        if (/authorization_pending|slow_down/i.test(err)) {
          setCopilotPollNote(
            "GitHub still pending — finish authorizing, then check again.",
          );
          return;
        }
        if (/incorrect_device_code|expired_token/i.test(err)) {
          const probe = await fetch("/api/providers");
          if (probe.ok) {
            const list = await probe.json();
            const connected = (list.connections || []).some(
              (c: Connection) =>
                c.provider === "copilot" && c.status === "connected",
            );
            if (connected) {
              setCopilotFlow(null);
              setActive(null);
              setError(null);
              setCopilotPollNote(null);
              setMessage("GitHub Copilot connected.");
              setConnections(list.connections);
              return;
            }
          }
        }
        setError(err);
        setCopilotFlow(null);
        setCopilotPollNote(null);
        return;
      }
      if (data.status === "connected") {
        setCopilotFlow(null);
        setActive(null);
        setError(null);
        setCopilotPollNote(null);
        setMessage("GitHub Copilot connected.");
        await refresh();
        return;
      }
      setCopilotPollNote(
        "GitHub still pending — after you click Authorize, return here and press Check now.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Copilot check failed");
    } finally {
      setCopilotChecking(false);
    }
  }

  async function disconnect(provider: ProviderId) {
    await call({ action: "disconnect", provider });
    setMessage(`${provider} disconnected.`);
    await refresh();
  }

  return (
    <div className="providers-config">
      {(message || error) && (
        <div className="providers-config__toast" role="status">
          {message && <p className="notice">{message}</p>}
          {error && <p className="form-error">{error}</p>}
        </div>
      )}

      <div className="providers-config__grid">
        {PROVIDERS.map((provider) => {
          const conn = byProvider.get(provider.id);
          const open = active === provider.id;

          return (
            <section
              key={provider.id}
              className={`provider-tile ${conn ? "is-connected" : ""} ${open ? "is-open" : ""}`}
              style={
                {
                  "--provider-accent": provider.accent,
                  "--provider-accent-soft": provider.accentSoft,
                } as CSSProperties
              }
            >
              <div className="provider-tile__top">
                <div>
                  <p className="provider-tile__short">{provider.short}</p>
                  <h3>{provider.name}</h3>
                  <p>{provider.description}</p>
                  {provider.docsUrl ? (
                    <a
                      className="text-link provider-tile__docs"
                      href={provider.docsUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Provider docs
                    </a>
                  ) : null}
                </div>
              </div>

              {provider.risk && <p className="risk-banner">{provider.risk}</p>}

              <div className="provider-tile__actions">
                {!conn ? (
                  <ProviderButton
                    provider={provider}
                    connected={false}
                    busy={busy}
                    onClick={() => {
                      setActive(open ? null : provider.id);
                      setError(null);
                      setMessage(null);
                    }}
                  />
                ) : (
                  <div className="provider-tile__connected-row">
                    <ProviderButton
                      provider={provider}
                      connected
                      onClick={() => setActive(open ? null : provider.id)}
                    />
                    <button
                      type="button"
                      className="btn-ghost"
                      disabled={busy}
                      onClick={() => disconnect(provider.id)}
                    >
                      Disconnect
                    </button>
                  </div>
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
                      }}
                    >
                      Start Codex desktop OAuth
                    </button>
                  ) : (
                    <>
                      <p className="muted">
                        Official Codex desktop OAuth with loopback on{" "}
                        <code>
                          http://localhost:{codexFlow.port}/auth/callback
                        </code>
                        .
                      </p>
                      <ol>
                        {codexFlow.instructions.map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ol>
                      <label>
                        <span>Desktop bridge command</span>
                        <textarea
                          readOnly
                          value={codexFlow.bridgeCommand}
                          rows={3}
                        />
                      </label>
                      <div className="provider-tile__connected-row">
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={async () => {
                            await navigator.clipboard.writeText(
                              codexFlow.bridgeCommand,
                            );
                            setMessage("Bridge command copied.");
                          }}
                        >
                          Copy bridge command
                        </button>
                        <a
                          className="btn-secondary btn-secondary--link"
                          href={codexFlow.authorizeUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open authorize URL
                        </a>
                      </div>
                      <p className="muted">
                        Waiting for desktop callback on port {codexFlow.port}…
                      </p>
                      <textarea
                        value={codexCode}
                        onChange={(e) => setCodexCode(e.target.value)}
                        placeholder="Fallback: paste http://localhost:1455/auth/callback?code=…&state=…"
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
                          setMessage("Codex connected via desktop OAuth.");
                          await refresh();
                        }}
                      >
                        Complete with pasted callback
                      </button>
                    </>
                  )}
                </div>
              )}

              {open && provider.id === "antigravity" && (
                <div className="provider-form">
                  {!antigravityFlow ? (
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={busy}
                      onClick={async () => {
                        const data = await call({ action: "antigravity_start" });
                        setAntigravityFlow(data);
                      }}
                    >
                      Start Antigravity Google OAuth
                    </button>
                  ) : (
                    <>
                      <p className="muted">
                        Google OAuth PKCE with loopback on{" "}
                        <code>{antigravityFlow.redirectUri}</code>
                        {antigravityFlow.port
                          ? ` (port ${antigravityFlow.port})`
                          : ""}
                        .
                      </p>
                      <ol>
                        {antigravityFlow.instructions.map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ol>
                      <a
                        className="btn-secondary btn-secondary--link"
                        href={antigravityFlow.authorizeUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open authorize URL
                      </a>
                      <textarea
                        value={antigravityCode}
                        onChange={(e) => setAntigravityCode(e.target.value)}
                        placeholder={`Paste ${antigravityFlow.redirectUri}?code=…&state=…`}
                        rows={3}
                      />
                      <button
                        type="button"
                        className="btn-primary"
                        disabled={busy || !antigravityCode}
                        onClick={async () => {
                          await call({
                            action: "antigravity_complete",
                            flowId: antigravityFlow.flowId,
                            callbackUrlOrCode: antigravityCode,
                          });
                          setAntigravityFlow(null);
                          setAntigravityCode("");
                          setActive(null);
                          setMessage("Antigravity connected.");
                          await refresh();
                        }}
                      >
                        Complete with pasted callback
                      </button>
                    </>
                  )}
                </div>
              )}

              {open && provider.id === "copilot" && (
                <div className="provider-form">
                  {!copilotFlow ? (
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={busy}
                      onClick={async () => {
                        if (busy) return;
                        setCopilotPollNote(null);
                        setError(null);
                        const data = await call({ action: "copilot_start" });
                        if (!data?.deviceCode || !data?.flowId) {
                          setError(
                            "Copilot start did not return a device code — try again.",
                          );
                          return;
                        }
                        setCopilotFlow({
                          flowId: data.flowId,
                          deviceCode: data.deviceCode,
                          userCode: data.userCode,
                          verificationUri: data.verificationUri,
                          verificationUriComplete: data.verificationUriComplete,
                          interval: data.interval ?? 5,
                        });
                        window.open(
                          data.verificationUriComplete || data.verificationUri,
                          "_blank",
                          "noopener,noreferrer",
                        );
                      }}
                    >
                      Start GitHub Copilot OAuth
                    </button>
                  ) : (
                    <>
                      <p>
                        Enter this code at{" "}
                        <a
                          className="text-link"
                          href={copilotFlow.verificationUri}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {copilotFlow.verificationUri}
                        </a>
                      </p>
                      <p className="user-code">{copilotFlow.userCode}</p>
                      <p className="muted">
                        Authorize only this code. Do not click Start again —
                        that creates a new code and the old authorize page will
                        never verify. After GitHub confirms, press Check now.
                      </p>
                      {copilotPollNote ? (
                        <p className="muted">{copilotPollNote}</p>
                      ) : null}
                      <button
                        type="button"
                        className="btn-primary"
                        disabled={copilotChecking}
                        onClick={() => void checkCopilotNow()}
                      >
                        {copilotChecking
                          ? "Checking…"
                          : "I’ve authorized — Check now"}
                      </button>
                      <button
                        type="button"
                        className="btn-ghost"
                        onClick={() => {
                          setCopilotFlow(null);
                          setCopilotPollNote(null);
                        }}
                      >
                        Cancel
                      </button>
                    </>
                  )}
                </div>
              )}

              {open && provider.id === "mimo" && (
                <div className="provider-form">
                  {!mimoFlow ? (
                    <>
                      <button
                        type="button"
                        className="btn-primary"
                        disabled={busy}
                        onClick={async () => {
                          const data = await call({ action: "mimo_start" });
                          setMimoFlow(data);
                          window.open(data.authorizeUrl, "_blank", "noopener");
                        }}
                      >
                        Start Xiaomi MiMo OAuth
                      </button>
                      <p className="muted">
                        Or paste an existing API key (`sk-` / `tp-` /
                        `mimo-code-cli-key-…`).
                      </p>
                      <input
                        value={mimoApiKey}
                        onChange={(e) => setMimoApiKey(e.target.value)}
                        placeholder="Optional: paste MiMo API key"
                      />
                      <input
                        value={mimoBaseUrl}
                        onChange={(e) => setMimoBaseUrl(e.target.value)}
                        placeholder="Optional Token Plan base URL"
                      />
                      <button
                        type="button"
                        className="btn-secondary"
                        disabled={busy || !mimoApiKey}
                        onClick={async () => {
                          await call({
                            action: "mimo_connect",
                            apiKey: mimoApiKey,
                            ...(mimoBaseUrl.trim()
                              ? { baseUrl: mimoBaseUrl.trim() }
                              : {}),
                          });
                          setMimoApiKey("");
                          setMimoBaseUrl("");
                          setActive(null);
                          setMessage("Xiaomi MiMo connected via API key.");
                          await refresh();
                        }}
                      >
                        Save API key instead
                      </button>
                    </>
                  ) : (
                    <>
                      <p className="muted">
                        Same OAuth as MiMo Code CLI via{" "}
                        <code>platform.xiaomimimo.com</code>.
                      </p>
                      <ol>
                        {mimoFlow.instructions.map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ol>
                      <a
                        className="btn-secondary btn-secondary--link"
                        href={mimoFlow.authorizeUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open authorize URL
                      </a>
                      <textarea
                        value={mimoCode}
                        onChange={(e) => setMimoCode(e.target.value)}
                        placeholder="Paste the authorization code (or callback URL containing u=…)"
                        rows={3}
                      />
                      <button
                        type="button"
                        className="btn-primary"
                        disabled={busy || !mimoCode.trim()}
                        onClick={async () => {
                          await call({
                            action: "mimo_complete",
                            flowId: mimoFlow.flowId,
                            code: mimoCode,
                          });
                          setMimoFlow(null);
                          setMimoCode("");
                          setActive(null);
                          setMessage("Xiaomi MiMo connected via platform OAuth.");
                          await refresh();
                        }}
                      >
                        Complete MiMo OAuth
                      </button>
                    </>
                  )}
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
                    <span>
                      I understand and accept the account deletion risk
                    </span>
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
                      setMessage("Claude Code connected.");
                      await refresh();
                    }}
                  >
                    Save Claude token
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
            </section>
          );
        })}
      </div>
    </div>
  );
}
