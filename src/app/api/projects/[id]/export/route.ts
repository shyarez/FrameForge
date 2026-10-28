import { NextResponse } from "next/server";
import { startExport } from "@/lib/server/exportJobs";
import { errorResponse } from "@/lib/server/http";
import { assertId, loadProject } from "@/lib/server/storage";

type Ctx = { params: Promise<{ id: string }> };

/** Exports the project as last saved on disk, so the MP4 always matches a persisted document. */
export async function POST(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const project = await loadProject(assertId(id));
    const job = startExport(project, new URL(req.url).origin);
    return NextResponse.json({ job }, { status: 202 });
  } catch (err) {
    return errorResponse(err);
  }
}
