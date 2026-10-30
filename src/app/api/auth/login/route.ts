import { NextResponse } from "next/server";
import { isCrossSite, signIn } from "@/lib/server/auth";
import { errorResponse } from "@/lib/server/http";
import { clear, clientKey, hit } from "@/lib/server/rateLimit";
import { StorageError } from "@/lib/server/storage";
import { authenticate, toPublic } from "@/lib/server/users";

const WINDOW = 15 * 60 * 1000;

/** Sign in. Body: { email, password }. One generic error for any wrong credentials. */
export async function POST(req: Request) {
  try {
    if (isCrossSite(req)) throw new StorageError("Cross-site request blocked", 403);
    const body = (await req.json().catch(() => null)) as { email?: unknown; password?: unknown } | null;
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase().slice(0, 254) : "";
    const password = typeof body?.password === "string" ? body.password : "";
    // Limit per client and per account, so one address cannot spray guesses at many accounts or vice versa.
    for (const key of [`login-ip:${clientKey(req)}`, `login-email:${email}`]) {
      const limit = hit(key, key.startsWith("login-ip") ? 30 : 10, WINDOW);
      if (!limit.ok) return NextResponse.json({ error: "Too many sign-in attempts. Try again later." }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });
    }
    const user = email && password ? await authenticate(email, password) : null;
    if (!user) throw new StorageError("Invalid email or password", 401);
    clear(`login-email:${email}`);
    await signIn(user.id);
    return NextResponse.json({ user: toPublic(user) });
  } catch (err) {
    return errorResponse(err);
  }
}
