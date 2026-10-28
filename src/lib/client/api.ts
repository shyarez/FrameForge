import type { Project } from "@/lib/schema/project";
import type { ProjectSummary } from "@/lib/server/storage";
import type { ExportJob } from "@/lib/server/exportJobs";
import type { AssetInfo } from "@/lib/server/assets";

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`);
  return body as T;
}

export const api = {
  listProjects: () => fetch("/api/projects", { cache: "no-store" }).then((r) => json<{ projects: ProjectSummary[] }>(r)),
  createProject: (body: { name: string; aspectRatio: Project["aspectRatio"]; template: "blank" | "launch" }) =>
    fetch("/api/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) =>
      json<{ project: Project }>(r),
    ),
  getProject: (id: string) => fetch(`/api/projects/${encodeURIComponent(id)}`, { cache: "no-store" }).then((r) => json<{ project: Project }>(r)),
  saveProject: (p: Project) =>
    fetch(`/api/projects/${encodeURIComponent(p.id)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(p) }).then(
      (r) => json<{ project: Project }>(r),
    ),
  deleteProject: (id: string) => fetch(`/api/projects/${encodeURIComponent(id)}`, { method: "DELETE" }).then((r) => json<{ ok: true }>(r)),
  startExport: (id: string) => fetch(`/api/projects/${encodeURIComponent(id)}/export`, { method: "POST" }).then((r) => json<{ job: ExportJob }>(r)),
  getExport: (jobId: string) => fetch(`/api/exports/${encodeURIComponent(jobId)}`, { cache: "no-store" }).then((r) => json<{ job: ExportJob }>(r)),
  listAssets: (projectId: string) =>
    fetch(`/api/projects/${encodeURIComponent(projectId)}/assets`, { cache: "no-store" }).then((r) => json<{ assets: AssetInfo[] }>(r)),
  uploadAsset: (projectId: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return fetch(`/api/projects/${encodeURIComponent(projectId)}/assets`, { method: "POST", body: form }).then((r) => json<{ asset: AssetInfo }>(r));
  },
  deleteAsset: (projectId: string, name: string) =>
    fetch(`/api/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(name)}`, { method: "DELETE" }).then((r) => json<{ ok: true }>(r)),
  exportFileUrl: (jobId: string, download = false) => `/api/exports/${encodeURIComponent(jobId)}/file${download ? "?download=1" : ""}`,
};
