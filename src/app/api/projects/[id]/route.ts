import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/server/http";
import { assertId, deleteProject, loadProject, saveProject, StorageError } from "@/lib/server/storage";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    return NextResponse.json({ project: await loadProject(assertId(id)) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PUT(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const body = await req.json();
    if (body?.id !== assertId(id)) throw new StorageError("Project id mismatch", 400);
    await loadProject(id); // must already exist; creation goes through POST /api/projects
    return NextResponse.json({ project: await saveProject(body) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    await deleteProject(assertId(id));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
