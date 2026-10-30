import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// A minimal stand-in for next/headers' cookie store, shared by the route handlers under test.
const jar = new Map<string, { value: string; options?: Record<string, unknown> }>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)!.value } : undefined),
    set: (name: string, value: string, options?: Record<string, unknown>) => void jar.set(name, { value, options }),
    delete: (name: string) => void jar.delete(name),
  }),
}));

const { POST: register } = await import("@/app/api/auth/register/route");
const { POST: login } = await import("@/app/api/auth/login/route");
const { POST: logout } = await import("@/app/api/auth/logout/route");
const { GET: me } = await import("@/app/api/auth/me/route");

let dir = "";
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ff-authroutes-"));
  process.env.FF_DATA_DIR = dir;
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.FF_DATA_DIR;
});
beforeEach(() => jar.clear());

const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://localhost:3000${url}`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `10.0.0.${Math.floor(Math.random() * 250)}`, ...headers }, body: JSON.stringify(body) });

describe("auth routes", () => {
  it("registers, sets an HttpOnly session cookie, and reports the user", async () => {
    const res = await register(post("/api/auth/register", { email: "Dana@Example.com", password: "dana-password" }));
    expect(res.status).toBe(201);
    const { user } = await res.json();
    expect(user).toMatchObject({ email: "dana@example.com" });
    expect(user.passwordHash).toBeUndefined();
    expect(jar.get("ff_session")?.options).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
    expect((await (await me()).json()).user.email).toBe("dana@example.com");
  });

  it("logs out by revoking the session", async () => {
    await login(post("/api/auth/login", { email: "dana@example.com", password: "dana-password" }));
    const token = jar.get("ff_session")!.value;
    expect((await logout(post("/api/auth/logout", {}))).status).toBe(200);
    expect(jar.has("ff_session")).toBe(false);
    jar.set("ff_session", { value: token }); // replaying the old token must not work
    expect((await me()).status).toBe(401);
  });

  it("logs in with the right password and gives one generic error otherwise", async () => {
    expect((await login(post("/api/auth/login", { email: "DANA@example.com", password: "dana-password" }))).status).toBe(200);
    const wrong = await login(post("/api/auth/login", { email: "dana@example.com", password: "nope-nope" }));
    const unknown = await login(post("/api/auth/login", { email: "ghost@example.com", password: "nope-nope" }));
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect((await wrong.json()).error).toBe((await unknown.json()).error); // no account enumeration
  });

  it("rejects duplicates, bad input and cross-site requests", async () => {
    expect((await register(post("/api/auth/register", { email: "dana@example.com", password: "another-pass" }))).status).toBe(409);
    expect((await register(post("/api/auth/register", { email: "x", password: "y" }))).status).toBe(400);
    expect((await register(post("/api/auth/register", "not json"))).status).toBe(400);
    expect((await login(post("/api/auth/login", { email: "dana@example.com", password: "dana-password" }, { origin: "https://evil.example" }))).status).toBe(403);
  });

  it("rate-limits repeated failed logins for one account", async () => {
    const attempt = () => login(post("/api/auth/login", { email: "victim@example.com", password: "guess-guess" }));
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await attempt()).status);
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
  });
});
