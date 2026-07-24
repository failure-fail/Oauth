import { redirect } from "next/navigation";
import Link from "next/link";
import type { CSSProperties } from "react";
import { getCurrentUser } from "@/lib/session";
import { db } from "@/lib/db";
import { connectionPublicView } from "@/lib/providers";
import { AppsManager } from "@/components/AppsManager";
import { FailureButtonCard } from "@/components/SignInWithFailure";
import { AccountNav } from "@/components/AccountNav";
import { PROVIDERS } from "@/lib/providers-meta";

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const connections = (await db.listConnections(user.id)).map(
    connectionPublicView,
  );
  const apps = (await db.listClients(user.id)).map((c) => ({
    id: c.id,
    name: c.name,
    clientId: c.clientId,
    redirectUris: c.redirectUris,
    public: c.public,
    createdAt: c.createdAt,
  }));

  return (
    <main className="page dashboard-grid">
      <AccountNav active="overview" />

      <section className="providers-hero">
        <p className="eyebrow">Dashboard</p>
        <h1 className="page-title">{user.name}</h1>
        <p className="muted">
          Linked providers, live chat tests, OpenAI-compatible <code>/v1</code>{" "}
          access, and the apps that consume Failure OAuth.
        </p>
      </section>

      <section className="dash-provider-summary">
        <div className="dash-provider-summary__copy">
          <h2>
            {connections.length}/{PROVIDERS.length} providers linked
          </h2>
          <p className="muted">
            Connect once. Test in Chat, or call{" "}
            <code>/v1/chat/completions</code> with an OpenAI SDK.
          </p>
        </div>
        <div className="dash-provider-summary__pills">
          {PROVIDERS.map((p) => {
            const on = connections.some((c) => c.provider === p.id);
            return (
              <span
                key={p.id}
                className={`dash-pill ${on ? "on" : "off"}`}
                style={{ "--provider-accent": p.accent } as CSSProperties}
              >
                {p.name}
              </span>
            );
          })}
        </div>
        <div className="hero-cta">
          <Link className="btn-primary" href="/dashboard/chat">
            Open live chat
          </Link>
          <Link className="btn-secondary" href="/dashboard/openai">
            OpenAI API
          </Link>
          <Link className="btn-secondary" href="/account/providers">
            Configure providers
          </Link>
        </div>
      </section>

      <section id="apps">
        <h2 className="section-title">Apps</h2>
        <p className="muted">
          Register a public PKCE client, then drop Sign in with Failure into
          your product.
        </p>
        <AppsManager initialApps={apps} />
      </section>

      <section>
        <h2 className="section-title">Button kit</h2>
        <FailureButtonCard />
      </section>
    </main>
  );
}
