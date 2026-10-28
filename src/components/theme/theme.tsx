"use client";

import { useSyncExternalStore } from "react";
import { Sprite } from "@/components/pixel/Sprite";
import { THEME_STORAGE_KEY as KEY } from "./bootScript";

export type Theme = "light" | "dark";
const EVENT = "ff-theme-change";

function current(): Theme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
}

export function setTheme(t: Theme) {
  document.documentElement.dataset.theme = t;
  try {
    localStorage.setItem(KEY, t);
  } catch {
    // Storage can be unavailable (private mode); the theme still applies for this page.
  }
  window.dispatchEvent(new Event(EVENT));
}

export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, current, () => "dark");
}

export function ThemeToggle({ className }: { className?: string }) {
  const theme = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      className={`px-btn inline-flex size-9 shrink-0 items-center justify-center bg-raised [--px-c:var(--color-edge)] ${className ?? ""}`}
    >
      {theme === "dark" ? <Sprite name="moon" scale={3} /> : <Sprite name="sun" scale={3} />}
    </button>
  );
}
