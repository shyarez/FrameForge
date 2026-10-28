/**
 * Time-of-day palettes for the ocean hero. Pure and deterministic: the scene colour is a
 * blend of the two phases surrounding the given hour.
 */

export type PhaseName = "dawn" | "day" | "sunset" | "night";

export interface OceanPalette {
  surface: string;
  /** Water bands, shallow to deep. */
  bands: [string, string, string, string, string];
  farReef: string;
  midReef: string;
  kelp1: string;
  kelp2: string;
  sand: string;
  sandDeep: string;
  ray: string;
  /** 0..1 strength of the light rays. */
  rays: number;
  mote: string;
  /** 0..1 bioluminescence (jelly halos, glowing plankton). */
  glow: number;
  /** 0..1 moonlight shimmer on the surface. */
  moon: number;
  /** Colour wash over the reef for mood (night darkening, sunset warmth). */
  wash: string;
  washAlpha: number;
}

export const PHASES: Record<PhaseName, OceanPalette> = {
  dawn: {
    surface: "#ffd9c7",
    bands: ["#ffb8a8", "#8fd3c8", "#4fa9b0", "#2b7c93", "#1a5a75"],
    farReef: "#22647a",
    midReef: "#15485e",
    kelp1: "#2a7a5e",
    kelp2: "#3b9470",
    sand: "#f0cfa0",
    sandDeep: "#d9b384",
    ray: "#ffe3d6",
    rays: 0.8,
    mote: "#ffe9e0",
    glow: 0.15,
    moon: 0,
    wash: "#ff9f8a",
    washAlpha: 0.08,
  },
  day: {
    surface: "#8af5e4",
    bands: ["#3fd8c9", "#1ba5b3", "#11809a", "#0b5f7b", "#08465f"],
    farReef: "#0a536b",
    midReef: "#073a4f",
    kelp1: "#1d7a5a",
    kelp2: "#2a9a6c",
    sand: "#e9c98b",
    sandDeep: "#d4b06f",
    ray: "#effffb",
    rays: 1,
    mote: "#bff8ee",
    glow: 0,
    moon: 0,
    wash: "#ffffff",
    washAlpha: 0,
  },
  sunset: {
    surface: "#ffc46b",
    bands: ["#ff9f5a", "#e0786a", "#3f7f8f", "#1f5a73", "#123f58"],
    farReef: "#1b4c63",
    midReef: "#10374b",
    kelp1: "#2f6b4c",
    kelp2: "#4b8a5c",
    sand: "#e3b27a",
    sandDeep: "#c9955e",
    ray: "#ffd39a",
    rays: 0.9,
    mote: "#ffe0b0",
    glow: 0.3,
    moon: 0,
    wash: "#ff8a4a",
    washAlpha: 0.12,
  },
  night: {
    surface: "#2a6f8f",
    bands: ["#1a5677", "#123f60", "#0c3150", "#082640", "#051c33"],
    farReef: "#0a2a40",
    midReef: "#061d30",
    kelp1: "#0f4a3a",
    kelp2: "#17614a",
    sand: "#5d6f74",
    sandDeep: "#47585e",
    ray: "#cfe8ff",
    rays: 0,
    mote: "#8ffff0",
    glow: 1,
    moon: 1,
    wash: "#021226",
    washAlpha: 0.32,
  },
};

/** Phase keyframes across a 24h day (hours, local time). */
const KEYS: [number, PhaseName][] = [
  [0, "night"],
  [4.5, "night"],
  [6, "dawn"],
  [8, "day"],
  [16.5, "day"],
  [18.5, "sunset"],
  [20, "night"],
  [24, "night"],
];

export function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (shift: number) => {
    const x = (pa >> shift) & 255;
    const y = (pb >> shift) & 255;
    return Math.round(x + (y - x) * t);
  };
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, "0")}`;
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

export function mixPalette(a: OceanPalette, b: OceanPalette, t: number): OceanPalette {
  return {
    surface: mixHex(a.surface, b.surface, t),
    bands: a.bands.map((c, i) => mixHex(c, b.bands[i], t)) as OceanPalette["bands"],
    farReef: mixHex(a.farReef, b.farReef, t),
    midReef: mixHex(a.midReef, b.midReef, t),
    kelp1: mixHex(a.kelp1, b.kelp1, t),
    kelp2: mixHex(a.kelp2, b.kelp2, t),
    sand: mixHex(a.sand, b.sand, t),
    sandDeep: mixHex(a.sandDeep, b.sandDeep, t),
    ray: mixHex(a.ray, b.ray, t),
    rays: mix(a.rays, b.rays, t),
    mote: mixHex(a.mote, b.mote, t),
    glow: mix(a.glow, b.glow, t),
    moon: mix(a.moon, b.moon, t),
    wash: mixHex(a.wash, b.wash, t),
    washAlpha: mix(a.washAlpha, b.washAlpha, t),
  };
}

/** Palette for a local hour in [0, 24). */
export function paletteAt(hour: number): OceanPalette {
  const h = ((hour % 24) + 24) % 24;
  for (let i = 0; i < KEYS.length - 1; i++) {
    const [h0, p0] = KEYS[i];
    const [h1, p1] = KEYS[i + 1];
    if (h >= h0 && h < h1) return mixPalette(PHASES[p0], PHASES[p1], (h - h0) / (h1 - h0));
  }
  return PHASES.night;
}

/** Dominant phase name for a local hour, for labels. */
export function phaseAt(hour: number): PhaseName {
  const h = ((hour % 24) + 24) % 24;
  if (h >= 5 && h < 7.5) return "dawn";
  if (h >= 7.5 && h < 17.5) return "day";
  if (h >= 17.5 && h < 19.5) return "sunset";
  return "night";
}
