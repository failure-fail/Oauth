"use client";

import { FormEvent, useState } from "react";

type AppRow = {
  id: string;
  name: string;
  clientId: string;
  redirectUris: string[];
  public: boolean;
  createdAt: string;
  clientSecret?: string | null;
};

export function AppsManager({ initialApps }: { initialApps: AppRow[] }) {
  const [apps, setApps] = useState(initialApps);
  const [name, setName] = useState("");
  const [redirectUri, setRedirectUri] = useState(
    "http://localhost:3000/callback",
  );
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [createdClientId, setCreatedClientId] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch("/api/apps");
    const data = await res.json();
    setApps(data.apps || []);
  }

  async function copy(text: string, label: string) {
    await navigator.clipboard.writeText(text);
    setNotice(`${label} copied.`);
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setCreatedClientId(null);
    const res = await fetch("/api/apps", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        redirectUris: [redirectUri],
        publicClient: true,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Failed to create app");
      return;
    }
    setCreatedClientId(data.app.clientId || null);
    setNotice("Public PKCE app registered. Copy the client id below.");
    setName("");
    await refresh();
  }

  return (
    <div className="apps-manager">
      <form className="apps-form" onSubmit={onCreate}>
        <label>
          <span>App name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My AI app"
            required
          />
        </label>
        <label>
          <span>Redirect URI</span>
          <input
            value={redirectUri}
            onChange={(e) => setRedirectUri(e.target.value)}
            placeholder="https://yourapp.com/callback"
            required
          />
        </label>
        <button className="btn-primary" type="submit">
          Register public PKCE app
        </button>
      </form>
      {error && <p className="form-error">{error}</p>}
      {notice && <p className="notice">{notice}</p>}
      {createdClientId && (
        <p className="notice notice--row">
          <span>
            Client id: <code>{createdClientId}</code>
          </span>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => copy(createdClientId, "Client id")}
          >
            Copy
          </button>
        </p>
      )}
      <div className="apps-list">
        {apps.map((app) => (
          <article key={app.id} className="app-row">
            <div>
              <h4>{app.name}</h4>
              <p className="app-row__id">
                <code>{app.clientId}</code>
                <button
                  type="button"
                  className="btn-ghost btn-ghost--compact"
                  onClick={() => copy(app.clientId, "Client id")}
                >
                  Copy
                </button>
              </p>
              <p className="muted">{app.redirectUris.join(", ")}</p>
              <p className="muted app-row__meta">
                {app.public ? "Public PKCE client" : "Confidential client"}
              </p>
            </div>
            <button
              type="button"
              className="btn-ghost"
              onClick={async () => {
                await fetch(`/api/apps?id=${app.id}`, { method: "DELETE" });
                await refresh();
              }}
            >
              Remove
            </button>
          </article>
        ))}
        {apps.length === 0 && (
          <p className="muted">No apps yet. Register one to get a client_id.</p>
        )}
      </div>
    </div>
  );
}
