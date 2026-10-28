import { NextResponse } from "next/server";
import { z } from "zod";
import { createProject } from "@/lib/schema/factory";
import { AspectRatioSchema } from "@/lib/schema/project";
import { errorResponse } from "@/lib/server/http";
import { listProjects, saveProject } from "@/lib/server/storage";

export async function GET() {
  try {
    return NextResponse.json({ projects: await listProjects() });
  } catch (err) {
    return errorResponse(err);
  }
}

const CreateBody = z.object({
  name: z.string().trim().min(1).max(120).default("Untitled project"),
  aspectRatio: AspectRatioSchema.default("16:9"),
  template: z.enum(["blank", "launch"]).default("launch"),
});

export async function POST(req: Request) {
  try {
    const body = CreateBody.safeParse(await req.json().catch(() => ({})));
    if (!body.success) return NextResponse.json({ error: "Invalid create request" }, { status: 400 });
    const project = await saveProject(createProject(body.data.name, body.data.aspectRatio, body.data.template));
    return NextResponse.json({ project }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
