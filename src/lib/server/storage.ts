import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { ProjectSchema, type Project } from "@/lib/schema/project";

/**
 * Local JSON storage. Callers only ever pass validated IDs — never paths —
 * and every resolved path is checked to stay inside the data root.
 */

const ID_RE = /^[A-Za-z0-9_-]{6,40}$/;

export class StorageError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export function dataRoot(): string {
  return path.resolve(process.env.FF_DATA_DIR ?? path.join(process.cwd(), "data"));
}

export function assertId(id: string): string {
  if (!ID_RE.test(id)) throw new StorageError("Invalid id", 400);
  return id;
}

/** Resolve a path under the data root, rejecting anything that escapes it. */
export function safePath(...segments: string[]): string {
  const root = dataRoot();
  const full = path.resolve(root, ...segments);
  if (full !== root && !full.startsWith(root + path.sep)) throw new StorageError("Path escapes data root", 400);
  return full;
}

async function writeAtomic(file: string, contents: string | Buffer) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, contents);
  await fs.rename(tmp, file);
}

const projectFile = (id: string) => safePath("projects", `${assertId(id)}.json`);

export async function saveProject(input: unknown): Promise<Project> {
  const parsed = ProjectSchema.safeParse(input);
  if (!parsed.success) throw new StorageError(`Invalid project: ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}`, 422);
  const project = { ...parsed.data, updatedAt: new Date().toISOString() };
  await writeAtomic(projectFile(project.id), JSON.stringify(project, null, 2));
  return project;
}

export async function loadProject(id: string): Promise<Project> {
  let raw: string;
  try {
    raw = await fs.readFile(projectFile(id), "utf8");
  } catch {
    throw new StorageError("Project not found", 404);
  }
  const parsed = ProjectSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) throw new StorageError("Stored project failed validation", 500);
  return parsed.data;
}

export async function deleteProject(id: string): Promise<void> {
  await fs.rm(projectFile(id), { force: true });
  await fs.rm(safePath("assets", assertId(id)), { recursive: true, force: true });
  await fs.rm(safePath("datasets", assertId(id)), { recursive: true, force: true });
  await fs.rm(safePath("metrics", `${assertId(id)}.json`), { force: true });
}

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: string;
  aspectRatio: Project["aspectRatio"];
  sceneCount: number;
  durationMs: number;
  /** First scene, so the dashboard can render a live animated thumbnail. */
  firstScene: Project["scenes"][number];
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const dir = safePath("projects");
  let files: string[] = [];
  try {
    files = (await fs.readdir(dir)).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const out: ProjectSummary[] = [];
  for (const f of files) {
    try {
      const p = await loadProject(f.slice(0, -5));
      out.push({
        id: p.id,
        name: p.name,
        updatedAt: p.updatedAt,
        aspectRatio: p.aspectRatio,
        sceneCount: p.scenes.length,
        durationMs: p.scenes.reduce((s, sc) => s + sc.durationMs, 0),
        firstScene: p.scenes[0],
      });
    } catch {
      // Skip unreadable files rather than failing the whole dashboard.
    }
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export const exportFile = (jobId: string) => safePath("exports", `${assertId(jobId)}.mp4`);
