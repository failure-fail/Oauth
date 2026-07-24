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
          Create a Failure API key (<code>fsk_…</code>), set it as{" "}
          <code>OPENAI_API_KEY</code>, and point any OpenAI SDK at{" "}
          <code>/v1</code> with model ids like <code>codex/gpt-5.6-sol</code>.
        </p>
      </section>
      <OpenAiApiPanel
        baseUrl={config.baseUrl}
        connections={connections}
      />
    </main>
  );
}
