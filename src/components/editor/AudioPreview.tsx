"use client";

import { useEffect, useMemo, useRef } from "react";
import { audioPlan, musicGainAt, musicPositionMs, type AudioPlan } from "@/lib/engine/audio";
import { resolveAssetSrc } from "@/components/render/SceneView";
import { useEditor } from "@/store/editor";

/** Resync an element when it drifts this far from the playhead. */
const DRIFT_SEC = 0.25;

function follow(el: HTMLAudioElement, posSec: number, volume: number) {
  el.volume = Math.max(0, Math.min(1, volume));
  if (el.paused) {
    el.currentTime = posSec;
    el.play().catch(() => undefined);
  } else if (Math.abs(el.currentTime - posSec) > DRIFT_SEC) {
    el.currentTime = posSec;
  }
}

const stop = (el: HTMLAudioElement) => {
  if (!el.paused) el.pause();
};

/**
 * Plays narration and music in the editor, following the playhead. Timing comes from the same
 * audioPlan the exporter mixes from, so preview and file agree. Renders nothing.
 */
export function AudioPreview() {
  const project = useEditor((s) => s.project)!;
  const playing = useEditor((s) => s.playing);
  const plan = useMemo(() => audioPlan(project), [project]);
  const voices = useRef(new Map<string, HTMLAudioElement>());
  const music = useRef<{ src: string; el: HTMLAudioElement } | null>(null);
  const planRef = useRef<AudioPlan>(plan);

  // Keep one element per narration file and one for the music; drop ones no longer used.
  useEffect(() => {
    planRef.current = plan;
    const want = new Set(plan.narration.map((c) => c.src));
    for (const [src, el] of voices.current) {
      if (!want.has(src)) {
        el.pause();
        el.removeAttribute("src");
        voices.current.delete(src);
      }
    }
    for (const src of want) {
      if (!voices.current.has(src)) {
        const el = new Audio(resolveAssetSrc(project.id, src));
        el.preload = "auto";
        voices.current.set(src, el);
      }
    }
    const m = plan.music;
    if (music.current && music.current.src !== m?.src) {
      music.current.el.pause();
      music.current = null;
    }
    if (m && !music.current) {
      const el = new Audio(resolveAssetSrc(project.id, m.src));
      el.preload = "auto";
      music.current = { src: m.src, el };
    }
  }, [plan, project.id]);

  useEffect(() => {
    const pauseAll = () => {
      for (const el of voices.current.values()) stop(el);
      if (music.current) stop(music.current.el);
    };
    if (!playing) {
      pauseAll();
      return;
    }
    const sync = (t: number) => {
      const p = planRef.current;
      const active = p.narration.find((c) => t >= c.startMs && t < c.endMs);
      for (const [src, el] of voices.current) {
        if (active && active.src === src) follow(el, (t - active.startMs) / 1000, active.volume);
        else stop(el);
      }
      if (music.current) {
        const gain = musicGainAt(p, t);
        if (gain > 0) follow(music.current.el, musicPositionMs(p, t) / 1000, gain);
        else stop(music.current.el);
      }
    };
    sync(useEditor.getState().timeMs);
    const unsub = useEditor.subscribe((s, prev) => {
      if (s.timeMs !== prev.timeMs) sync(s.timeMs);
    });
    return () => {
      unsub();
      pauseAll();
    };
  }, [playing]);

  // Release everything when the editor closes.
  useEffect(
    () => () => {
      for (const el of voices.current.values()) el.pause();
      music.current?.el.pause();
    },
    [],
  );

  return null;
}
