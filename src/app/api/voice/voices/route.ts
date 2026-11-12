import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { errorResponse } from "@/lib/server/http";
import { listVoices } from "@/lib/server/voice";

export async function GET(req: Request) {
  try {
    await requireUser(req);
    return NextResponse.json({ voices: await listVoices() });
  } catch (err) {
    return errorResponse(err);
  }
}
