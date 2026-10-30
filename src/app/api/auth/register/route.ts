import { NextResponse } from "next/server";
import { isCrossSite, signIn } from "@/lib/server/auth";
import { errorResponse } from "@/lib/server/http";
import { clientKey, hit } from "@/lib/server/rateLimit";
import { StorageError } from "@/lib/server/storage";
import { createUser, toPublic } from "@/lib/server/users";

/** Create an account and sign in. Body: { email, password }. */
export async function POST(req: Request) {
  try {
    if (isCrossSite(req)) throw new StorageError("Cross-site request blocked", 403);
    const limit = hit(`register:${clientKey(req)}`, 10, 60 * 60 * 1000);
    if (!limit.ok) return NextResponse.json({ error: "Too many sign-ups. Try again later." }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });
    const body = (await req.json().catch(() => null)) as { email?: unknown; password?: unknown } | null;
    if (typeof body?.email !== "string" || typeof body?.password !== "string") throw new StorageError("Email and password are required", 400);
    const user = await createUser(body.email, body.password);
    await signIn(user.id);
    return NextResponse.json({ user: toPublic(user) }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
