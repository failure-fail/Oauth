import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { db } from "@/lib/db";
import { connectionPublicView } from "@/lib/providers";
import { ProvidersConfig } from "@/components/ProvidersConfig";
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
      <div className="account-subnav">
        <Link href="/dashboard">Overview</Link>
        <Link href="/account/providers" className="is-active">
          Providers
        </Link>
        <Link href="/dashboard#apps">Apps</Link>
      </div>

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
