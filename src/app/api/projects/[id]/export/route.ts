import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { startExport } from "@/lib/server/exportJobs";
import { errorResponse } from "@/lib/server/http";
import { assertId, loadProject } from "@/lib/server/storage";

type Ctx = { params: Promise<{ id: string }> };

/** Exports the project as last saved on disk, so the MP4 always matches a persisted document. */
export async function POST(req: Request, { params }: Ctx) {
  try {
    const user = await requireUser(req);
    const { id } = await params;
    const project = await loadProject(user.id, assertId(id));
    const job = startExport(user.id, project, new URL(req.url).origin);
    return NextResponse.json({ job }, { status: 202 });
  } catch (err) {
    return errorResponse(err);
  }
}
