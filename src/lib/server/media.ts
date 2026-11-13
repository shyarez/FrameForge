import "server-only";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import ffmpegStatic from "ffmpeg-static";

/** FFmpeg helpers shared by asset checks and the exporter (ffmpeg-static ships no ffprobe). */

export function ffmpegPath(): string {
  const p = process.env.FF_FFMPEG_PATH || (ffmpegStatic as unknown as string | null);
  if (!p || !existsSync(p)) throw new Error("FFmpeg binary not found. Set FF_FFMPEG_PATH or reinstall ffmpeg-static.");
  return p;
}

/** Run FFmpeg with arguments (never through a shell) and collect stderr. */
export function runFfmpeg(args: string[], opts: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<{ code: number; err: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath(), args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => (err = (err + d.toString()).slice(-200_000)));
    const timer = opts.timeoutMs ? setTimeout(() => p.kill("SIGKILL"), opts.timeoutMs) : undefined;
    const onAbort = () => p.kill("SIGKILL");
    opts.signal?.addEventListener("abort", onAbort);
    p.on("error", reject);
    p.on("close", (code) => {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      resolve({ code: code ?? -1, err });
    });
  });
}

/**
 * Decode an audio file completely and report its length. Returns null when FFmpeg cannot decode it,
 * so a file that merely starts with the right magic bytes is still rejected.
 */
export async function probeAudio(file: string): Promise<{ durationMs: number } | null> {
  const { code, err } = await runFfmpeg(["-hide_banner", "-v", "info", "-i", file, "-map", "0:a:0", "-f", "null", "-"], { timeoutMs: 60_000 });
  if (code !== 0 || !/Stream #0:\d+.*Audio:/.test(err)) return null;
  // The decoder's final progress line has the true decoded length (container headers can lie, e.g. VBR MP3).
  const times = [...err.matchAll(/time=(\d+):(\d+):([\d.]+)/g)];
  const last = times[times.length - 1];
  let sec = last ? Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3]) : 0;
  if (!(sec > 0)) {
    const dur = /Duration: (\d+):(\d+):([\d.]+)/.exec(err);
    sec = dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : 0;
  }
  return sec > 0 ? { durationMs: Math.round(sec * 1000) } : null;
}

/**
 * Check a video file: it must have a video stream and its first frames must decode. Reports length and
 * picture size. (Decoding a whole clip would be slow, so only the first second is decoded.)
 */
export async function probeVideoFile(file: string): Promise<{ durationMs: number; width: number; height: number } | null> {
  const { code, err } = await runFfmpeg(["-hide_banner", "-v", "info", "-i", file, "-map", "0:v:0", "-t", "1", "-f", "null", "-"], { timeoutMs: 60_000 });
  const stream = /Stream #0:\d+.*Video: \w+.*?, (\d{2,5})x(\d{2,5})/.exec(err);
  const dur = /Duration: (\d+):(\d+):([\d.]+)/.exec(err);
  if (code !== 0 || !stream || !dur) return null;
  const sec = Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]);
  return sec > 0 ? { durationMs: Math.round(sec * 1000), width: Number(stream[1]), height: Number(stream[2]) } : null;
}
