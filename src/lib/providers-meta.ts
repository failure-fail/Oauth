export const PROVIDERS = [
  {
    id: "codex",
    name: "Codex",
    short: "Desktop OAuth",
    buttonLabel: "Connect Codex Desktop",
    connectedLabel: "Connected via Codex Desktop OAuth",
    description:
      "Official Codex desktop OAuth — same PKCE loopback flow as Codex CLI/Desktop (localhost:1455).",
    method: "desktop_oauth",
    docsUrl: "https://developers.openai.com/codex/auth",
    accent: "#10a37f",
    accentSoft: "rgba(16, 163, 127, 0.18)",
    risk: null as string | null,
  },
  {
    id: "antigravity",
    name: "Antigravity",
    short: "Google OAuth",
    buttonLabel: "Connect Antigravity",
    connectedLabel: "Connected to Antigravity",
    description:
      "Google Antigravity (Cloud Code Assist) via OAuth PKCE — Gemini, Claude, and more through cloudcode-pa.googleapis.com.",
    method: "google_oauth",
    docsUrl: "https://github.com/NoeFabris/opencode-antigravity-auth",
    accent: "#8ab4f8",
    accentSoft: "rgba(138, 180, 248, 0.18)",
    risk: null as string | null,
  },
  {
    id: "claude",
    name: "Claude Code",
    short: "Setup token",
    buttonLabel: "Connect Claude Code",
    connectedLabel: "Connected to Claude Code",
    description:
      "Paste a Claude Code OAuth setup token from `claude setup-token`.",
    method: "setup_token",
    docsUrl: "https://code.claude.com/docs/en/authentication",
    accent: "#d97757",
    accentSoft: "rgba(217, 119, 87, 0.18)",
    risk:
      "Using Claude Code OAuth outside Claude Code / Claude.ai violates Anthropic’s Consumer Terms and can risk account deletion. Proceed only if you accept that risk.",
  },
  {
    id: "grok",
    name: "Grok Build",
    short: "Grok Build OAuth",
    buttonLabel: "Connect Grok Build",
    connectedLabel: "Connected to Grok Build",
    description:
      "Authorize with xAI Grok Build via device-code OAuth. Tokens talk to cli-chat-proxy.grok.com (not api.x.ai).",
    method: "device_oauth",
    docsUrl: "https://docs.x.ai/build/overview",
    accent: "#e8c98a",
    accentSoft: "rgba(232, 201, 138, 0.16)",
    risk: null as string | null,
  },
] as const;

export type ProviderId = (typeof PROVIDERS)[number]["id"];
export type ProviderMeta = (typeof PROVIDERS)[number];
