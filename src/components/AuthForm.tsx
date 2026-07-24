"use client";

import { FormEvent, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const payload: Record<string, string> = {
      email: String(form.get("email") || ""),
      password: String(form.get("password") || ""),
    };
    if (mode === "signup") {
      payload.name = String(form.get("name") || "");
    }
    const res = await fetch(`/api/auth/${mode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(data.error || "Something went wrong");
      return;
    }
    router.push(searchParams.get("next") || "/dashboard");
    router.refresh();
  }

  return (
    <form className="auth-form" onSubmit={onSubmit}>
      {mode === "signup" && (
        <label>
          <span>Name</span>
          <input name="name" required placeholder="Your name" autoComplete="name" />
        </label>
      )}
      <label>
        <span>Email</span>
        <input
          name="email"
          type="email"
          required
          placeholder="you@example.com"
          autoComplete="email"
        />
      </label>
      <label>
        <span>Password</span>
        <input
          name="password"
          type="password"
          required
          minLength={8}
          placeholder="At least 8 characters"
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
        />
      </label>
      {error && <p className="form-error">{error}</p>}
      <button className="btn-primary" type="submit" disabled={loading}>
        {loading
          ? "Working…"
          : mode === "signup"
            ? "Create Failure account"
            : "Sign in"}
      </button>
    </form>
  );
}
