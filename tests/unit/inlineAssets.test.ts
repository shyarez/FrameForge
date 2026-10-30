import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createImage, createProject, createScene } from "@/lib/schema/factory";
import { ProjectSchema } from "@/lib/schema/project";
import { saveAsset } from "@/lib/server/assets";
import { inlineAssets } from "@/lib/server/inlineAssets";

const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64"));

let dir = "";
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ff-inline-"));
  process.env.FF_DATA_DIR = dir;
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.FF_DATA_DIR;
});

describe("inlining images for export", () => {
  it("embeds the owner's images as data URLs and leaves the original untouched", async () => {
    const p = createProject("Inline", "16:9", "blank");
    const a = await saveAsset("usr_owner000001", p.id, PNG);
    p.scenes = [createScene("S", { elements: [createImage(a.ref), createImage("asset:img_missing00000.png")] })];
    const out = await inlineAssets("usr_owner000001", p);
    const [img, missing] = out.scenes[0].elements as { src: string }[];
    expect(img.src).toBe(`data:image/png;base64,${Buffer.from(PNG).toString("base64")}`);
    expect(missing.src).toBe(""); // renders the placeholder, like the editor
    expect((p.scenes[0].elements[0] as { src: string }).src).toBe(a.ref);
    expect(ProjectSchema.safeParse(out).success).toBe(true);
  });

  it("never reads another user's images", async () => {
    const p = createProject("Other", "16:9", "blank");
    const a = await saveAsset("usr_owner000001", p.id, PNG);
    p.scenes = [createScene("S", { elements: [createImage(a.ref)] })];
    const out = await inlineAssets("usr_intruder001", p);
    expect((out.scenes[0].elements[0] as { src: string }).src).toBe("");
  });
});
