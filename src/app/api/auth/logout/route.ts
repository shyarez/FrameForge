import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { isCrossSite } from "@/lib/server/auth";
import { errorResponse } from "@/lib/server/http";
import { revokeSession, SESSION_COOKIE } from "@/lib/server/sessions";
import { StorageError } from "@/lib/server/storage";

/** Revoke the current session and clear the cookie. */
export async function POST(req: Request) {
  try {
    if (isCrossSite(req)) throw new StorageError("Cross-site request blocked", 403);
    const store = await cookies();
    await revokeSession(store.get(SESSION_COOKIE)?.value);
    store.delete(SESSION_COOKIE);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
