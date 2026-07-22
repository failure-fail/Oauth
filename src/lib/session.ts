import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { config } from "./config";
import { db, type User } from "./db";

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export async function createUserSession(user: User) {
  const session = db.createSession(user.id);
  const jar = await cookies();
  jar.set(config.sessionCookie, session.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(session.expiresAt),
  });
  return session;
}

export async function destroyUserSession() {
  const jar = await cookies();
  const id = jar.get(config.sessionCookie)?.value;
  if (id) db.deleteSession(id);
  jar.delete(config.sessionCookie);
}

export async function getCurrentUser(): Promise<User | null> {
  const jar = await cookies();
  const id = jar.get(config.sessionCookie)?.value;
  if (!id) return null;
  const session = db.getSession(id);
  if (!session) return null;
  return db.findUserById(session.userId);
}

export function publicUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    createdAt: user.createdAt,
  };
}
