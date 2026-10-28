"use client";

import { useState, useSyncExternalStore } from "react";
import { PHASES, paletteAt, phaseAt, type OceanPalette, type PhaseName } from "@/components/pixel/oceanPhases";
import { Sprite } from "@/components/pixel/Sprite";
import { ArcadeLabel } from "@/components/ui/primitives";

type Mode = "auto" | PhaseName;
const ORDER: Mode[] = ["auto", "dawn", "day", "sunset", "night"];

// Local wall clock in minutes, re-read every 30s. The server snapshot is noon so SSR is deterministic.
const subscribe = (cb: () => void) => {
  const id = setInterval(cb, 30_000);
  return () => clearInterval(id);
};
const minutesNow = () => {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
};

/** Ocean palette from the visitor's local time, with a manual override for demos. */
export function useOceanPhase() {
  const minutes = useSyncExternalStore(subscribe, minutesNow, () => 12 * 60);
  const [mode, setMode] = useState<Mode>("auto");
  const hour = minutes / 60;
  const palette: OceanPalette = mode === "auto" ? paletteAt(hour) : PHASES[mode];
  const phase: PhaseName = mode === "auto" ? phaseAt(hour) : mode;
  const cycle = () => setMode((m) => ORDER[(ORDER.indexOf(m) + 1) % ORDER.length]);
  return { palette, phase, mode, cycle };
}

export function PhaseButton({ phase, mode, onClick }: { phase: PhaseName; mode: Mode; onClick: () => void }) {
  const night = phase === "night";
  return (
    <button
      type="button"
      onClick={onClick}
      title="Change the time of day under the sea"
      aria-label={`Ocean time of day: ${mode === "auto" ? `auto (${phase})` : phase}. Click to change.`}
      className="px-btn inline-flex h-10 items-center gap-2.5 bg-ink/85 px-3 text-paper [--px-c:var(--color-edge)]"
    >
      <Sprite name={night ? "moon" : "sun"} scale={3} swap={phase === "sunset" ? { y: "#ff9f5a", Y: "#ff77a8" } : phase === "dawn" ? { y: "#ffb8a8", Y: "#ff77a8" } : undefined} />
      <ArcadeLabel className="text-[10px]">
        {mode === "auto" ? "Auto · " : ""}
        {phase}
      </ArcadeLabel>
    </button>
  );
}
