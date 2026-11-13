import "server-only";
import { cookies } from "next/headers";
import { SESSION_COOKIE, sessionCookieOptions, createSession, userFromToken } from "./sessions";
import { StorageError } from "./storage";
import type { User } from "./users";

/**
 * Request-level auth helpers for route handlers. Route handlers are the security boundary:
 * every data route calls requireUser(); the proxy only redirects signed-out page visits.
 */

/** Reject state-changing requests sent from another site (CSRF defence alongside SameSite=Lax cookies). */
export function isCrossSite(req: Request): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return false;
  const origin = req.headers.get("origin");
  if (!origin) return false; // non-browser clients and same-origin navigations without Origin
  try {
    return new URL(origin).host !== new URL(req.url).host;
  } catch {
    return true;
  }
}

export async function currentUser(): Promise<User | null> {
  const store = await cookies();
  return userFromToken(store.get(SESSION_COOKIE)?.value);
}

/** The signed-in user, or a 401. Also rejects cross-site writes with a 403. */
export async function requireUser(req: Request): Promise<User> {
  if (isCrossSite(req)) throw new StorageError("Cross-site request blocked", 403);
  const user = await currentUser();
  if (!user) throw new StorageError("Please sign in", 401);
  return user;
}

/** Start a session for a user and set the cookie on the response. */
export async function signIn(userId: string): Promise<void> {
  const { token, expiresAt } = await createSession(userId);
  (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
}
