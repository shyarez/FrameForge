import { describe, expect, it } from "vitest";
import { audioPlan, buildAudioFilter, duckFactor, DUCK_RAMP_MS, hasAudio, mergeRanges, musicGainAt, musicPositionMs } from "@/lib/engine/audio";
import { createScene } from "@/lib/schema/factory";
import { ProjectSchema, type Music, type Narration, type Scene } from "@/lib/schema/project";

const scene = (durationMs: number, narration?: Narration): Scene => ({ ...createScene("S"), durationMs, ...(narration ? { narration } : {}) });
const narr = (durationMs: number, offsetMs = 0, volume = 1): Narration => ({ src: "asset:aud_abcdefghijkl.mp3", durationMs, offsetMs, volume });
const music = (over: Partial<Music> = {}): Music => ({ src: "asset:aud_musicmusic12.mp3", durationMs: 10_000, volume: 0.5, loop: true, fadeInMs: 0, fadeOutMs: 0, duck: 1, ...over });

describe("audio plan", () => {
  it("places narration at scene start plus offset and cuts it at the scene end", () => {
    const plan = audioPlan({ scenes: [scene(3000, narr(2000, 500)), scene(4000, narr(9000))] });
    expect(plan.totalMs).toBe(7000);
    expect(plan.narration.map((c) => [c.startMs, c.endMs])).toEqual([
      [500, 2500],
      [3000, 7000],
    ]);
    expect(hasAudio(plan)).toBe(true);
  });

  it("drops silent and zero-length clips", () => {
    const plan = audioPlan({ scenes: [scene(1000, narr(500, 0, 0)), scene(1000, narr(500, 1000))] });
    expect(plan.narration).toHaveLength(0);
    expect(hasAudio(plan)).toBe(false);
  });

  it("merges speech ranges that sit within two ramps of each other", () => {
    expect(mergeRanges([[0, 100], [150, 300], [1000, 1200]], 100)).toEqual([[0, 300], [1000, 1200]]);
    const plan = audioPlan({ scenes: [scene(2000, narr(1900)), scene(2000, narr(2000))] });
    expect(plan.speech).toEqual([[0, 4000]]);
  });
});

describe("music gain", () => {
  it("applies fades, looping and ducking", () => {
    const plan = audioPlan({ scenes: [scene(5000), scene(5000, narr(2000, 1000))], music: music({ fadeInMs: 1000, fadeOutMs: 1000, duck: 0.2, durationMs: 4000 }) });
    expect(musicGainAt(plan, 0)).toBe(0);
    expect(musicGainAt(plan, 500)).toBeCloseTo(0.25);
    expect(musicGainAt(plan, 3000)).toBeCloseTo(0.5);
    // Inside narration (6000–8000): ducked to 20%.
    expect(musicGainAt(plan, 7000)).toBeCloseTo(0.1);
    // Halfway through the ramp before speech.
    expect(musicGainAt(plan, 6000 - DUCK_RAMP_MS / 2)).toBeCloseTo(0.5 * (1 - 0.8 * 0.5));
    expect(musicGainAt(plan, 9500)).toBeCloseTo(0.25);
    expect(musicGainAt(plan, 10_000)).toBe(0);
    expect(musicPositionMs(plan, 9000)).toBe(1000);
  });

  it("stops a non-looping track when it ends", () => {
    const plan = audioPlan({ scenes: [scene(10_000)], music: music({ loop: false, durationMs: 3000 }) });
    expect(musicGainAt(plan, 2999)).toBeGreaterThan(0);
    expect(musicGainAt(plan, 3000)).toBe(0);
  });

  it("duckFactor is 1 away from speech", () => {
    expect(duckFactor([[1000, 2000]], 0.3, 0)).toBe(1);
    expect(duckFactor([[1000, 2000]], 0.3, 1500)).toBeCloseTo(0.3);
  });
});

describe("FFmpeg filter", () => {
  it("delays each clip, mixes over a silent bed and trims to the project length", () => {
    const plan = audioPlan({ scenes: [scene(3000, narr(2000, 500)), scene(3000)], music: music({ duck: 0.25 }) });
    const { filter, inputs } = buildAudioFilter(plan);
    expect(inputs).toEqual([
      { src: "asset:aud_abcdefghijkl.mp3", loop: false },
      { src: "asset:aud_musicmusic12.mp3", loop: true },
    ]);
    expect(filter).toContain("[2:a]");
    expect(filter).toContain("adelay=500|500");
    expect(filter).toContain("atrim=0:2.000");
    expect(filter).toContain("[3:a]");
    expect(filter).toContain("amix=inputs=3");
    expect(filter).toMatch(/atrim=0:6\.000\[aout\]$/);
    expect(filter).toContain("volume='0.500*(1-0.750*(");
  });
});

describe("schema", () => {
  it("accepts projects without audio and rejects non-audio references", () => {
    const base = {
      schemaVersion: 1, id: "prj_audio01", name: "A", createdAt: "x", updatedAt: "x", aspectRatio: "16:9",
      scenes: [scene(1000)], datasets: [], evidence: [], exportSettings: { fps: 30, resolution: 720 },
    };
    expect(ProjectSchema.safeParse(base).success).toBe(true);
    expect(ProjectSchema.safeParse({ ...base, music: music() }).success).toBe(true);
    expect(ProjectSchema.safeParse({ ...base, music: music({ src: "asset:img_abcdefghijkl.png" }) }).success).toBe(false);
    expect(ProjectSchema.safeParse({ ...base, music: music({ src: "https://example.com/a.mp3" }) }).success).toBe(false);
  });
});
