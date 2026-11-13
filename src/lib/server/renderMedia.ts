import "server-only";
import { randomBytes } from "node:crypto";

/**
 * Short-lived, unguessable URLs that let the headless export browser stream one project's videos without
 * a user session (videos are too large to embed like images). A grant covers exactly one owner and
 * project, and is revoked when the export finishes.
 */

interface Grant {
  owner: string;
  projectId: string;
  expiresAt: number;
}

const g = globalThis as unknown as { __ffRenderMedia?: Map<string, Grant> };
const grants = (g.__ffRenderMedia ??= new Map());

export const RENDER_MEDIA_PREFIX = "/api/render-media/";

export function grantRenderMedia(owner: string, projectId: string, ttlMs = 2 * 60 * 60_000): string {
  const now = Date.now();
  for (const [t, gr] of grants) if (gr.expiresAt <= now) grants.delete(t);
  const token = randomBytes(24).toString("base64url");
  grants.set(token, { owner, projectId, expiresAt: now + ttlMs });
  return token;
}

export function lookupRenderMedia(token: string): Grant | null {
  const gr = grants.get(token);
  if (!gr) return null;
  if (gr.expiresAt <= Date.now()) {
    grants.delete(token);
    return null;
  }
  return gr;
}

export const revokeRenderMedia = (token: string) => void grants.delete(token);
