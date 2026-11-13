import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { errorResponse } from "@/lib/server/http";
import { getShortJob } from "@/lib/server/shorts";
import { StorageError } from "@/lib/server/storage";

type Ctx = { params: Promise<{ jobId: string }> };

/** Progress of a short-video generation (only visible to the user who started it). */
export async function GET(req: Request, { params }: Ctx) {
  try {
    const user = await requireUser(req);
    const { jobId } = await params;
    const job = getShortJob(user.id, jobId);
    if (!job) throw new StorageError("Job not found", 404);
    return NextResponse.json({ job });
  } catch (err) {
    return errorResponse(err);
  }
}
