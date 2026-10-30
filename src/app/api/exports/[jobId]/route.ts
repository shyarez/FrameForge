import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { getJob } from "@/lib/server/exportJobs";
import { errorResponse } from "@/lib/server/http";

type Ctx = { params: Promise<{ jobId: string }> };

export async function GET(req: Request, { params }: Ctx) {
  try {
    const user = await requireUser(req);
    const { jobId } = await params;
    const job = getJob(user.id, jobId);
    if (!job) return NextResponse.json({ error: "Export job not found" }, { status: 404 });
    return NextResponse.json({ job });
  } catch (err) {
    return errorResponse(err);
  }
}
