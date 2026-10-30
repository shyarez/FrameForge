import "server-only";
import type { Project } from "@/lib/schema/project";
import { readAsset } from "./assets";

/**
 * Replace project-local image references ("asset:<name>") with data URLs read from the owner's
 * storage. The headless render browser then needs no session to load images, and can only ever
 * see images belonging to the project being exported.
 */
export async function inlineAssets(owner: string, project: Project): Promise<Project> {
  const out: Project = structuredClone(project);
  const cache = new Map<string, string | null>();
  for (const scene of out.scenes) {
    for (const el of scene.elements) {
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
