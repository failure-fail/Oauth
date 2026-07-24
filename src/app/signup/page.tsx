import { Suspense } from "react";
import { AuthForm } from "@/components/AuthForm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const user = await getCurrentUser();
  const params = await searchParams;
  if (user) redirect(params.next || "/dashboard");

  const loginHref = params.next
    ? `/login?next=${encodeURIComponent(params.next)}`
    : "/login";

  return (
    <main className="auth-shell">
      <div className="auth-card">
        <p className="eyebrow">Failure AI OAuth</p>
        <h1>Create your account</h1>
        <p className="muted">
          Email + password first. Then connect your AI providers.
        </p>
        <Suspense fallback={<p className="muted">Loading…</p>}>
          <AuthForm mode="signup" />
        </Suspense>
        <p className="auth-footer muted">
          Already have an account?{" "}
          <Link className="text-link" href={loginHref}>
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
