import Link from "next/link";
import type { CSSProperties } from "react";
import { SignInWithFailure } from "@/components/SignInWithFailure";
import { PROVIDERS } from "@/lib/providers-meta";

const GLYPH: Record<string, string> = {
  codex: "C",
  antigravity: "A",
  copilot: "GH",
  mistral: "M",
  mimo: "米",
  claude: "◆",
  grok: "G",
};

export default function HomePage() {
  return (
    <main>
      <section className="hero hero--bleed">
        <div className="hero__atmosphere" aria-hidden />
        <div className="hero__grain" aria-hidden />
        <p className="brand-hero">Failure</p>
        <h1 className="hero-title">One OAuth for every AI app.</h1>
        <p className="hero-lede">
          Users connect Codex, Antigravity, GitHub Copilot, Mistral, Xiaomi MiMo,
          Claude Code, and Grok Build once. Your app gets PKCE tokens, live
          models, thinking levels, and provider credentials.
        </p>
        <div className="hero-cta">
          <SignInWithFailure href="/signup" />
          <Link className="btn-ghost-light" href="/developers">
            Read the integrate guide
          </Link>
        </div>
      </section>

      <section className="section section--tight">
        <p className="eyebrow">What ships</p>
        <h2 className="section-title">Identity in, providers out.</h2>
        <p className="section-copy">
          Failure is the authorization server. Apps never re-implement every
          provider OAuth dance — they ask for `providers` scope and receive
          usable credential packages.
        </p>
        <div className="rail">
          {PROVIDERS.map((provider) => (
            <article
              key={provider.id}
              className="rail-provider"
              style={
                {
                  "--provider-accent": provider.accent,
                  "--provider-accent-soft": provider.accentSoft,
                } as CSSProperties
              }
            >
              <span className="rail-provider__glyph" aria-hidden>
                {GLYPH[provider.id] || "▸"}
              </span>
              <div>
                <p className="rail-provider__short">{provider.short}</p>
                <h3>{provider.name}</h3>
                <p>{provider.description}</p>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
