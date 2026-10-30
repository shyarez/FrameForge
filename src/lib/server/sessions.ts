import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { safePath, StorageError } from "./storage";
import { getUser, type User } from "./users";

/**
 * Server-side sessions. The browser holds a random token in an HttpOnly cookie; the server stores
 * only its SHA-256 hash (data/sessions/<hash>.json), so the data folder alone cannot be used to sign
 * in, and deleting the file revokes the session immediately.
 */

export const SESSION_COOKIE = "ff_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface SessionRecord {
  userId: string;
  createdAt: string;
  expiresAt: string;
}

const HASH_RE = /^[a-f0-9]{64}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/; // 32 bytes, base64url

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const sessionFile = (hash: string) => {
  if (!HASH_RE.test(hash)) throw new StorageError("Invalid session", 400);
  return safePath("sessions", `${hash}.json`);
};

export async function createSession(userId: string, ttlMs = SESSION_TTL_MS): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  const record: SessionRecord = { userId, createdAt: new Date(now).toISOString(), expiresAt: new Date(now + ttlMs).toISOString() };
  const file = sessionFile(hashToken(token));
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(record));
  return { token, expiresAt: new Date(record.expiresAt) };
}

/** The user id for a valid, unexpired session token; expired sessions are deleted on sight. */
export async function getSessionUserId(token: string | undefined): Promise<string | null> {
  if (!token || !TOKEN_RE.test(token)) return null;
  const file = sessionFile(hashToken(token));
  const raw = await fs.readFile(file, "utf8").catch(() => null);
  if (!raw) return null;
  const record = JSON.parse(raw) as SessionRecord;
  if (Date.parse(record.expiresAt) <= Date.now()) {
    await fs.rm(file, { force: true });
    return null;
  }
  return record.userId;
}

export async function revokeSession(token: string | undefined): Promise<void> {
  if (!token || !TOKEN_RE.test(token)) return;
  await fs.rm(sessionFile(hashToken(token)), { force: true });
}

/** Cookie settings for the session token. Secure is on outside development (localhost is http). */
export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  };
}

/** Resolve the signed-in user from a session token (null when signed out or expired). */
export async function userFromToken(token: string | undefined): Promise<User | null> {
  const id = await getSessionUserId(token);
  return id ? getUser(id) : null;
}
