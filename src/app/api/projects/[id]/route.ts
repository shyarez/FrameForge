import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { errorResponse } from "@/lib/server/http";
import { deleteProjectExports } from "@/lib/server/metrics";
import { assertId, deleteProject, loadProject, saveProject, StorageError } from "@/lib/server/storage";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  try {
    const user = await requireUser(req);
    const { id } = await params;
    return NextResponse.json({ project: await loadProject(user.id, assertId(id)) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PUT(req: Request, { params }: Ctx) {
  try {
    const user = await requireUser(req);
    const { id } = await params;
    const body = await req.json();
    if (body?.id !== assertId(id)) throw new StorageError("Project id mismatch", 400);
    await loadProject(user.id, id); // must already exist for this user; creation goes through POST /api/projects
    return NextResponse.json({ project: await saveProject(user.id, body) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(req: Request, { params }: Ctx) {
  try {
    const user = await requireUser(req);
    const { id } = await params;
    await loadProject(user.id, assertId(id)); // 404 for other users' projects
    // Exported videos are found through the export log, so remove them before the log goes with the project.
    await deleteProjectExports(user.id, id);
    await deleteProject(user.id, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
