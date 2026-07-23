import { FailureButtonCard } from "@/components/SignInWithFailure";
import { universalUiFormat } from "@/lib/oauth-server";
import { config } from "@/lib/config";

export default function DevelopersPage() {
  const ui = universalUiFormat();
  const base = config.baseUrl.replace(/\/$/, "");

  return (
    <main className="page developers-layout">
      <section className="developers-main">
        <p className="eyebrow">Developers</p>
        <h1 className="page-title">Integrate Failure AI OAuth</h1>
        <p className="muted">
          Failure is a PKCE OAuth 2.0 authorization server. Register an app in
          the dashboard, show the frosted glass Sign in with Failure button, and
          exchange the code for tokens that unlock linked providers. Full
          guide:{" "}
          <a
            className="text-link"
            href="https://github.com/failure-fail/Oauth/blob/main/docs/INTEGRATION.md"
          >
            docs/INTEGRATION.md
          </a>
          .
        </p>

        <h2 className="developers-h2">PKCE quickstart</h2>
        <ol className="developers-steps">
          <li>Create a public client in the dashboard (PKCE required).</li>
          <li>
            Send users to <code>/oauth/authorize</code> with{" "}
            <code>code_challenge</code> (S256).
          </li>
          <li>
            Exchange the code at <code>/api/oauth/token</code> with{" "}
            <code>code_verifier</code>.
          </li>
          <li>
            Call <code>/api/oauth/userinfo</code> with the access token to read
            profile + provider credentials — or call the OpenAI-compatible{" "}
            <code>/v1/chat/completions</code> proxy with the same Bearer token.
          </li>
        </ol>

        <h2 className="developers-h2">OpenAI-compatible API</h2>
        <p className="muted">
          Set <code>baseURL</code> to <code>{base}/v1</code> and{" "}
          <code>apiKey</code> to the Failure access token (<code>providers</code>{" "}
          scope). Model ids look like <code>codex/gpt-5.6-sol</code>.
        </p>
        <code className="code-block">{`OPENAI_BASE_URL=${base}/v1
OPENAI_API_KEY=<failure_access_token>

GET  ${base}/v1/models
POST ${base}/v1/chat/completions`}</code>

        <h2 className="developers-h2">Discovery</h2>
        <code className="code-block">
          {`${base}/.well-known/openid-configuration`}
        </code>

        <h2 className="developers-h2">Universal UI format</h2>
        <code className="code-block">{JSON.stringify(ui, null, 2)}</code>

        <h2 className="developers-h2">Example authorize URL</h2>
        <code className="code-block">{`${base}/oauth/authorize?response_type=code&client_id=YOUR_CLIENT_ID&redirect_uri=https://yourapp.com/callback&scope=openid%20profile%20email%20providers%20offline_access&code_challenge=CHALLENGE&code_challenge_method=S256&state=STATE`}</code>
      </section>

      <aside className="developers-aside">
        <FailureButtonCard
          authorizeUrl={`${base}/oauth/authorize?client_id=YOUR_CLIENT_ID&redirect_uri=https://yourapp.com/callback&response_type=code&scope=openid%20profile%20email%20providers%20offline_access&code_challenge=pending&code_challenge_method=S256`}
        />
        <div className="failure-button-card">
          <p className="failure-button-card__eyebrow">SDK assets</p>
          <h3 className="failure-button-card__title">Drop-in files</h3>
          <p className="failure-button-card__copy">
            Ship the CSS + JS from <code>/sdk</code> so every app renders the
            same Failure button.
          </p>
          <code className="failure-button-card__snippet">
            {`${base}/sdk/sign-in-with-failure.css
${base}/sdk/sign-in-with-failure.js
${base}/api/ui-format`}
          </code>
        </div>
      </aside>
    </main>
  );
}
