import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { errorResponse } from "@/lib/server/http";
import { voiceStatus } from "@/lib/server/voice";
import { writerStatus } from "@/lib/server/writer";

/** Whether the local voice engine (VoiceStudio) and narration writer (Ollama) are reachable. */
export async function GET(req: Request) {
  try {
    await requireUser(req);
    const [voice, writer] = await Promise.all([voiceStatus(), writerStatus()]);
    return NextResponse.json({ voice, writer });
  } catch (err) {
    return errorResponse(err);
  }
}
