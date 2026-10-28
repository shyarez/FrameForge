import { promises as fs } from "node:fs";
import { NextResponse } from "next/server";
import { getJob } from "@/lib/server/exportJobs";
import { errorResponse } from "@/lib/server/http";
import { assertId, exportFile } from "@/lib/server/storage";

type Ctx = { params: Promise<{ jobId: string }> };

export async function GET(req: Request, { params }: Ctx) {
  try {
    const { jobId } = await params;
    const file = exportFile(assertId(jobId));
    const data = await fs.readFile(file).catch(() => null);
    if (!data) return NextResponse.json({ error: "Export file not found" }, { status: 404 });
    const name = (getJob(jobId)?.projectName ?? "frameforge").replace(/[^\w.-]+/g, "_").slice(0, 60) || "frameforge";
    const download = new URL(req.url).searchParams.has("download");
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(data.length),
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${name}.mp4"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
