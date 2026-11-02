import { NextResponse } from "next/server";
import { isCrossSite, signIn } from "@/lib/server/auth";
import { devLoginEnabled, getOrCreateDevUser } from "@/lib/server/devLogin";
import { errorResponse } from "@/lib/server/http";
import { StorageError } from "@/lib/server/storage";
import { toPublic } from "@/lib/server/users";

/** Whether the developer shortcut is available (the sign-in page shows its button only then). */
export async function GET(req: Request) {
  return NextResponse.json({ enabled: devLoginEnabled(req) });
}

/** Sign in as the developer account. 404 whenever the shortcut is not enabled, so it is invisible in production. */
export async function POST(req: Request) {
  try {
    if (!devLoginEnabled(req)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (isCrossSite(req)) throw new StorageError("Cross-site request blocked", 403);
    const user = await getOrCreateDevUser();
    await signIn(user.id);
    return NextResponse.json({ user: toPublic(user) });
  } catch (err) {
    return errorResponse(err);
  }
}
