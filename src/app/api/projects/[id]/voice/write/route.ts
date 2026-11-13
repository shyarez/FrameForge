import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { errorResponse } from "@/lib/server/http";
import { hit } from "@/lib/server/rateLimit";
import { assertId, loadProject, StorageError } from "@/lib/server/storage";
import { writeNarration } from "@/lib/server/writer";

type Ctx = { params: Promise<{ id: string }> };

const Body = z.object({
  text: z.string().trim().min(1).max(8000),
  style: z.string().max(200).optional(),
  language: z.string().max(40).optional(),
});

/** Turn a scene's on-screen text into spoken narration with the local Ollama model. */
export async function POST(req: Request, { params }: Ctx) {
  try {
    const user = await requireUser(req);
    const { id } = await params;
    await loadProject(user.id, assertId(id));
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) throw new StorageError("Expected { text }", 400);
    const limit = hit(`write:${user.id}`, 30, 60_000);
    if (!limit.ok) throw new StorageError(`Too many requests; try again in ${limit.retryAfter}s`, 429);
    const text = await writeNarration(parsed.data.text, { style: parsed.data.style, language: parsed.data.language });
    return NextResponse.json({ text });
  } catch (err) {
    return errorResponse(err);
  }
}
