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
    id: "chatgpt",
    name: "ChatGPT",
    short: "OpenAI OAuth",
    buttonLabel: "Sign in with ChatGPT",
    connectedLabel: "Connected to ChatGPT",
    description:
      "One-click ChatGPT connect via openai-oauth. Requires the Sign in with ChatGPT browser extension.",
    method: "openai_oauth",
    docsUrl: "https://github.com/EvanZhouDev/openai-oauth",
    accent: "#19c37d",
    accentSoft: "rgba(25, 195, 125, 0.18)",
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
      "Authorize with xAI Grok Build via the official device-code OAuth flow.",
    method: "device_oauth",
    docsUrl: "https://docs.x.ai/build/overview",
    accent: "#e8e8e8",
    accentSoft: "rgba(232, 232, 232, 0.12)",
    risk: null as string | null,
  },
] as const;

export type ProviderId = (typeof PROVIDERS)[number]["id"];
export type ProviderMeta = (typeof PROVIDERS)[number];
