import { randomUUID } from "crypto";
import { PROVIDERS, type ProviderId } from "./config";

export type User = {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  createdAt: string;
};

export type OAuthClient = {
  id: string;
  userId: string;
  name: string;
  clientId: string;
  clientSecretHash: string | null;
  redirectUris: string[];
  public: boolean;
  createdAt: string;
};

export type ProviderConnection = {
  id: string;
  userId: string;
  provider: ProviderId;
  status: "connected" | "pending" | "error";
  label?: string;
  encryptedPayload: string;
  meta?: Record<string, unknown>;
  connectedAt: string;
  updatedAt: string;
};

export type AuthCode = {
  code: string;
  clientId: string;
  userId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: "S256" | "plain";
  scope: string;
  expiresAt: number;
  used: boolean;
};

export type RefreshToken = {
  tokenHash: string;
  clientId: string;
  userId: string;
  scope: string;
  expiresAt: number;
  revoked: boolean;
};

export type Session = {
  id: string;
  userId: string;
  expiresAt: number;
};

export type PendingProviderFlow = {
  id: string;
  userId: string;
  provider: ProviderId;
  encryptedState: string;
  bridgeToken?: string;
  expiresAt: number;
};

type Database = {
  users: User[];
  clients: OAuthClient[];
  connections: ProviderConnection[];
  authCodes: AuthCode[];
  refreshTokens: RefreshToken[];
  sessions: Session[];
  pendingFlows: PendingProviderFlow[];
};

const emptyDb = (): Database => ({
  users: [],
  clients: [],
  connections: [],
  authCodes: [],
  refreshTokens: [],
  sessions: [],
  pendingFlows: [],
});

const STORE_KEY = "failure-oauth:store";
const KNOWN_PROVIDERS = new Set<string>(PROVIDERS.map((p) => p.id));

type KvLike = {
  get: (key: string) => Promise<string | null>;
  put: (key: string, value: string) => Promise<void>;
};

let memoryFallback: Database | null = null;

function isKnownProvider(value: unknown): value is ProviderId {
  return typeof value === "string" && KNOWN_PROVIDERS.has(value);
}

/** Drop legacy/unknown provider rows (e.g. old Cursor connections). */
function sanitizeDb(store: Database): { store: Database; changed: boolean } {
  const beforeConn = store.connections.length;
  const beforeFlows = store.pendingFlows.length;
  store.connections = store.connections.filter((c) =>
    isKnownProvider(c.provider),
  );
  store.pendingFlows = store.pendingFlows.filter((f) =>
    isKnownProvider(f.provider),
  );
  return {
    store,
    changed:
      store.connections.length !== beforeConn ||
      store.pendingFlows.length !== beforeFlows,
  };
}

async function getKv(): Promise<KvLike | null> {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const ctx = await getCloudflareContext({ async: true });
    const kv = (ctx.env as { FAILURE_KV?: KvLike }).FAILURE_KV;
    return kv ?? null;
  } catch {
    return null;
  }
}

async function readDb(): Promise<Database> {
  const kv = await getKv();
  if (kv) {
    const raw = await kv.get(STORE_KEY);
    if (!raw) {
      const fresh = emptyDb();
      await kv.put(STORE_KEY, JSON.stringify(fresh));
      return fresh;
    }
    const parsed = JSON.parse(raw) as Database;
    const { store, changed } = sanitizeDb(parsed);
    if (changed) {
      await kv.put(STORE_KEY, JSON.stringify(store));
    }
    return store;
  }

  // Local/dev fallback: in-memory (optionally hydrated from disk)
  if (memoryFallback) {
    const { store, changed } = sanitizeDb(memoryFallback);
    memoryFallback = store;
    if (changed) await writeDb(store);
    return store;
  }
  try {
    const { existsSync, mkdirSync, readFileSync } = await import("fs");
    const path = await import("path");
    const dir = path.join(process.cwd(), "data");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "store.json");
    if (existsSync(file)) {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as Database;
      const { store, changed } = sanitizeDb(parsed);
      memoryFallback = store;
      if (changed) await writeDb(store);
      return store;
    }
  } catch {
    // ignore fs in restricted runtimes
  }
  memoryFallback = emptyDb();
  return memoryFallback;
}

async function writeDb(dbData: Database) {
  const kv = await getKv();
  if (kv) {
    await kv.put(STORE_KEY, JSON.stringify(dbData));
    return;
  }
  memoryFallback = dbData;
  try {
    const { mkdirSync, writeFileSync } = await import("fs");
    const path = await import("path");
    const dir = path.join(process.cwd(), "data");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "store.json"), JSON.stringify(dbData, null, 2));
  } catch {
    // ignore fs in restricted runtimes
  }
}

async function mutate<T>(fn: (dbData: Database) => T): Promise<T> {
  const dbData = await readDb();
  const result = fn(dbData);
  await writeDb(dbData);
  return result;
}

