import "server-only";
import { spawn } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { chromium, type Browser } from "playwright-core";
import { buildAudioFilter, hasAudio, type AudioPlan } from "@/lib/engine/audio";
import { frameTimes } from "@/lib/engine/evaluate";
import { outputSize, projectDurationMs, type Project } from "@/lib/schema/project";
import { ffmpegPath, runFfmpeg } from "./media";

export { ffmpegPath };

/**
 * MP4 exporter. Follows the HyperFrames capture pattern (seekable page → per-frame
 * screenshot → FFmpeg) with our own seek contract: window.__ffInit / window.__ffSeek.
 * Audio, when the project has any, is mixed in a second FFmpeg pass that copies the video stream.
 */

export interface AudioInput {
  plan: AudioPlan;
  /** Absolute file path for each audio asset reference used by the plan. */
  files: Record<string, string>;
}

/** Mix the plan's audio onto an encoded video, copying the video stream unchanged. */
export async function muxAudio(videoFile: string, audio: AudioInput, outFile: string, signal?: AbortSignal): Promise<void> {
  const { filter, inputs } = buildAudioFilter(audio.plan);
  const args = ["-y", "-hide_banner", "-loglevel", "error", "-i", videoFile];
  args.push("-f", "lavfi", "-t", (audio.plan.totalMs / 1000).toFixed(3), "-i", "anullsrc=r=48000:cl=stereo");
  for (const input of inputs) {
    const file = audio.files[input.src];
    if (!file || !existsSync(file)) throw new Error(`Audio file is missing: ${input.src.replace(/^asset:/, "")}`);
    if (input.loop) args.push("-stream_loop", "-1");
    args.push("-i", file);
  }
  args.push("-filter_complex", filter, "-map", "0:v:0", "-map", "[aout]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", outFile);
  const { code, err } = await runFfmpeg(args, { signal, timeoutMs: 30 * 60_000 });
  if (code !== 0) throw new Error(`Audio mixing failed (exit ${code}): ${err.trim().slice(-800) || "no output"}`);
}

const CHROME_CANDIDATES = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

export function chromePath(): string | undefined {
  if (process.env.FF_CHROME_PATH) return process.env.FF_CHROME_PATH;
  return CHROME_CANDIDATES.find((p) => existsSync(p));
}

export interface RenderProgress {
  phase: "launching" | "rendering" | "encoding" | "mixing";
  frame: number;
  totalFrames: number;
}

export interface RenderOptions {
  project: Project;
  /** Origin of this running app, used to load the /render page. */
  origin: string;
  outFile: string;
  onProgress?: (p: RenderProgress) => void;
  signal?: AbortSignal;
  /** Narration and music to mix in; omitted or empty means a silent video. */
  audio?: AudioInput;
}

