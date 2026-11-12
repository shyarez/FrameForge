"use client";

import { useEffect, useState } from "react";

/** Peak levels (0–1) per URL, decoded once per session. */
const cache = new Map<string, Promise<Float32Array | null>>();
const BUCKETS = 400;

function peaks(url: string): Promise<Float32Array | null> {
  let p = cache.get(url);
  if (!p) {
    p = (async () => {
      try {
        const buf = await (await fetch(url)).arrayBuffer();
        const ctx = new OfflineAudioContext(1, 1, 44_100);
        const audio = await ctx.decodeAudioData(buf);
        const data = audio.getChannelData(0);
        const out = new Float32Array(BUCKETS);
        const step = Math.max(1, Math.floor(data.length / BUCKETS));
        let max = 0;
        for (let i = 0; i < BUCKETS; i++) {
          let peak = 0;
          for (let j = i * step, end = Math.min(data.length, j + step); j < end; j += 8) peak = Math.max(peak, Math.abs(data[j]));
          out[i] = peak;
          max = Math.max(max, peak);
        }
        if (max > 0) for (let i = 0; i < BUCKETS; i++) out[i] /= max;
        return out;
      } catch {
        return null;
      }
    })();
    cache.set(url, p);
  }
  return p;
}

/**
 * Waveform of the first `showFraction` of an audio file, drawn as an SVG that stretches to its box.
 * Shows a flat bar until (or if) the audio decodes.
 */
export function Waveform({ url, showFraction = 1, className, style }: { url: string; showFraction?: number; className?: string; style?: React.CSSProperties }) {
  const [data, setData] = useState<{ url: string; peaks: Float32Array | null } | null>(null);
  useEffect(() => {
    let live = true;
    void peaks(url).then((p) => live && setData({ url, peaks: p }));
    return () => {
      live = false;
    };
  }, [url]);
  const p = data?.url === url ? data.peaks : null;
  const n = p ? Math.max(1, Math.round(BUCKETS * Math.min(1, showFraction))) : 0;
  return (
    <svg viewBox={`0 0 ${Math.max(n, 1)} 2`} preserveAspectRatio="none" className={className} style={style} aria-hidden>
      {p ? (
        Array.from({ length: n }, (_, i) => {
          const h = Math.max(0.06, p[i]);
          return <rect key={i} x={i} y={1 - h} width={0.8} height={h * 2} fill="currentColor" />;
        })
      ) : (
        <rect x={0} y={0.85} width={1} height={0.3} fill="currentColor" />
      )}
    </svg>
  );
}
