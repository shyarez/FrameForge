import { NextResponse } from "next/server";
import { z } from "zod";
import { generateStory } from "@/lib/data/story";
import { AspectRatioSchema } from "@/lib/schema/project";
import { loadDataset } from "@/lib/server/datasets";
import { errorResponse } from "@/lib/server/http";
import { assertId, StorageError } from "@/lib/server/storage";

type Ctx = { params: Promise<{ id: string; datasetId: string }> };

const Body = z.object({
  roles: z.object({ measure: z.string().optional(), category: z.string().optional(), order: z.string().optional() }),
  aspectRatio: AspectRatioSchema,
});

/** Generate an editable story from the stored dataset version. All numbers are computed here. */
export async function POST(req: Request, { params }: Ctx) {
  try {
    const { id, datasetId } = await params;
    const body = Body.safeParse(await req.json().catch(() => null));
    if (!body.success) throw new StorageError("Invalid story request", 400);
    const { meta, table, version, hash } = await loadDataset(assertId(id), datasetId);
    try {
      const story = generateStory(table, { id: meta.id, name: meta.name, version, hash }, body.data.roles, body.data.aspectRatio, { now: new Date().toISOString() });
      return NextResponse.json({ story });
    } catch (e) {
      throw new StorageError(e instanceof Error ? e.message : String(e), 422);
    }
  } catch (err) {
    return errorResponse(err);
  }
}
