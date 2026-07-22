"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import Link from "next/link";

function CallbackInner() {
  const params = useSearchParams();
  const error = params.get("error");
  const code = params.get("code");
  const state = params.get("state");
  const [copied, setCopied] = useState(false);

  if (error) {
    return (
      <main className="page callback-page">
        <p className="eyebrow">OAuth callback</p>
        <h1 className="page-title">Authorization denied</h1>
        <p className="form-error">Error: {error}</p>
        <Link className="btn-secondary" href="/developers">
          Back to developers
        </Link>
      </main>
    );
  }

  const payload = JSON.stringify(
    {
      code,
      state,
      next: "Exchange this code at POST /api/oauth/token with your code_verifier",
    },
    null,
    2,
  );

  return (
    <main className="page callback-page">
      <p className="eyebrow">OAuth callback</p>
      <h1 className="page-title">Authorization complete</h1>
      <p className="muted">
        Your app should exchange this code server-side. This page is a local
        debug helper for public redirect URIs like{" "}
        <code>http://localhost:3000/callback</code>.
      </p>
      <code className="code-block">{payload}</code>
      <div className="hero-cta">
        <button
          type="button"
          className="btn-primary"
          disabled={!code}
          onClick={async () => {
            if (!code) return;
            await navigator.clipboard.writeText(code);
            setCopied(true);
          }}
        >
          {copied ? "Code copied" : "Copy authorization code"}
        </button>
        <Link className="btn-secondary" href="/dashboard">
          Open dashboard
        </Link>
      </div>
    </main>
  );
}

export default function CallbackPage() {
  return (
    <Suspense
      fallback={
        <main className="page">
          <p className="muted">Reading callback…</p>
        </main>
      }
    >
      <CallbackInner />
    </Suspense>
  );
}
