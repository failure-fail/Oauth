import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { db } from "@/lib/db";
import { connectionPublicView } from "@/lib/providers";
import { AccountNav } from "@/components/AccountNav";
import { ChatPanel } from "@/components/ChatPanel";

export default async function DashboardChatPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/dashboard/chat");

  const connections = (await db.listConnections(user.id)).map(
    connectionPublicView,
  );

  return (
    <main className="page">
      <AccountNav active="chat" />
      <section className="providers-hero">
        <p className="eyebrow">Dashboard · Test</p>
        <h1 className="page-title">Chat</h1>
        <p className="muted">
          Send a quick prompt through a connected provider to verify Failure
          OAuth credentials.
        </p>
      </section>
      <ChatPanel initialConnections={connections} />
    </main>
  );
}
