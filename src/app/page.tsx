import Link from "next/link";
import { SignInWithFailure } from "@/components/SignInWithFailure";

export default function HomePage() {
  return (
    <main>
      <section className="hero hero--bleed">
        <div className="hero__atmosphere" aria-hidden />
        <div className="hero__grain" aria-hidden />
        <p className="brand-hero">Failure</p>
        <h1 className="hero-title">One OAuth for every AI app.</h1>
        <p className="hero-lede">
          Users connect Codex, Antigravity, Claude Code, and Grok Build once. Your
          app gets PKCE tokens, live models, thinking levels, and provider
          credentials.
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
          Failure is the authorization server. Apps never re-implement four
          OAuth dances — they ask for `providers` scope and receive usable
          credential packages.
        </p>
        <div className="rail">
          <article>
            <h3>Codex + Antigravity</h3>
            <p>
              Desktop OAuth and Google Antigravity OAuth. Live models, thinking
              levels, think blocks — plus GPT Image 2 on Codex.
            </p>
          </article>
          <article>
            <h3>Claude Code</h3>
            <p>
              Setup-token path with an explicit account-deletion risk warning
              before connect.
            </p>
          </article>
          <article>
            <h3>Grok Build</h3>
            <p>
              Device-code OAuth into the Grok CLI proxy — the same session
              SuperGrok uses.
            </p>
          </article>
        </div>
      </section>
    </main>
  );
}
