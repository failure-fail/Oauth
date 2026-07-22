export const PROVIDERS = [
  {
    id: "codex",
    name: "Codex",
    short: "Desktop OAuth",
    description:
      "Connect OpenAI Codex with the official desktop PKCE flow used by Codex CLI.",
    method: "desktop_oauth",
    docsUrl: "https://auth.openai.com",
    risk: null as string | null,
  },
  {
    id: "chatgpt",
    name: "ChatGPT",
    short: "OpenAI OAuth",
    description:
      "Bring your ChatGPT account via openai-oauth (Sign in with ChatGPT).",
    method: "openai_oauth",
    docsUrl: "https://github.com/EvanZhouDev/openai-oauth",
    risk: null as string | null,
  },
  {
    id: "claude",
    name: "Claude Code",
    short: "Setup token",
    description:
      "Paste a Claude Code OAuth setup token from `claude setup-token`.",
    method: "setup_token",
    docsUrl: "https://code.claude.com/docs/en/authentication",
    risk:
      "Using Claude Code OAuth outside Claude Code / Claude.ai violates Anthropic’s Consumer Terms and can risk account deletion. Proceed only if you accept that risk.",
  },
  {
    id: "grok",
    name: "Grok Build",
    short: "Grok Build OAuth",
    description:
      "Authorize with xAI Grok Build via the official device-code OAuth flow.",
    method: "device_oauth",
    docsUrl: "https://docs.x.ai/build/overview",
    risk: null as string | null,
  },
  {
    id: "cursor",
    name: "Cursor",
    short: "Account key",
    description:
      "Add your Cursor user API key from Dashboard → Integrations / API Keys.",
    method: "account_key",
    docsUrl: "https://cursor.com/dashboard/integrations",
    risk: null as string | null,
  },
] as const;

export type ProviderId = (typeof PROVIDERS)[number]["id"];
