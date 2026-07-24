import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { db } from "@/lib/db";
import { connectionPublicView } from "@/lib/providers";
import { ProvidersConfig } from "@/components/ProvidersConfig";
import { AccountNav } from "@/components/AccountNav";
import { PROVIDERS } from "@/lib/providers-meta";

export default async function AccountProvidersPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/account/providers");

  const connections = (await db.listConnections(user.id)).map(
    connectionPublicView,
  );
  const connectedCount = connections.length;

  return (
    <main className="page">
      <AccountNav active="providers" />

      <section className="providers-hero">
        <p className="eyebrow">Account · Config</p>
        <h1 className="page-title">Providers</h1>
        <p className="muted">
          Connect the AI tools Failure can hand to apps you authorize.{" "}
          {connectedCount}/{PROVIDERS.length} linked.
        </p>
      </section>

      <ProvidersConfig initialConnections={connections} />
    </main>
  );
}
