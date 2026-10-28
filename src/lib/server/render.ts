import "server-only";
import { spawn } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import ffmpegStatic from "ffmpeg-static";
import { chromium, type Browser } from "playwright-core";
import { frameTimes } from "@/lib/engine/evaluate";
import { outputSize, projectDurationMs, type Project } from "@/lib/schema/project";

/**
 * MP4 exporter. Follows the HyperFrames capture pattern (seekable page → per-frame
 * screenshot → FFmpeg) with our own seek contract: window.__ffInit / window.__ffSeek.
 */

export function ffmpegPath(): string {
  const p = process.env.FF_FFMPEG_PATH || (ffmpegStatic as unknown as string | null);
  if (!p || !existsSync(p)) throw new Error("FFmpeg binary not found. Set FF_FFMPEG_PATH or reinstall ffmpeg-static.");
  return p;
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
  phase: "launching" | "rendering" | "encoding";
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
}

export async function renderProjectToMp4({ project, origin, outFile, onProgress, signal }: RenderOptions) {
  const { fps, resolution } = project.exportSettings;
  const { width, height } = outputSize(project.aspectRatio, resolution);
  const times = frameTimes(projectDurationMs(project), fps);
  const totalFrames = times.length;
  await fs.mkdir(path.dirname(outFile), { recursive: true });

  onProgress?.({ phase: "launching", frame: 0, totalFrames });
  let browser: Browser | undefined;
  const tmpOut = `${outFile}.partial.mp4`;
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
    await fs.rename(tmpOut, outFile);
  } catch (err) {
    ff.stdin.destroy();
    ff.kill("SIGKILL");
    await fs.rm(tmpOut, { force: true });
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
}

/** Verify an MP4 by decoding every frame with FFmpeg (ffmpeg-static ships no ffprobe). */
export async function probeVideo(file: string): Promise<ProbeResult> {
  const run = (args: string[]) =>
    new Promise<{ code: number; err: string }>((resolve, reject) => {
      const p = spawn(ffmpegPath(), args, { stdio: ["ignore", "ignore", "pipe"] });
      let err = "";
      p.stderr.on("data", (d) => (err += d.toString()));
      p.on("error", reject);
      p.on("close", (code) => resolve({ code: code ?? -1, err }));
    });
  const info = await run(["-hide_banner", "-i", file, "-map", "0:v:0", "-f", "null", "-"]);
  const stream = /Stream #0:0.*Video: (\w+).*?, (\d{2,5})x(\d{2,5}).*?, ([\d.]+) fps/.exec(info.err);
  const dur = /Duration: (\d+):(\d+):([\d.]+)/.exec(info.err);
  const strict = await run(["-v", "error", "-i", file, "-f", "null", "-"]);
  return {
    codec: stream?.[1] ?? "unknown",
    width: Number(stream?.[2] ?? 0),
    height: Number(stream?.[3] ?? 0),
    fps: Number(stream?.[4] ?? 0),
    durationSec: dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : 0,
    decodedOk: info.code === 0 && strict.code === 0 && strict.err.trim() === "",
  };
}
