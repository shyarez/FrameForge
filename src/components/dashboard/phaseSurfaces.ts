import { mixHex, phaseWeights, type PhaseName } from "@/components/pixel/oceanPhases";

/**
 * Dashboard page colours that follow the ocean's time of day, in both themes.
 * Dark: deep versions of each phase's hue. Light: soft tinted off-whites (never pure white).
 * The editor never uses these — it keeps the fixed theme colours.
 */

export type Theme = "light" | "dark";

export interface SurfaceTokens {
  ink: string;
  night: string;
  panel: string;
  raised: string;
  line: string;
  mute: string;
  paper: string;
  aquaInk: string;
  yellowInk: string;
  coralInk: string;
  mintInk: string;
  edge: string;
  shadow: string;
  nav: string;
}

export const SURFACES: Record<PhaseName, Record<Theme, SurfaceTokens>> = {
  dawn: {
    dark: {
      ink: "#14181f", night: "#1c2128", panel: "#242a31", raised: "#323a41", line: "#56606a", mute: "#cdbfb8", paper: "#fff4ee",
      aquaInk: "#7fe3d0", yellowInk: "#ffd6a0", coralInk: "#ffa3b0", mintInk: "#8fe6a8", edge: "#0b0e12", shadow: "#06080b", nav: "#2a2327",
    },
    light: {
      ink: "#f6ebe5", night: "#f1e2da", panel: "#f9efe9", raised: "#eed9cf", line: "#c39189", mute: "#6a4744", paper: "#3a1f1f",
      aquaInk: "#0a6659", yellowInk: "#7d4e00", coralInk: "#a42c4f", mintInk: "#1d653c", edge: "#6e3b3b", shadow: "#e1c3b9", nav: "#f3dfd6",
    },
  },
  day: {
    dark: {
      ink: "#031a24", night: "#05242f", panel: "#082f3c", raised: "#0e4351", line: "#186571", mute: "#8cc4c4", paper: "#effffb",
      aquaInk: "#4ff0d0", yellowInk: "#ffd166", coralInk: "#ff77a8", mintInk: "#7be495", edge: "#031a24", shadow: "#010f17", nav: "#04202b",
    },
    light: {
      ink: "#e8f2ec", night: "#e0ece5", panel: "#ecf4ef", raised: "#d6eae2", line: "#74ada4", mute: "#38605f", paper: "#082c36",
      aquaInk: "#076a5a", yellowInk: "#7f5200", coralInk: "#a8244f", mintInk: "#186437", edge: "#0b4652", shadow: "#b0d3c9", nav: "#ddeee8",
    },
  },
  sunset: {
    dark: {
      ink: "#1c0e18", night: "#271321", panel: "#32182b", raised: "#45213b", line: "#6e3a5e", mute: "#e0b6c9", paper: "#fff1f4",
      aquaInk: "#6ff0d6", yellowInk: "#ffcf7a", coralInk: "#ffa0c2", mintInk: "#8ef0a6", edge: "#12070f", shadow: "#0b040a", nav: "#2e1424",
    },
    light: {
      ink: "#f7e6d8", night: "#f2dccb", panel: "#faede2", raised: "#efd2bd", line: "#cf9577", mute: "#6a4230", paper: "#3d1a12",
      aquaInk: "#0a6457", yellowInk: "#774900", coralInk: "#a0244b", mintInk: "#1d633b", edge: "#73351f", shadow: "#e5bea1", nav: "#f4d8c3",
    },
  },
  night: {
    dark: {
      ink: "#050c1f", night: "#0a1530", panel: "#0f1d3d", raised: "#172a52", line: "#2b4373", mute: "#a8b8da", paper: "#eef3ff",
      aquaInk: "#6ff4e0", yellowInk: "#ffd98a", coralInk: "#ff9cc0", mintInk: "#8ef0b0", edge: "#030814", shadow: "#02050d", nav: "#081229",
    },
    light: {
      ink: "#e5e9f2", night: "#dce2ed", panel: "#ebeef5", raised: "#d0d8e7", line: "#8494b8", mute: "#42506c", paper: "#101a33",
      aquaInk: "#07625a", yellowInk: "#754e00", coralInk: "#9e2954", mintInk: "#186036", edge: "#1f2c4d", shadow: "#b9c3d7", nav: "#d9e0ec",
    },
  },
};

const KEYS = Object.keys(SURFACES.day.dark) as (keyof SurfaceTokens)[];

/** Surface tokens for a local hour, blended with the same phase weights as the water. */
export function surfacesAt(hour: number, theme: Theme): SurfaceTokens {
  const { a, b, t } = phaseWeights(hour);
  const A = SURFACES[a][theme];
  const B = SURFACES[b][theme];
  return Object.fromEntries(KEYS.map((k) => [k, mixHex(A[k], B[k], t)])) as unknown as SurfaceTokens;
}

/** CSS custom properties that re-theme a subtree (Tailwind utilities read these variables). */
export function surfaceVars(s: SurfaceTokens): Record<string, string> {
  return {
    "--color-ink": s.ink,
    "--color-night": s.night,
    "--color-panel": s.panel,
    "--color-raised": s.raised,
    "--color-line": s.line,
    "--color-mute": s.mute,
    "--color-paper": s.paper,
    "--color-aqua-ink": s.aquaInk,
    "--color-yellow-ink": s.yellowInk,
    "--color-coral-ink": s.coralInk,
    "--color-mint-ink": s.mintInk,
    "--color-edge": s.edge,
    "--color-shadow": s.shadow,
    "--color-nav": s.nav,
  };
}
