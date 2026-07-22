import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { db } from "@/lib/db";
import { connectionPublicView } from "@/lib/providers";
import { ProviderConnectors } from "@/components/ProviderConnectors";
import { AppsManager } from "@/components/AppsManager";
import { FailureButtonCard } from "@/components/SignInWithFailure";

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const connections = db.listConnections(user.id).map(connectionPublicView);
  const apps = db.listClients(user.id).map((c) => ({
    id: c.id,
    name: c.name,
    clientId: c.clientId,
    redirectUris: c.redirectUris,
    public: c.public,
    createdAt: c.createdAt,
  }));

  return (
    <main className="page dashboard-grid">
      <section>
        <p className="eyebrow">Dashboard</p>
        <h1 className="page-title">Hey, {user.name}</h1>
        <p className="muted">
          Connect your AI providers, then register apps that can Sign in with
          Failure.
        </p>
      </section>

      <section>
        <h2>Connected providers</h2>
        <p className="muted">
          These credentials stay encrypted at rest and are only released to apps
          you authorize with the <code>providers</code> scope.
        </p>
        <ProviderConnectors initialConnections={connections} />
      </section>

      <section>
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