export const db = {
  async createUser(input: Omit<User, "id" | "createdAt">) {
    return mutate((store) => {
      if (store.users.some((u) => u.email === input.email.toLowerCase())) {
        throw new Error("Email already registered");
      }
      const user: User = {
        id: randomUUID(),
        email: input.email.toLowerCase(),
        passwordHash: input.passwordHash,
        name: input.name,
        createdAt: new Date().toISOString(),
      };
      store.users.push(user);
      return user;
    });
  },

  async findUserByEmail(email: string) {
    const store = await readDb();
    return store.users.find((u) => u.email === email.toLowerCase()) ?? null;
  },

  async findUserById(id: string) {
    const store = await readDb();
    return store.users.find((u) => u.id === id) ?? null;
  },

  async createSession(userId: string, ttlMs = 1000 * 60 * 60 * 24 * 14) {
    return mutate((store) => {
      const session: Session = {
        id: randomUUID(),
        userId,
        expiresAt: Date.now() + ttlMs,
      };
      store.sessions.push(session);
      return session;
    });
  },

  async getSession(id: string) {
    const store = await readDb();
    const session = store.sessions.find((s) => s.id === id);
    if (!session || session.expiresAt < Date.now()) return null;
    return session;
  },

  async deleteSession(id: string) {
    await mutate((store) => {
      store.sessions = store.sessions.filter((s) => s.id !== id);
    });
  },

  async createClient(
    input: Omit<OAuthClient, "id" | "createdAt" | "clientId"> & {
      clientId?: string;
    },
  ) {
    return mutate((store) => {
      const client: OAuthClient = {
        id: randomUUID(),
        clientId: input.clientId ?? `fail_${randomUUID().replace(/-/g, "")}`,
        userId: input.userId,
        name: input.name,
        clientSecretHash: input.clientSecretHash,
        redirectUris: input.redirectUris,
        public: input.public,
        createdAt: new Date().toISOString(),
      };
      store.clients.push(client);
      return client;
    });
  },

  async listClients(userId: string) {
    const store = await readDb();
    return store.clients.filter((c) => c.userId === userId);
  },

  async findClientByClientId(clientId: string) {
    const store = await readDb();
    return store.clients.find((c) => c.clientId === clientId) ?? null;
  },

  async deleteClient(id: string, userId: string) {
    await mutate((store) => {
      store.clients = store.clients.filter(
        (c) => !(c.id === id && c.userId === userId),
      );
    });
  },

  async upsertConnection(
    input: Omit<ProviderConnection, "id" | "connectedAt" | "updatedAt"> & {
      id?: string;
    },
  ) {
    return mutate((store) => {
      const existing = store.connections.find(
        (c) => c.userId === input.userId && c.provider === input.provider,
      );
      const now = new Date().toISOString();
      if (existing) {
        existing.status = input.status;
        existing.label = input.label;
        existing.encryptedPayload = input.encryptedPayload;
        existing.meta = input.meta;
        existing.updatedAt = now;
        return existing;
      }
      const conn: ProviderConnection = {
        id: input.id ?? randomUUID(),
        userId: input.userId,
        provider: input.provider,
        status: input.status,
        label: input.label,
        encryptedPayload: input.encryptedPayload,
        meta: input.meta,
        connectedAt: now,
        updatedAt: now,
      };
      store.connections.push(conn);
      return conn;
    });
  },

  async listConnections(userId: string) {
    const store = await readDb();
    return store.connections.filter(
      (c) => c.userId === userId && isKnownProvider(c.provider),
    );
  },

  /** One-shot / admin: purge removed providers (cursor, chatgpt, …) for all users. */
  async purgeRemovedProviders() {
    return mutate((store) => {
      const before = store.connections.length;
      const { changed } = sanitizeDb(store);
      return {
        changed,
        removed: before - store.connections.length,
        remaining: store.connections.length,
      };
    });
  },

  async getConnection(userId: string, provider: ProviderId) {
    const store = await readDb();
    return (
      store.connections.find(
        (c) => c.userId === userId && c.provider === provider,
      ) ?? null
    );
  },

  async deleteConnection(userId: string, provider: ProviderId) {
    await mutate((store) => {
      store.connections = store.connections.filter(
        (c) => !(c.userId === userId && c.provider === provider),
      );
    });
  },

  async saveAuthCode(code: AuthCode) {
    await mutate((store) => {
      store.authCodes = store.authCodes.filter((c) => c.expiresAt > Date.now());
      store.authCodes.push(code);
    });
  },

  async consumeAuthCode(code: string) {
    return mutate((store) => {
      const row = store.authCodes.find((c) => c.code === code);
      if (!row || row.used || row.expiresAt < Date.now()) return null;
      row.used = true;
      return row;
    });
  },

  async saveRefreshToken(token: RefreshToken) {
    await mutate((store) => {
      store.refreshTokens.push(token);
    });
  },

  async findRefreshToken(tokenHash: string) {
    const store = await readDb();
    return (
      store.refreshTokens.find(
        (t) =>
          t.tokenHash === tokenHash && !t.revoked && t.expiresAt > Date.now(),
      ) ?? null
    );
  },

  async revokeRefreshToken(tokenHash: string) {
    await mutate((store) => {
      const row = store.refreshTokens.find((t) => t.tokenHash === tokenHash);
      if (row) row.revoked = true;
    });
  },

  async savePendingFlow(flow: PendingProviderFlow) {
    await mutate((store) => {
      store.pendingFlows = store.pendingFlows.filter(
        (f) => f.expiresAt > Date.now(),
      );
      store.pendingFlows.push(flow);
    });
  },

  async getPendingFlow(id: string, userId: string) {
    const store = await readDb();
    const flow = store.pendingFlows.find(
      (f) => f.id === id && f.userId === userId,
    );
    if (!flow || flow.expiresAt < Date.now()) return null;
    return flow;
  },

  async getPendingFlowByBridgeToken(flowId: string, bridgeToken: string) {
    const store = await readDb();
    const flow = store.pendingFlows.find(
      (f) =>
        f.id === flowId &&
        f.bridgeToken === bridgeToken &&
        f.expiresAt > Date.now(),
    );
    return flow ?? null;
  },

  async deletePendingFlow(id: string) {
    await mutate((store) => {
      store.pendingFlows = store.pendingFlows.filter((f) => f.id !== id);
    });
  },
};