export async function renderProjectToMp4({ project, origin, outFile, onProgress, signal, audio }: RenderOptions) {
  const { fps, resolution } = project.exportSettings;
  const { width, height } = outputSize(project.aspectRatio, resolution);
  const times = frameTimes(projectDurationMs(project), fps);
  const totalFrames = times.length;
  await fs.mkdir(path.dirname(outFile), { recursive: true });

  onProgress?.({ phase: "launching", frame: 0, totalFrames });
  let browser: Browser | undefined;
  const tmpOut = `${outFile}.partial.mp4`;
  const mixedOut = `${outFile}.mixed.mp4`;
  const withAudio = audio && hasAudio(audio.plan) ? audio : null;
  const ff = spawn(
    ffmpegPath(),
    [
      "-y", "-hide_banner", "-loglevel", "error",
      "-f", "image2pipe", "-framerate", String(fps), "-c:v", "mjpeg", "-i", "-",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
      "-r", String(fps), "-movflags", "+faststart", tmpOut,
    ],
    { stdio: ["pipe", "ignore", "pipe"] },
  );
  let ffErr = "";
  ff.stderr.on("data", (d) => (ffErr = (ffErr + d.toString()).slice(-4000)));
  const ffExit = new Promise<number>((resolve, reject) => {
    ff.on("error", reject);
    ff.on("close", (code) => resolve(code ?? -1));
  });
  // Surface EPIPE as a normal failure instead of an unhandled error.
  ff.stdin.on("error", () => undefined);

  const write = (buf: Buffer) =>
    new Promise<void>((resolve, reject) => {
      if (ff.exitCode !== null) return reject(new Error(`FFmpeg exited early: ${ffErr.trim()}`));
      ff.stdin.write(buf, (err) => (err ? reject(err) : resolve()));
    });

  try {
    browser = await chromium.launch({
      executablePath: chromePath(),
      headless: true,
      args: ["--hide-scrollbars", "--force-color-profile=srgb", "--font-render-hinting=none", "--disable-gpu"],
    });
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));

    await page.goto(`${origin}/render`, { waitUntil: "load", timeout: 120_000 });
    await page.waitForFunction(() => window.__ffReady === true, null, { timeout: 60_000 });
    await page.evaluate(([p, w, h]) => window.__ffInit!(p, w as number, h as number), [project, width, height] as const);

    for (let i = 0; i < totalFrames; i++) {
      if (signal?.aborted) throw new Error("Export cancelled");
      await page.evaluate((t) => window.__ffSeek!(t), times[i]);
      const buf = await page.screenshot({ type: "jpeg", quality: 92, clip: { x: 0, y: 0, width, height } });
      await write(buf);
      onProgress?.({ phase: "rendering", frame: i + 1, totalFrames });
      if (pageErrors.length) throw new Error(`Render page error: ${pageErrors[0]}`);
    }
    onProgress?.({ phase: "encoding", frame: totalFrames, totalFrames });
    ff.stdin.end();
    const code = await ffExit;
    if (code !== 0) throw new Error(`FFmpeg failed (exit ${code}): ${ffErr.trim() || "no output"}`);
    await browser.close().catch(() => undefined);
    if (withAudio) {
      onProgress?.({ phase: "mixing", frame: totalFrames, totalFrames });
      await muxAudio(tmpOut, withAudio, mixedOut, signal);
      await fs.rm(tmpOut, { force: true });
      await fs.rename(mixedOut, outFile);
    } else {
      await fs.rename(tmpOut, outFile);
    }
  } catch (err) {
    ff.stdin.destroy();
    ff.kill("SIGKILL");
    await fs.rm(tmpOut, { force: true });
    await fs.rm(mixedOut, { force: true });
    throw err;
  } finally {
    await browser?.close().catch(() => undefined);
  }

  return { width, height, fps, totalFrames };
}

export interface ProbeResult {
  width: number;
  height: number;
  fps: number;
  durationSec: number;
  codec: string;
  decodedOk: boolean;
  /** The audio track, if the file has one. */
  audio: { codec: string; sampleRate: number; channels: string } | null;
}

/** Verify an MP4 by decoding every frame (and audio sample) with FFmpeg (ffmpeg-static ships no ffprobe). */
export async function probeVideo(file: string): Promise<ProbeResult> {
  const info = await runFfmpeg(["-hide_banner", "-i", file, "-map", "0:v:0", "-f", "null", "-"]);
  const stream = /Stream #0:\d+.*Video: (\w+).*?, (\d{2,5})x(\d{2,5}).*?, ([\d.]+) fps/.exec(info.err);
  const audio = /Stream #0:\d+.*Audio: (\w+).*?, (\d+) Hz, ([\w.]+)/.exec(info.err);
  const dur = /Duration: (\d+):(\d+):([\d.]+)/.exec(info.err);
  const strict = await runFfmpeg(["-v", "error", "-i", file, "-f", "null", "-"]);
  return {
    audio: audio ? { codec: audio[1], sampleRate: Number(audio[2]), channels: audio[3] } : null,
    codec: stream?.[1] ?? "unknown",
    width: Number(stream?.[2] ?? 0),
    height: Number(stream?.[3] ?? 0),
    fps: Number(stream?.[4] ?? 0),
    durationSec: dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : 0,
    decodedOk: info.code === 0 && strict.code === 0 && strict.err.trim() === "",
  };
}
