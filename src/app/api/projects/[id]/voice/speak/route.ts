import { NextResponse } from "next/server";
import { z } from "zod";
import { saveAsset } from "@/lib/server/assets";
import { requireUser } from "@/lib/server/auth";
import { errorResponse } from "@/lib/server/http";
import { hit } from "@/lib/server/rateLimit";
import { assertId, loadProject, StorageError } from "@/lib/server/storage";
import { speak } from "@/lib/server/voice";

type Ctx = { params: Promise<{ id: string }> };

const Body = z.object({
  text: z.string().trim().min(1).max(4096),
  voice: z.string().max(200),
  speed: z.number().min(0.25).max(4),
  language: z.string().max(40).optional(),
  description: z.string().max(500).optional(),
});

/** Synthesize a voice-over and store it as a project audio asset. */
export async function POST(req: Request, { params }: Ctx) {
  try {
    const user = await requireUser(req);
    const { id } = await params;
    await loadProject(user.id, assertId(id));
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) throw new StorageError(`Invalid request: ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}`, 400);
    const limit = hit(`speak:${user.id}`, 60, 60_000);
    if (!limit.ok) throw new StorageError(`Too many voice requests; try again in ${limit.retryAfter}s`, 429);
    const audio = await speak(parsed.data);
    // Stored like an upload: checked by content and fully decoded before it is accepted.
    const asset = await saveAsset(user.id, id, audio);
    return NextResponse.json({ asset }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
