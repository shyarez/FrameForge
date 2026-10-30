import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Cookie store stand-in; each "browser" is a jar we swap in before a request.
let jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
}));

const { POST: register } = await import("@/app/api/auth/register/route");
const projects = await import("@/app/api/projects/route");
const project = await import("@/app/api/projects/[id]/route");
const assets = await import("@/app/api/projects/[id]/assets/route");
const datasets = await import("@/app/api/projects/[id]/datasets/route");
const exportStart = await import("@/app/api/projects/[id]/export/route");

let dir = "";
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ff-isolation-"));
  process.env.FF_DATA_DIR = dir;
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.FF_DATA_DIR;
});

const url = (p: string) => `http://localhost:3000${p}`;
const json = (method: string, p: string, body?: unknown) =>
  new Request(url(p), { method, headers: { "content-type": "application/json", "x-forwarded-for": "10.9.9.9" }, body: body === undefined ? undefined : JSON.stringify(body) });
const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });

async function signUp(email: string) {
  jar = new Map();
  await register(json("POST", "/api/auth/register", { email, password: "password-123" }));
  return jar;
}

describe("per-user isolation", () => {
  it("keeps each user's projects, assets and datasets private", async () => {
    const alice = await signUp("alice@example.com");
    const bob = await signUp("bob@example.com");

    jar = alice;
    const created = await (await projects.POST(json("POST", "/api/projects", { name: "Alice's secret" }))).json();
    const id = created.project.id as string;

    // Alice sees her project.
    expect((await project.GET(json("GET", `/api/projects/${id}`), ctx({ id }))).status).toBe(200);

    // Bob does not: not in his list, and direct access is "not found" (no hint that it exists).
    jar = bob;
    expect((await (await projects.GET(json("GET", "/api/projects"))).json()).projects).toEqual([]);
    expect((await project.GET(json("GET", `/api/projects/${id}`), ctx({ id }))).status).toBe(404);
    expect((await assets.GET(json("GET", `/api/projects/${id}/assets`), ctx({ id }))).status).toBe(404);
    expect((await exportStart.POST(json("POST", `/api/projects/${id}/export`), ctx({ id }))).status).toBe(404);
    const form = new FormData();
    form.append("file", new File(["a,b\n1,2\n"], "x.csv"));
    expect((await datasets.POST(new Request(url(`/api/projects/${id}/datasets`), { method: "POST", body: form }), ctx({ id }))).status).toBe(404);

    // Bob cannot overwrite or delete it either.
    expect((await project.PUT(json("PUT", `/api/projects/${id}`, created.project), ctx({ id }))).status).toBe(404);
    expect((await project.DELETE(json("DELETE", `/api/projects/${id}`), ctx({ id }))).status).toBe(404);

    jar = alice;
    expect((await project.GET(json("GET", `/api/projects/${id}`), ctx({ id }))).status).toBe(200);
  });

  it("refuses signed-out requests", async () => {
    jar = new Map();
    expect((await projects.GET(json("GET", "/api/projects"))).status).toBe(401);
    expect((await projects.POST(json("POST", "/api/projects", { name: "x" }))).status).toBe(401);
  });
});
