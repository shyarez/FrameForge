import type { Project } from "@/lib/schema/project";
import type { ProjectSummary } from "@/lib/server/storage";
import type { ExportJob } from "@/lib/server/exportJobs";
import type { AssetInfo } from "@/lib/server/assets";
import type { DatasetView } from "@/lib/server/datasets";
import type { Story, StoryRoles } from "@/lib/data/story";
import type { UpdateReport } from "@/lib/data/update";
import type { AuditReport } from "@/lib/data/audit";
import type { ExportMetric } from "@/lib/server/metrics";

import type { PublicUser } from "@/lib/server/users";

/** Only same-site relative paths are allowed as a post-login destination (no open redirects). */
export function safeNext(next: string | null | undefined): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}

/** Send a signed-out user to the sign-in page, returning here afterwards. */
function toLogin() {
  if (typeof window === "undefined" || window.location.pathname.startsWith("/login") || window.location.pathname.startsWith("/signup")) return;
  // Called from data helpers outside React, where no router exists; a full load also drops stale state.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
}

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (res.status === 401 && !res.url.includes("/api/auth/")) toLogin();
  if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`);
  return body as T;
}

const postJson = (url: string, body: unknown) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export const auth = {
  me: () => fetch("/api/auth/me", { cache: "no-store" }).then((r) => (r.ok ? (r.json() as Promise<{ user: PublicUser }>) : null)),
  login: (email: string, password: string) => postJson("/api/auth/login", { email, password }).then((r) => json<{ user: PublicUser }>(r)),
  register: (email: string, password: string) => postJson("/api/auth/register", { email, password }).then((r) => json<{ user: PublicUser }>(r)),
  logout: () => postJson("/api/auth/logout", {}).then((r) => json<{ ok: true }>(r)),
};

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
  uploadDataset: (projectId: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return fetch(`/api/projects/${encodeURIComponent(projectId)}/datasets`, { method: "POST", body: form }).then((r) => json<{ dataset: DatasetView }>(r));
  },
  getDataset: (projectId: string, datasetId: string, version?: number) =>
    fetch(`/api/projects/${encodeURIComponent(projectId)}/datasets/${encodeURIComponent(datasetId)}${version ? `?version=${version}` : ""}`, { cache: "no-store" }).then((r) =>
      json<{ dataset: DatasetView }>(r),
    ),
  deleteDataset: (projectId: string, datasetId: string) =>
    fetch(`/api/projects/${encodeURIComponent(projectId)}/datasets/${encodeURIComponent(datasetId)}`, { method: "DELETE" }).then((r) => json<{ ok: true }>(r)),
  generateStory: (projectId: string, datasetId: string, roles: StoryRoles, aspectRatio: Project["aspectRatio"], version?: number) =>
    fetch(`/api/projects/${encodeURIComponent(projectId)}/datasets/${encodeURIComponent(datasetId)}/story`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ roles, aspectRatio, version }),
    }).then((r) => json<{ story: Story }>(r)),
  uploadDatasetVersion: (projectId: string, datasetId: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return fetch(`/api/projects/${encodeURIComponent(projectId)}/datasets/${encodeURIComponent(datasetId)}/versions`, { method: "POST", body: form }).then((r) =>
      json<{ dataset: DatasetView; identical: boolean }>(r),
    );
  },
  planDatasetUpdate: (project: Project, datasetId: string) =>
    fetch(`/api/projects/${encodeURIComponent(project.id)}/datasets/${encodeURIComponent(datasetId)}/update`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ project }),
    }).then((r) => json<{ project: Project; report: UpdateReport }>(r)),
  getEvaluation: (projectId: string) =>
    fetch(`/api/projects/${encodeURIComponent(projectId)}/evaluation`, { cache: "no-store" }).then((r) => json<{ audit: AuditReport; exports: ExportMetric[] }>(r)),
  exportFileUrl: (jobId: string, download = false) => `/api/exports/${encodeURIComponent(jobId)}/file${download ? "?download=1" : ""}`,
};
