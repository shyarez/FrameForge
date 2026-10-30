import { NextResponse } from "next/server";
import { currentUser } from "@/lib/server/auth";
import { errorResponse } from "@/lib/server/http";
import { toPublic } from "@/lib/server/users";

/** The signed-in user, or 401. */
export async function GET() {
  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    return NextResponse.json({ user: toPublic(user) });
  } catch (err) {
    return errorResponse(err);
  }
}
