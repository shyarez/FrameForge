import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { errorResponse } from "@/lib/server/http";
import { PROVIDER_NAMES, stockProviders } from "@/lib/server/stock";
import { listVoices, voiceStatus } from "@/lib/server/voice";
import { writerStatus } from "@/lib/server/writer";

/** What the short-video generator can use right now: voice engine, script writer, stock footage. */
export async function GET(req: Request) {
  try {
    await requireUser(req);
    const [voice, writer] = await Promise.all([voiceStatus(), writerStatus()]);
    const voices = voice.connected ? await listVoices().catch(() => []) : [];
    const providers = stockProviders().map((p) => PROVIDER_NAMES[p]);
    return NextResponse.json({ voice, voices, writer, stock: { configured: providers.length > 0, providers } });
  } catch (err) {
    return errorResponse(err);
  }
}
