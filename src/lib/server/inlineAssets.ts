import "server-only";
import type { Project } from "@/lib/schema/project";
import { readAsset } from "./assets";
import { RENDER_MEDIA_PREFIX } from "./renderMedia";

/**
 * Make a project renderable by the headless browser, which has no user session:
 * - images ("asset:<name>") become data URLs read from the owner's storage;
 * - videos, too large to embed, point at short-lived render-media URLs under `mediaToken`.
 * Either way the browser can only ever see files of the project being exported.
 */
export async function inlineAssets(owner: string, project: Project, mediaToken?: string): Promise<Project> {
  const out: Project = structuredClone(project);
  const cache = new Map<string, string | null>();
  for (const scene of out.scenes) {
    for (const el of scene.elements) {
      if (el.type === "video" && el.src.startsWith("asset:")) {
        if (mediaToken) el.src = `${RENDER_MEDIA_PREFIX}${mediaToken}/${el.src.slice("asset:".length)}`;
        continue;
      }
      if (el.type !== "image" || !el.src.startsWith("asset:")) continue;
      const name = el.src.slice("asset:".length);
      if (!cache.has(name)) {
        const asset = await readAsset(owner, project.id, name).catch(() => null);
        cache.set(name, asset ? `data:${asset.mime};base64,${asset.data.toString("base64")}` : null);
      }
      // A missing image renders as the placeholder, exactly as in the editor.
      el.src = cache.get(name) ?? "";
    }
  }
  return out;
}
