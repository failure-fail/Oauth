import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { db } from "@/lib/db";
import { connectionPublicView } from "@/lib/providers";
import { AccountNav } from "@/components/AccountNav";
import { OpenAiApiPanel } from "@/components/OpenAiApiPanel";
import { config } from "@/lib/config";

export default async function DashboardOpenAiPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/dashboard/openai");

  const connections = (await db.listConnections(user.id)).map(
    connectionPublicView,
  );

  return (
    <main className="page">
      <AccountNav active="openai" />
      <section className="providers-hero">
        <p className="eyebrow">Dashboard · Integrate</p>
        <h1 className="page-title">OpenAI API</h1>
        <p className="muted">
          Use Failure as an OpenAI-compatible base URL. Your apps (or a
          dashboard test token) call <code>/v1/chat/completions</code> with
          model ids like <code>codex/gpt-5.6-sol</code>.
        </p>
      </section>
      <OpenAiApiPanel
        baseUrl={config.baseUrl}
        connections={connections}
      />
    </main>
  );
}
