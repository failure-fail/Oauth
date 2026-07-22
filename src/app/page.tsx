import Link from "next/link";
import { SignInWithFailure } from "@/components/SignInWithFailure";

export default function HomePage() {
  return (
    <main>
      <section className="hero">
        <p className="brand-hero">Failure</p>
        <h2>Universal AI OAuth for any app</h2>
        <p>
          PKCE sign-in that lets users bring Codex, ChatGPT, Claude Code, Grok
          Build — then hand your app one clean Failure session.
        </p>
        <div className="hero-cta">
          <SignInWithFailure href="/signup" />
          <Link className="btn-secondary" href="/developers">
            Integrate Failure
          </Link>
        </div>
      </section>

      <section className="section">
        <h2>One identity. Four providers.</h2>
        <p>
          Users create a Failure account, connect their AI tools once, and every
          integrated app uses the same Sign in with Failure button.
        </p>
        <div className="feature-strip">
          <article>
            <h3>Codex desktop OAuth</h3>
            <p>Official OpenAI Codex PKCE desktop flow with localhost callback.</p>
          </article>
          <article>
            <h3>ChatGPT via openai-oauth</h3>
            <p>
              Bring ChatGPT credentials using{" "}
              <a
                className="text-link"
                href="https://github.com/EvanZhouDev/openai-oauth"
                target="_blank"
                rel="noreferrer"
              >
                EvanZhouDev/openai-oauth
              </a>
              .
            </p>
          </article>
          <article>
            <h3>Claude Code</h3>
            <p>
              Setup-token connect path with an explicit account-deletion risk
              warning.
            </p>
          </article>
          <article>
            <h3>Grok Build OAuth</h3>
            <p>xAI device-code OAuth for Grok Build / SuperGrok sessions.</p>
          </article>
        </div>
      </section>
    </main>
  );
}
