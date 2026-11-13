import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
}));

const { GET, POST } = await import("@/app/api/auth/dev-login/route");
const { GET: me } = await import("@/app/api/auth/me/route");

let dir = "";
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ff-devlogin-"));
  process.env.FF_DATA_DIR = dir;
  // A project from before accounts existed.
  mkdirSync(path.join(dir, "projects"), { recursive: true });
  writeFileSync(path.join(dir, "projects", "prj_legacy0001.json"), "{}");
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.FF_DATA_DIR;
});
afterEach(() => {
  vi.unstubAllEnvs();
  jar.clear();
});

const req = (method: string, host = "localhost:3000") => new Request(`http://${host}/api/auth/dev-login`, { method });

describe("developer sign-in shortcut", () => {
  it("is off unless FF_DEV_LOGIN=1", async () => {
    vi.stubEnv("FF_DEV_LOGIN", "");
    expect(await (await GET(req("GET"))).json()).toEqual({ enabled: false });
    expect((await POST(req("POST"))).status).toBe(404);
  });

  it("never works in a production build, even when switched on", async () => {
    vi.stubEnv("FF_DEV_LOGIN", "1");
    vi.stubEnv("NODE_ENV", "production");
    expect(await (await GET(req("GET"))).json()).toEqual({ enabled: false });
    expect((await POST(req("POST"))).status).toBe(404);
  });

  it("only answers requests addressed to localhost", async () => {
    vi.stubEnv("FF_DEV_LOGIN", "1");
    vi.stubEnv("NODE_ENV", "development");
    expect((await POST(req("POST", "192.168.1.20:3000"))).status).toBe(404);
    expect((await POST(req("POST", "frameforge.example.com"))).status).toBe(404);
  });

  it("signs in as the developer account, which adopts existing projects", async () => {
    vi.stubEnv("FF_DEV_LOGIN", "1");
    vi.stubEnv("NODE_ENV", "development");
    expect(await (await GET(req("GET"))).json()).toEqual({ enabled: true });
    const res = await POST(req("POST"));
    expect(res.status).toBe(200);
    const { user } = await res.json();
    expect(user.email).toBe("dev@frameforge.local");
    expect((await (await me()).json()).user.id).toBe(user.id);
    expect(existsSync(path.join(dir, "users", user.id, "projects", "prj_legacy0001.json"))).toBe(true);
    // A second sign-in reuses the same account.
    jar.clear();
    expect((await (await POST(req("POST"))).json()).user.id).toBe(user.id);
  });
});
