import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { audioPlan } from "@/lib/engine/audio";
import { createScene } from "@/lib/schema/factory";
import { assetPath, listAssets, saveAsset, sniffAudio } from "@/lib/server/assets";
import { probeAudio, runFfmpeg } from "@/lib/server/media";
import { muxAudio, probeVideo } from "@/lib/server/render";

/** Real FFmpeg runs: audio assets are decoded on upload and mixed onto an encoded video. */

const OWNER = "usr_testowner01";
const PROJECT = "prj_testAudio01";
let dir = "";

async function tone(file: string, seconds: number, freq: number, ext: string) {
  const out = path.join(dir, `${file}.${ext}`);
  const { code, err } = await runFfmpeg(["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `sine=frequency=${freq}:duration=${seconds}`, out]);
  if (code !== 0) throw new Error(err);
  return out;
}

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ff-audio-"));
  process.env.FF_DATA_DIR = dir;
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.FF_DATA_DIR;
});

describe("audio assets", () => {
  it("sniffs audio by content", () => {
    expect(sniffAudio(new TextEncoder().encode("RIFF\0\0\0\0WAVEfmt "))).toBe("wav");
    expect(sniffAudio(new TextEncoder().encode("OggS\0\x02"))).toBe("ogg");
    expect(sniffAudio(new TextEncoder().encode("ID3\x04\0"))).toBe("mp3");
    expect(sniffAudio(Uint8Array.from([0xff, 0xfb, 0x90, 0x64]))).toBe("mp3");
    expect(sniffAudio(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBeNull();
    expect(sniffAudio(new TextEncoder().encode("<html>"))).toBeNull();
  });

  it("stores audio with its decoded duration", async () => {
    for (const ext of ["wav", "mp3"]) {
      const file = await tone(`t_${ext}`, 1.5, 440, ext);
      const a = await saveAsset(OWNER, PROJECT, readFileSync(file));
      expect(a.media).toBe("audio");
      expect(a.kind).toBe(ext);
      expect(a.name).toMatch(new RegExp(`^aud_[A-Za-z0-9_-]{12}\\.${ext}$`));
      expect(Math.abs(a.durationMs! - 1500)).toBeLessThan(80);
    }
    const listed = await listAssets(OWNER, PROJECT);
    expect(listed.filter((x) => x.media === "audio")).toHaveLength(2);
    expect(listed.every((x) => x.media !== "audio" || (x.durationMs ?? 0) > 1000)).toBe(true);
  });

  it("rejects a file that only looks like audio", async () => {
    const fake = new Uint8Array(4096);
    fake.set(new TextEncoder().encode("RIFF\0\0\0\0WAVEjunk"));
    await expect(saveAsset(OWNER, PROJECT, fake)).rejects.toMatchObject({ status: 415 });
  });

  it("rejects audio over 25 MB", async () => {
    const big = new Uint8Array(25 * 1024 * 1024 + 1);
    big.set(new TextEncoder().encode("ID3\x04\0"));
    await expect(saveAsset(OWNER, PROJECT, big)).rejects.toMatchObject({ status: 413 });
  });
});

describe("export audio mixing", () => {
  it("mixes narration and looping music onto a silent video at the right length", async () => {
    const video = path.join(dir, "silent.mp4");
    const v = await runFfmpeg(["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=320x180:rate=30:duration=4", "-c:v", "libx264", "-pix_fmt", "yuv420p", video]);
    expect(v.code).toBe(0);

    const voice = await saveAsset(OWNER, PROJECT, readFileSync(await tone("voice", 1, 660, "wav")));
    const bgm = await saveAsset(OWNER, PROJECT, readFileSync(await tone("bgm", 1.5, 220, "mp3")));
    const s1 = { ...createScene("A"), durationMs: 2000, narration: { src: voice.ref, durationMs: voice.durationMs!, offsetMs: 300, volume: 1 } };
    const s2 = { ...createScene("B"), durationMs: 2000 };
    const plan = audioPlan({
      scenes: [s1, s2],
      music: { src: bgm.ref, durationMs: bgm.durationMs!, volume: 0.4, loop: true, fadeInMs: 200, fadeOutMs: 500, duck: 0.3 },
    });
    const files = { [voice.ref]: assetPath(OWNER, PROJECT, voice.name), [bgm.ref]: assetPath(OWNER, PROJECT, bgm.name) };

    const out = path.join(dir, "mixed.mp4");
    await muxAudio(video, { plan, files }, out);
    const probe = await probeVideo(out);
    expect(probe.decodedOk).toBe(true);
    expect(probe.codec).toBe("h264");
    expect(probe.audio).toMatchObject({ codec: "aac", sampleRate: 48000, channels: "stereo" });
    expect(Math.abs(probe.durationSec - 4)).toBeLessThan(0.1);

    // The audio track itself covers the whole video, not just the clips.
    const track = await probeAudio(out);
    expect(Math.abs(track!.durationMs - 4000)).toBeLessThan(100);
  });

  it("fails clearly when an audio file is missing", async () => {
    const plan = audioPlan({ scenes: [{ ...createScene("A"), durationMs: 1000, narration: { src: "asset:aud_missingmissi.wav", durationMs: 500, offsetMs: 0, volume: 1 } }] });
    await expect(muxAudio(path.join(dir, "silent.mp4"), { plan, files: {} }, path.join(dir, "x.mp4"))).rejects.toThrow(/missing/);
  });
});
