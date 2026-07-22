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

      <section>
        <p className="eyebrow">Dashboard</p>
        <h1 className="page-title">Hey, {user.name}</h1>
        <p className="muted">
          Manage your Failure account, linked providers, and OAuth apps.
        </p>
      </section>

      <section className="dash-provider-summary">
        <div className="dash-provider-summary__copy">
          <h2>Providers</h2>
          <p className="muted">
            {connections.length}/{PROVIDERS.length} connected. Configure Codex,
            ChatGPT, Claude Code, and Grok Build from your account
            providers page — then try them in Chat.
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
            Open chat test
          </Link>
          <Link className="btn-secondary" href="/account/providers">
            Providers config
          </Link>
        </div>
      </section>

      <section id="apps">
        <h2>Your apps</h2>
        <p className="muted">
          Register a public PKCE client, then drop the Failure button into your
          product.
        </p>
        <AppsManager initialApps={apps} />
      </section>

      <section>
        <h2>Button for other apps</h2>
        <FailureButtonCard />
      </section>
    </main>
  );
}
