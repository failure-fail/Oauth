import { AuthorizeConsent } from "@/components/AuthorizeConsent";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";

export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const user = await getCurrentUser();
  const clientId = params.client_id || "";
  const redirectUri = params.redirect_uri || "";
  const scope =
    params.scope || "openid profile email providers offline_access";
  const state = params.state;
  const client = clientId ? await db.findClientByClientId(clientId) : null;

  if (!clientId || !redirectUri) {
    return (
      <main className="consent-shell">
        <div className="consent-card">
          <h1>Invalid authorize request</h1>
          <p className="muted">
            `client_id` and `redirect_uri` are required for Failure PKCE OAuth.
          </p>
        </div>
      </main>
    );
  }

  if (!client) {
    return (
      <main className="consent-shell">
        <div className="consent-card">
          <h1>Unknown application</h1>
          <p className="muted">
            No Failure OAuth app is registered for client_id{" "}
            <code>{clientId}</code>.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="consent-shell">
      <AuthorizeConsent
        clientId={client.clientId}
        redirectUri={redirectUri}
        scope={scope}
        state={state}
        appName={client.name}
        loggedIn={Boolean(user)}
      />
    </main>
  );
}
