"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { projectDurationMs } from "@/lib/schema/project";
import { Logo } from "@/components/brand/Logo";
import { useEditor } from "@/store/editor";
import { CanvasStage } from "./CanvasStage";
import { ExportDialog } from "./ExportDialog";
import { Inspector } from "./Inspector";
import { LeftPanel } from "./LeftPanel";
import { PlaybackBar, Timeline } from "./Timeline";
import { TopBar } from "./TopBar";

const AUTOSAVE_MS = 1200;

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));

export function EditorApp({ projectId }: { projectId: string }) {
  const project = useEditor((s) => s.project);
  const playing = useEditor((s) => s.playing);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const saveChain = useRef<Promise<boolean>>(Promise.resolve(true));

  useEffect(() => {
    let cancelled = false;
    api
      .getProject(projectId)
      .then(({ project }) => !cancelled && useEditor.getState().load(project))
      .catch((e) => !cancelled && setLoadError(e.message));
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  /** Saves are serialised so an older snapshot can never overwrite a newer one. */
  const save = useCallback(() => {
    saveChain.current = saveChain.current.then(async () => {
      const { project, setSaveState } = useEditor.getState();
      if (!project) return false;
      if (useEditor.getState().saveState === "saved") return true;
      setSaveState("saving");
      try {
        await api.saveProject(project);
        setSaveState(useEditor.getState().project === project ? "saved" : "dirty");
        return true;
      } catch (e) {
        setSaveState("error", e instanceof Error ? e.message : String(e));
        return false;
      }
    });
    return saveChain.current;
  }, []);

  // Debounced autosave whenever the document changes.
  useEffect(() => {
    if (!project) return;
    if (useEditor.getState().saveState !== "dirty") return;
    const t = setTimeout(save, AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [project, save]);

  // Warn before leaving with unsaved edits.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      const s = useEditor.getState().saveState;
      if (s === "dirty" || s === "saving") e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  // Playback clock: wall time only advances the playhead; frames still come from evaluateProject.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const startWall = performance.now();
    const startT = useEditor.getState().timeMs;
    const tick = () => {
      const { project, setTime, setPlaying } = useEditor.getState();
      if (!project) return;
      const total = projectDurationMs(project);
      const t = startT + (performance.now() - startWall);
      if (t >= total) {
        setTime(total);
        setPlaying(false);
        return;
      }
      setTime(t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useEditor.getState();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
        return;
      }
      if (isTyping(e.target)) return;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        s.redo();
      } else if (e.key === " ") {
        e.preventDefault();
        s.setPlaying(!s.playing);
      } else if ((e.key === "Delete" || e.key === "Backspace") && s.selectedElementId) {
        e.preventDefault();
        s.deleteElement(s.selectedElementId);
      } else if (e.key === "Escape") {
        s.selectElement(null);
      } else if (e.key.startsWith("Arrow") && s.selectedElementId && s.project) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        const id = s.selectedElementId;
        s.commit((d) => {
          for (const sc of d.scenes) {
            const el = sc.elements.find((x) => x.id === id);
            if (el) {
              el.x += dx;
              el.y += dy;
            }
          }
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save]);

  if (loadError) {
    return (
      <main className="bg-dots flex h-screen flex-col items-center justify-center gap-4 text-center">
        <Logo className="size-14" />
        <h1 className="font-display text-2xl font-bold">Couldn&apos;t open this project</h1>
        <p className="text-sm text-mute">{loadError}</p>
        <Link href="/" className="btn-press rounded-xl bg-yellow px-4 py-2 text-sm font-semibold text-ink">Back to projects</Link>
      </main>
    );
  }
  if (!project || project.id !== projectId) {
    return (
      <main className="flex h-screen items-center justify-center" aria-busy="true">
        <div className="flex items-center gap-3 text-mute">
          <Logo className="size-8 animate-bounce motion-reduce:animate-none" /> Loading editor…
        </div>
      </main>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <TopBar onSave={() => void save()} onExport={() => setExportOpen(true)} />
      <div className="flex min-h-0 flex-1">
        <LeftPanel />
        <main className="flex min-w-0 flex-1 flex-col">
          <CanvasStage />
          <PlaybackBar />
        </main>
        <Inspector />
      </div>
      <Timeline />
      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} save={save} />
    </div>
  );
}
