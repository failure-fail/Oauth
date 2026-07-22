import { Suspense } from "react";
import { AuthForm } from "@/components/AuthForm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";

export default async function SignupPage() {
  const user = await getCurrentUser();
  if (user) redirect("/dashboard");

  return (
    <main className="auth-shell">
      <div className="auth-card">
        <p className="eyebrow">Failure AI OAuth</p>
        <h1>Create your account</h1>
        <p className="muted">
          Email + password first. Then connect Codex, Antigravity, Claude Code, Grok
          Build.
        </p>
        <Suspense fallback={<p className="muted">Loading…</p>}>
          <AuthForm mode="signup" />
        </Suspense>
        <p className="muted" style={{ marginTop: "1rem" }}>
          Already have an account?{" "}
          <Link className="text-link" href="/login">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
