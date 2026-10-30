import { describe, expect, it } from "vitest";
import { isCrossSite } from "@/lib/server/auth";
import { hit } from "@/lib/server/rateLimit";

describe("cross-site request check", () => {
  const req = (method: string, origin?: string) => new Request("http://localhost:3000/api/projects", { method, headers: origin ? { origin } : {} });
  it("allows reads and same-origin writes", () => {
    expect(isCrossSite(req("GET", "https://evil.example"))).toBe(false);
    expect(isCrossSite(req("POST", "http://localhost:3000"))).toBe(false);
    expect(isCrossSite(req("POST"))).toBe(false); // no Origin header (non-browser client)
  });
  it("blocks writes from another origin", () => {
    expect(isCrossSite(req("POST", "https://evil.example"))).toBe(true);
    expect(isCrossSite(req("DELETE", "http://localhost:3001"))).toBe(true);
    expect(isCrossSite(req("PUT", "not a url"))).toBe(true);
  });
});

describe("rate limiter", () => {
  it("allows up to the limit within a window, then blocks until it resets", () => {
    const key = `test-${Math.random()}`;
    for (let i = 0; i < 3; i++) expect(hit(key, 3, 1000, 0).ok).toBe(true);
    expect(hit(key, 3, 1000, 10)).toEqual({ ok: false, retryAfter: 1 });
    expect(hit(key, 3, 1000, 1001).ok).toBe(true); // new window
  });
});
