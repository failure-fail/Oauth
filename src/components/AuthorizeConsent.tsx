"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { SignInWithFailure } from "./SignInWithFailure";

function base64Url(bytes: ArrayBuffer | Uint8Array) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let str = "";
  arr.forEach((b) => {
    str += String.fromCharCode(b);
  });
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function createPkce() {
  const verifierBytes = crypto.getRandomValues(new Uint8Array(32));
  const verifier = base64Url(verifierBytes);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return { verifier, challenge: base64Url(digest) };
}

export function AuthorizeConsent({
  clientId,
  redirectUri,
  scope,
  state,
  appName,
  loggedIn,
}: {
  clientId: string;
  redirectUri: string;
  scope: string;
  state?: string;
  appName: string;
  loggedIn: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const returnTo = useMemo(() => {
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope,
      code_challenge: "pending",
      code_challenge_method: "S256",
    });
    if (state) params.set("state", state);
    return `/oauth/authorize?${params.toString()}`;
  }, [clientId, redirectUri, scope, state]);

  if (!loggedIn) {
    return (
      <div className="consent-card">
        <p className="eyebrow">Failure AI OAuth</p>
        <h1>Sign in to continue</h1>
        <p>
          <strong>{appName}</strong> wants to use Failure to access your linked
          AI providers.
        </p>
        <SignInWithFailure
          href={`/login?next=${encodeURIComponent(returnTo)}`}
        />
      </div>
    );
  }

  return (
    <div className="consent-card">
      <p className="eyebrow">Authorize application</p>
      <h1>{appName}</h1>
      <p>
        This app will receive your Failure profile and connected provider
        credentials for: Codex, ChatGPT, Claude Code, and Grok Build.
      </p>
      <ul className="scope-list">
        {scope.split(/\s+/).map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ul>
      {error && <p className="form-error">{error}</p>}
      <div className="consent-actions">
        <button
          type="button"
          className="btn-primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              const pkce = await createPkce();
              sessionStorage.setItem(
                `failure_pkce_${clientId}`,
                JSON.stringify(pkce),
              );
              const challenge =
                new URLSearchParams(window.location.search).get(
                  "code_challenge",
                ) || pkce.challenge;
              const method =
                (new URLSearchParams(window.location.search).get(
                  "code_challenge_method",
                ) as "S256" | "plain") || "S256";
              const res = await fetch("/api/oauth/authorize", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  client_id: clientId,
                  redirect_uri: redirectUri,
                  response_type: "code",
                  scope,
                  state,
                  code_challenge: challenge === "pending" ? pkce.challenge : challenge,
                  code_challenge_method: method,
                }),
              });
              const data = await res.json();
              if (!res.ok) {
                setError(data.error || "Authorization failed");
                setBusy(false);
                return;
              }
              window.location.href = data.redirectTo;
            } catch (err) {
              setError(err instanceof Error ? err.message : "Failed");
              setBusy(false);
            }
          }}
        >
          Allow & continue
        </button>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => router.push("/dashboard")}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
