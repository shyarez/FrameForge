"use client";

import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { gradientBands, type OceanPalette } from "./oceanPhases";
import { SpriteG, type Swap } from "./Sprite";

/**
 * Original procedural pixel-art underwater scene: light rays, swaying seagrass,
 * coral, rising bubbles, swimming fish and a sunken TV playing a looping chart.
 * Every shape sits on a 1-unit grid rendered with crispEdges. Deterministic (seeded) layout.
 */

const W = 320;
const H = 150;
/** Water is drawn as this many blended bands of BAND_H units from the surface down. */
const WATER_BANDS = 12;
const BAND_H = 9;

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function ridgePath(heights: number[], step: number) {
  let d = `M0 ${H}`;
  heights.forEach((h, i) => (d += ` V${h} H${(i + 1) * step}`));
  return `${d} V${H} Z`;
}

function ridge(seed: number, base: number, amp: number, freq: number, step = 2) {
  const r = rng(seed);
  const phase = r() * 10;
  const cols = Math.ceil(W / step);
  return Array.from({ length: cols }, (_, i) => {
    const x = i / cols;
    const v = Math.sin(x * freq + phase) * 0.6 + Math.sin(x * freq * 2.7 + phase * 2) * 0.3 + (r() - 0.5) * 0.2;
    return Math.round(base - v * amp);
  });
}

/** One seagrass blade drawn in two sway frames that alternate (classic 2-frame sprite animation). */
function Blade({ x, y, h, c1, c2, phase }: { x: number; y: number; h: number; c1: string; c2: string; phase: number }) {
  const frame = (dir: number) =>
    Array.from({ length: h }, (_, i) => {
      const t = i / h;
      const off = Math.round(Math.sin(t * 2.4 + phase) * 2.2 * t * dir);
      const wide = i < h * 0.55;
      return <rect key={i} x={x + off} y={y - i - 1} width={wide ? 2 : 1} height={1} fill={i % 3 === 0 ? c2 : c1} />;
    });
  return (
    <g>
      <g className="ff-sway-a">{frame(1)}</g>
      <g className="ff-sway-b">{frame(-1)}</g>
    </g>
  );
}

/** Branching pink coral. */
function Coral({ x, y, s }: { x: number; y: number; s: number }) {
  const parts: ReactNode[] = [];
  parts.push(<rect key="t" x={x} y={y - s * 3} width={2} height={s * 3} fill="#d14a7d" />);
  for (let i = 0; i < s; i++) {
    const by = y - 3 - i * 3;
    const len = 2 + ((i * 7) % 3);
    parts.push(<rect key={`l${i}`} x={x - len} y={by} width={len} height={1} fill="#ff77a8" />);
    parts.push(<rect key={`lv${i}`} x={x - len} y={by - 2} width={1} height={2} fill="#ff77a8" />);
    parts.push(<rect key={`r${i}`} x={x + 2} y={by - 1} width={len} height={1} fill="#ff77a8" />);
    parts.push(<rect key={`rv${i}`} x={x + 1 + len} y={by - 3} width={1} height={2} fill="#ff9cc2" />);
  }
  parts.push(<rect key="top" x={x} y={y - s * 3 - 2} width={2} height={2} fill="#ff9cc2" />);
  return <g>{parts}</g>;
}

/** Round "brain" coral built from pixel rows. */
function Dome({ x, y, r, c, shade }: { x: number; y: number; r: number; c: string; shade: string }) {
  const rows: ReactNode[] = [];
  for (let dy = 0; dy <= r; dy++) {
    const half = Math.floor(Math.sqrt(r * r - dy * dy));
    rows.push(<rect key={dy} x={x - half} y={y - dy} width={half * 2 + 1} height={1} fill={dy % 2 ? shade : c} />);
  }
  return <g>{rows}</g>;
}

interface Swimmer {
  y: number;
  dur: number;
  delay: number;
  dir: "l" | "r";
  swap: Swap;
  school: number;
}

const FISH_COLOURS: Swap[] = [
  { f: "#ff77a8", F: "#ffd166" },
  { f: "#ffd166", F: "#ff9f5a" },
  { f: "#38a6ff", F: "#4ff0d0" },
  { f: "#4ff0d0", F: "#effffb" },
  { f: "#7be495", F: "#ffd166" },
];

