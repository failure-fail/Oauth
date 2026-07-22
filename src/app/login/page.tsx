import { Suspense } from "react";
import { AuthForm } from "@/components/AuthForm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const user = await getCurrentUser();
  const params = await searchParams;
  if (user) redirect(params.next || "/dashboard");

  return (
    <main className="auth-shell">
      <div className="auth-card">
        <p className="eyebrow">Welcome back</p>
        <h1>Sign in to Failure</h1>
        <p className="muted">Use your Failure email and password.</p>
        <Suspense fallback={<p className="muted">Loading…</p>}>
          <AuthForm mode="login" />
        </Suspense>
        <p className="muted" style={{ marginTop: "1rem" }}>
          New here?{" "}
          <Link className="text-link" href="/signup">
            Create an account
          </Link>
        </p>
      </div>
    </main>
  );
}
