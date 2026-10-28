import { NextResponse } from "next/server";
import { getJob } from "@/lib/server/exportJobs";

type Ctx = { params: Promise<{ jobId: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { jobId } = await params;
  const job = getJob(jobId);
  if (!job) return NextResponse.json({ error: "Export job not found" }, { status: 404 });
  return NextResponse.json({ job });
}
