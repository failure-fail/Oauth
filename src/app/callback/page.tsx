"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function CallbackInner() {
  const params = useSearchParams();
  const error = params.get("error");
  const code = params.get("code");
  const state = params.get("state");

  const info = error
    ? `OAuth error: ${error}`
    : JSON.stringify(
        {
          code,
          state,
          next: "Exchange this code at POST /api/oauth/token with your code_verifier",
        },
        null,
        2,
      );

  return (
    <main className="page">
      <p className="eyebrow">OAuth callback</p>
      <h1 className="page-title">Authorization complete</h1>
      <code className="code-block">{info}</code>
    </main>
  );
}

export default function CallbackPage() {
  return (
    <Suspense fallback={<main className="page"><p className="muted">Reading callback…</p></main>}>
      <CallbackInner />
    </Suspense>
  );
}
