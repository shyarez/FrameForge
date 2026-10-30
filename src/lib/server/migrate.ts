import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { safePath, userPath } from "./storage";

/**
 * Before accounts existed, all data lived directly under data/. When the first account is created,
 * that data is moved into the new user's folder so nothing is lost. Idempotent: entries that already
 * exist in the user's folder are left in place rather than overwritten.
 */

const LEGACY_DIRS = ["projects", "assets", "datasets", "metrics", "exports"] as const;

export async function adoptLegacyData(userId: string): Promise<Record<string, number>> {
  const moved: Record<string, number> = {};
  for (const name of LEGACY_DIRS) {
    const src = safePath(name);
    const entries = await fs.readdir(src).catch(() => null);
    if (!entries) continue;
    const dest = userPath(userId, name);
    await fs.mkdir(dest, { recursive: true });
    let n = 0;
    for (const entry of entries) {
      const to = path.join(dest, entry);
      const exists = await fs.stat(to).then(() => true, () => false);
      if (exists) continue;
      await fs.rename(path.join(src, entry), to);
      n++;
    }
    // Remove the legacy folder once it is empty.
    if ((await fs.readdir(src)).length === 0) await fs.rmdir(src);
    moved[name] = n;
  }
  return moved;
}
