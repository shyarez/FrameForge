import "server-only";
import { randomBytes } from "node:crypto";
import { adoptLegacyData } from "./migrate";
import { createUser, findUserByEmail, type User } from "./users";

/**
 * Development-only sign-in shortcut. Enabled only when ALL of these hold:
 *  - FF_DEV_LOGIN=1 is set (e.g. in .env.local, which git ignores);
 *  - the app is not a production build (NODE_ENV !== "production");
 *  - the request is addressed to localhost.
 * It signs in as a fixed developer account, so there is no shared password to leak.
 */

export const DEV_EMAIL = "dev@frameforge.local";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function devLoginEnabled(req: Request): boolean {
  if (process.env.NODE_ENV === "production") return false;
  if (process.env.FF_DEV_LOGIN !== "1") return false;
  // Next.js builds req.url from its own listening address, so use the Host the browser actually sent.
  // (Host can be forged by a determined client; the env flag and dev-only mode are the real guarantees.)
  const host = req.headers.get("host") ?? new URL(req.url).host;
  return LOCAL_HOSTS.has(new URL(`http://${host}`).hostname);
}

/** The developer account, created on first use with an unguessable random password (password sign-in is never needed). */
export async function getOrCreateDevUser(): Promise<User> {
  const existing = await findUserByEmail(DEV_EMAIL);
  if (existing) return existing;
  try {
    // Like any first account, it adopts projects created before accounts existed.
    return await createUser(DEV_EMAIL, randomBytes(32).toString("base64url"), (u) => adoptLegacyData(u.id));
  } catch {
    // Another request created it concurrently.
    const again = await findUserByEmail(DEV_EMAIL);
    if (again) return again;
    throw new Error("Could not create the developer account");
  }
}