/** Fill via style so CSS can transition it when the time-of-day palette changes. */
const tint = (fill: string) => ({ className: "ff-tint", style: { fill } });

export function PixelOcean({ className, palette: p }: { className?: string; palette: OceanPalette }) {
  const ref = useRef<SVGSVGElement>(null);

  // Parallax: pointer position drives CSS variables; no React re-render per move.
  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        el.style.setProperty("--mx", String(e.clientX / window.innerWidth - 0.5));
        el.style.setProperty("--my", String(e.clientY / window.innerHeight - 0.5));
      });
    };
    window.addEventListener("pointermove", onMove);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
    };
  }, []);

  const scene = useMemo(() => {
    const r = rng(19);
    const farReef = ridge(5, 112, 10, 6);
    const midReef = ridge(29, 124, 6, 5);
    const sand = ridge(47, 134, 3, 4, 4);
    const sandAt = (x: number) => sand[Math.min(sand.length - 1, Math.floor(x / 4))];
    const blades = Array.from({ length: 70 }, () => {
      const x = Math.floor(r() * W);
      return { x, y: sandAt(x) + 1, h: 8 + Math.floor(r() * 18), phase: r() * 6, tall: false };
    }).filter((b) => b.x < 240 || b.x > 300);
    const kelp = [8, 16, 22, 300, 308, 314].map((x) => ({ x, y: sandAt(x) + 1, h: 40 + Math.floor(r() * 30), phase: r() * 6, tall: true }));
    const corals = [34, 92, 150, 205, 232].map((x) => ({ x, y: sandAt(x) + 1, s: 3 + Math.floor(r() * 3) }));
    const domes = [
      { x: 60, r: 5, c: "#4ff0d0", shade: "#1fb39a" },
      { x: 128, r: 4, c: "#ffd166", shade: "#d9a23a" },
      { x: 186, r: 6, c: "#38a6ff", shade: "#1c6fc4" },
    ].map((d) => ({ ...d, y: sandAt(d.x) }));
    const pebbles = Array.from({ length: 40 }, () => {
      const x = Math.floor(r() * W);
      return { x, y: sandAt(x) + 3 + Math.floor(r() * 10), c: r() > 0.5 ? "#c9a663" : "#f4dca6" };
    });
    const bubbles = Array.from({ length: 16 }, () => ({ x: Math.floor(r() * W), y: 128 - Math.floor(r() * 10), d: (r() * 6).toFixed(2), dur: (5 + r() * 4).toFixed(2) }));
    const motes = Array.from({ length: 30 }, () => ({ x: Math.floor(r() * W), y: 10 + Math.floor(r() * 100), d: (r() * 3).toFixed(2) }));
    const swimmers: Swimmer[] = Array.from({ length: 7 }, (_, i) => ({
      y: 34 + Math.floor(r() * 70),
      dur: 26 + Math.floor(r() * 22),
      delay: -Math.floor(r() * 40),
      dir: i % 3 === 0 ? "r" : "l",
      swap: FISH_COLOURS[i % FISH_COLOURS.length],
      school: i % 2 === 0 ? 3 : 1,
    }));
    return { farReef, midReef, sand, blades, kelp, corals, domes, pebbles, bubbles, motes, swimmers, sandAt };
  }, []);

  const layer = (depth: number) => ({
    transform: `translate(calc(var(--mx, 0) * ${-depth}px), calc(var(--my, 0) * ${-depth * 0.4}px))`,
    transition: "transform 400ms steps(4)",
  });

  // Sunken TV geometry.
  const tx = 252;
  const ty = scene.sandAt(272) - 30;
  const bars = [
    { h: 8, c: "#4ff0d0", d: "0s" },
    { h: 14, c: "#38a6ff", d: "0.3s" },
    { h: 6, c: "#ff77a8", d: "0.6s" },
    { h: 16, c: "#ffd166", d: "0.9s" },
    { h: 11, c: "#7be495", d: "1.2s" },
  ];

  const water = gradientBands(p.bands, WATER_BANDS);

  return (
    <svg ref={ref} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMax slice" className={`pixelated ${className ?? ""}`} aria-hidden="true">
      <defs>
        {[
          // Each water band dithers into the one above it.
          ...water.map((c, i) => [`wd${i}`, c, i === 0 ? p.surface : water[i - 1]] as const),
          ["s1", "#031a24", p.sandDeep] as const,
        ].map(([id, a, b]) => (
          <pattern key={id} id={id} width={2} height={2} patternUnits="userSpaceOnUse">
            <rect width={2} height={2} {...tint(a)} />
            <rect width={1} height={1} {...tint(b)} />
            <rect x={1} y={1} width={1} height={1} {...tint(b)} />
          </pattern>
        ))}
      </defs>

      {/* Water column: a smooth gradient of narrow bands from the surface down, with dithered seams */}
      <rect width={W} height={H} {...tint(water[water.length - 1])} />
      <rect width={W} height={4} {...tint(p.surface)} />
      {water.map((c, i) => (
        <g key={i}>
          <rect y={4 + i * BAND_H} width={W} height={BAND_H} {...tint(c)} />
          <rect y={4 + i * BAND_H} width={W} height={2} fill={`url(#wd${i})`} />
        </g>
      ))}

      {/* Moonlight shimmer on the surface at night */}
      <g opacity={p.moon * 0.7} className="ff-tint">
        <g className="ff-sway-a" fill="#d8ecff">
          <rect x={228} y={1} width={22} height={1} />
          <rect x={232} y={3} width={14} height={1} />
          <rect x={236} y={5} width={6} height={1} />
        </g>
        <g className="ff-sway-b" fill="#d8ecff">
          <rect x={226} y={2} width={24} height={1} />
          <rect x={234} y={4} width={12} height={1} />
        </g>
      </g>

      {/* Surface ripples (two frames) */}
      <g className="ff-sway-a" fill="#effffb">
        {Array.from({ length: 20 }, (_, i) => <rect key={i} x={i * 16 + 2} y={1} width={6} height={1} />)}
      </g>
      <g className="ff-sway-b" fill="#effffb">
        {Array.from({ length: 20 }, (_, i) => <rect key={i} x={i * 16 + 9} y={2} width={5} height={1} />)}
      </g>

      {/* God rays */}
      <g opacity={p.rays} className="ff-tint" style={{ fill: p.ray }}>
        {[20, 70, 130, 190, 250].map((x, i) => (
          <polygon key={x} points={`${x},0 ${x + 14},0 ${x + 44},120 ${x + 26},120`} className="ff-ray" style={{ animationDelay: `${i * 0.7}s` }} />
        ))}
      </g>

      {/* Far reef silhouette */}
      <g style={layer(4)}>
        <path d={ridgePath(scene.farReef, 2)} {...tint(p.farReef)} />
        {scene.kelp.map((k, i) => <Blade key={i} {...k} c1={p.kelp1} c2={p.kelp2} />)}
      </g>

      {/* Fish in the middle water */}
      {scene.swimmers.map((s, i) => (
        <g key={i} className={s.dir === "l" ? "ff-swim-l" : "ff-swim-r"} style={{ animationDuration: `${s.dur}s`, animationDelay: `${s.delay}s` }}>
          <g className="animate-bob" style={{ animationDelay: `${i * 0.3}s` }}>
            {Array.from({ length: s.school }, (_, j) => (
              <SpriteG key={j} name="fish" x={j * 14} y={s.y + (j % 2) * 6 - j * 2} swap={s.swap} flip={s.dir === "r"} />
            ))}
          </g>
        </g>
      ))}

      {/* Jellyfish */}
      <g className="ff-jelly" style={layer(3)}>
        <SpriteG name="jelly" x={70} y={38} />
      </g>
      <g className="ff-jelly" style={{ ...layer(3), animationDelay: "-2.5s" }}>
        <SpriteG name="jelly" x={286} y={20} swap={{ c: "#c9a7ff", C: "#8f73e6" }} />
      </g>

      {/* Mid reef */}
      <g style={layer(7)}>
        <path d={ridgePath(scene.midReef, 2)} {...tint(p.midReef)} />
      </g>

      {/* Seafloor */}
      <g style={layer(10)}>
        <path d={ridgePath(scene.sand, 4)} {...tint(p.sand)} />
        <rect y={142} width={W} height={8} {...tint(p.sandDeep)} />
        {scene.pebbles.map((p, i) => <rect key={i} x={p.x} y={p.y} width={2} height={1} fill={p.c} />)}
        {scene.domes.map((d, i) => <Dome key={i} {...d} />)}
        {scene.corals.map((c, i) => <Coral key={i} {...c} />)}
        {scene.blades.map((b, i) => <Blade key={i} {...b} c1={i % 4 === 0 ? "#4ff0d0" : "#3fae63"} c2={i % 4 === 0 ? "#1fb39a" : "#7be495"} />)}

        {/* Sunken TV playing a chart */}
        <rect x={tx - 2} y={ty - 2} width={46} height={32} fill="#031a24" />
        <rect x={tx} y={ty} width={42} height={28} fill="#0e4351" />
        <rect x={tx + 3} y={ty + 3} width={30} height={22} fill="#052733" />
        {bars.map((b, i) => (
          <rect key={i} x={tx + 5 + i * 5} y={ty + 23 - b.h} width={4} height={b.h} fill={b.c} className="ff-bar" style={{ animationDelay: b.d }} />
        ))}
        <rect x={tx + 36} y={ty + 5} width={3} height={3} fill="#ff77a8" />
        <rect x={tx + 36} y={ty + 10} width={3} height={3} fill="#ffd166" />
        <rect x={tx + 35} y={ty + 16} width={5} height={1} fill="#186571" />
        <rect x={tx + 35} y={ty + 19} width={5} height={1} fill="#186571" />
        <rect x={tx + 12} y={ty - 8} width={1} height={6} fill="#031a24" />
        <rect x={tx + 24} y={ty - 6} width={1} height={4} fill="#031a24" />
        <rect x={tx + 11} y={ty - 9} width={3} height={1} fill="#7fb3b8" />
        <SpriteG name="starfish" x={tx + 46} y={scene.sandAt(tx + 46) - 3} />
        <SpriteG name="starfish" x={22} y={scene.sandAt(22) + 2} swap={{ y: "#ff77a8", Y: "#d14a7d" }} />

        {/* Rising bubbles */}
        {scene.bubbles.map((b, i) => (
          <g key={i} className="ff-rise" style={{ animationDelay: `-${b.d}s`, animationDuration: `${b.dur}s` }}>
            <SpriteG name="bubble" x={b.x} y={b.y} />
          </g>
        ))}
      </g>

      {/* Mood wash: darkens the reef at night, warms it at sunset */}
      <rect width={W} height={H} opacity={p.washAlpha} {...tint(p.wash)} />

      {/* Bioluminescence: jelly halos and glowing plankton sit above the wash so they read at night */}
      <g opacity={p.glow} className="ff-tint">
        {(
          [
            [70, 38, "#ff9cc2", "0s"],
            [286, 20, "#c9a7ff", "-2.5s"],
          ] as const
        ).map(([x, y, c, delay]) => (
          <g key={x} className="ff-jelly" style={{ ...layer(3), animationDelay: delay }}>
            <rect x={x - 3} y={y - 1} width={15} height={8} fill={c} opacity={0.18} />
            <rect x={x - 1} y={y - 3} width={11} height={14} fill={c} opacity={0.14} />
            <rect x={x + 1} y={y + 1} width={7} height={4} fill={c} opacity={0.35} />
          </g>
        ))}
      </g>
      {/* Twinkle animates each mote's opacity, so the glow strength is applied on the group. */}
      <g style={layer(2)} opacity={0.55 + p.glow * 0.45}>
        {scene.motes.map((m, i) => (
          <rect key={i} x={m.x} y={m.y} width={p.glow > 0.5 && i % 3 === 0 ? 2 : 1} height={1}
            className="animate-twinkle ff-tint" style={{ fill: p.mote, animationDelay: `${m.d}s` }} />
        ))}
      </g>
      <rect y={146} width={W} height={4} fill="url(#s1)" />
    </svg>
  );
}
