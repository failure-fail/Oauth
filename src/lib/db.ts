import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type { ProviderId } from "./config";

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

function dbPath() {
  const dir = path.join(process.cwd(), "data");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return path.join(dir, "store.json");
}

let cache: Database | null = null;

function readDb(): Database {
  if (cache) return cache;
  const file = dbPath();
  if (!existsSync(file)) {
    cache = emptyDb();
    writeDb(cache);
    return cache;
  }
  cache = JSON.parse(readFileSync(file, "utf8")) as Database;
  return cache;
}

function writeDb(db: Database) {
  cache = db;
  writeFileSync(dbPath(), JSON.stringify(db, null, 2));
}

function mutate<T>(fn: (db: Database) => T): T {
  const db = readDb();
  const result = fn(db);
  writeDb(db);
  return result;
}

export const db = {
  createUser(input: Omit<User, "id" | "createdAt">) {
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

  findUserByEmail(email: string) {
    return readDb().users.find((u) => u.email === email.toLowerCase()) ?? null;
  },

  findUserById(id: string) {
    return readDb().users.find((u) => u.id === id) ?? null;
  },

  createSession(userId: string, ttlMs = 1000 * 60 * 60 * 24 * 14) {
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

  getSession(id: string) {
    const session = readDb().sessions.find((s) => s.id === id);
    if (!session || session.expiresAt < Date.now()) return null;
    return session;
  },

  deleteSession(id: string) {
    mutate((store) => {
      store.sessions = store.sessions.filter((s) => s.id !== id);
    });
  },

  createClient(
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

  listClients(userId: string) {
    return readDb().clients.filter((c) => c.userId === userId);
  },

  findClientByClientId(clientId: string) {
    return readDb().clients.find((c) => c.clientId === clientId) ?? null;
  },

  deleteClient(id: string, userId: string) {
    mutate((store) => {
      store.clients = store.clients.filter(
        (c) => !(c.id === id && c.userId === userId),
      );
    });
  },

  upsertConnection(
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

  listConnections(userId: string) {
    return readDb().connections.filter((c) => c.userId === userId);
  },

  getConnection(userId: string, provider: ProviderId) {
    return (
      readDb().connections.find(
        (c) => c.userId === userId && c.provider === provider,
      ) ?? null
    );
  },

  deleteConnection(userId: string, provider: ProviderId) {
    mutate((store) => {
      store.connections = store.connections.filter(
        (c) => !(c.userId === userId && c.provider === provider),
      );
    });
  },

  saveAuthCode(code: AuthCode) {
    mutate((store) => {
      store.authCodes = store.authCodes.filter((c) => c.expiresAt > Date.now());
      store.authCodes.push(code);
    });
  },

  consumeAuthCode(code: string) {
    return mutate((store) => {
      const row = store.authCodes.find((c) => c.code === code);
      if (!row || row.used || row.expiresAt < Date.now()) return null;
      row.used = true;
      return row;
    });
  },

  saveRefreshToken(token: RefreshToken) {
    mutate((store) => {
      store.refreshTokens.push(token);
    });
  },

  findRefreshToken(tokenHash: string) {
    return (
      readDb().refreshTokens.find(
        (t) => t.tokenHash === tokenHash && !t.revoked && t.expiresAt > Date.now(),
      ) ?? null
    );
  },

  revokeRefreshToken(tokenHash: string) {
    mutate((store) => {
      const row = store.refreshTokens.find((t) => t.tokenHash === tokenHash);
      if (row) row.revoked = true;
    });
  },

  savePendingFlow(flow: PendingProviderFlow) {
    mutate((store) => {
      store.pendingFlows = store.pendingFlows.filter(
        (f) => f.expiresAt > Date.now(),
      );
      store.pendingFlows.push(flow);
    });
  },

  getPendingFlow(id: string, userId: string) {
    const flow = readDb().pendingFlows.find(
      (f) => f.id === id && f.userId === userId,
    );
    if (!flow || flow.expiresAt < Date.now()) return null;
    return flow;
  },

  deletePendingFlow(id: string) {
    mutate((store) => {
      store.pendingFlows = store.pendingFlows.filter((f) => f.id !== id);
    });
  },
};
