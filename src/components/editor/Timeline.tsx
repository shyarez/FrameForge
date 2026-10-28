"use client";

import { ChevronLeft, ChevronRight, Copy, Pause, Play, Plus, SkipBack, Trash2 } from "lucide-react";
import { useMemo, useRef } from "react";
import { evaluateProject, evaluateScene, sceneRestTime, sceneStartTimes } from "@/lib/engine/evaluate";
import { CANVAS_SIZES, projectDurationMs, type Project, type Scene } from "@/lib/schema/project";
import { SceneView } from "@/components/render/SceneView";
import { IconButton, cx } from "@/components/ui/primitives";
import { useEditor } from "@/store/editor";

export const fmtTime = (ms: number) => {
  const s = ms / 1000;
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
};

function SceneThumb({ project, scene }: { project: Project; scene: Scene }) {
  const logical = CANVAS_SIZES[project.aspectRatio];
  const h = 52;
  const scale = h / logical.height;
  const state = useMemo(
    () => ({ sceneIndex: 0, sceneStartMs: 0, localMs: 0, layers: [{ state: evaluateScene(scene, sceneRestTime(scene)), opacity: 1, translateX: 0 }] }),
    [scene],
  );
  return (
    <div className="shrink-0 overflow-hidden rounded-md" style={{ width: logical.width * scale, height: h }}>
      <div style={{ transform: `scale(${scale})`, transformOrigin: "0 0" }}>
        <SceneView state={state} width={logical.width} height={logical.height} projectId={project.id} />
      </div>
    </div>
  );
}

export function PlaybackBar() {
  const project = useEditor((s) => s.project)!;
  const timeMs = useEditor((s) => s.timeMs);
  const playing = useEditor((s) => s.playing);
  const { setPlaying, setTime } = useEditor.getState();
  const total = projectDurationMs(project);
  const sceneIndex = evaluateProject(project, timeMs).sceneIndex;

  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-t border-line bg-panel px-3">
      <IconButton label="Back to start" onClick={() => setTime(0)}>
        <SkipBack className="size-4" />
      </IconButton>
      <button
        onClick={() => setPlaying(!playing)}
        aria-label={playing ? "Pause" : "Play"}
        className="btn-press inline-flex size-9 items-center justify-center rounded-full bg-lavender text-ink hover:bg-[#cbbcff]"
      >
        {playing ? <Pause className="size-4" fill="currentColor" /> : <Play className="ml-0.5 size-4" fill="currentColor" />}
      </button>
      <span className="w-28 font-mono text-xs text-mute tabular-nums">
        <span className="text-paper">{fmtTime(timeMs)}</span> / {fmtTime(total)}
      </span>
      <input
        type="range"
        aria-label="Seek"
        min={0}
        max={total}
        step={1000 / 30}
        value={timeMs}
        onChange={(e) => {
          setPlaying(false);
          setTime(Number(e.target.value));
        }}
        className="h-1 flex-1 cursor-pointer accent-yellow"
      />
      <span className="w-24 text-right text-xs text-mute">
        Scene {sceneIndex + 1} / {project.scenes.length}
      </span>
    </div>
  );
}

export function Timeline() {
  const project = useEditor((s) => s.project)!;
  const timeMs = useEditor((s) => s.timeMs);
  const selectedSceneId = useEditor((s) => s.selectedSceneId);
  const { selectScene, addScene, duplicateScene, deleteScene, moveScene, setTime, setPlaying } = useEditor.getState();
  const trackRef = useRef<HTMLDivElement>(null);

  const total = projectDurationMs(project);
  const starts = sceneStartTimes(project);
  const pxPerMs = 0.045;
  const selIdx = project.scenes.findIndex((s) => s.id === selectedSceneId);

  return (
    <div className="flex h-36 shrink-0 flex-col border-t border-line bg-night">
      <div className="flex h-9 items-center gap-1 px-3">
        <span className="mr-2 font-display text-sm font-semibold">Scenes</span>
        <IconButton label="Add scene after selected" onClick={addScene}>
          <Plus className="size-4" />
        </IconButton>
        <IconButton label="Duplicate scene" disabled={selIdx < 0} onClick={() => selectedSceneId && duplicateScene(selectedSceneId)}>
          <Copy className="size-4" />
        </IconButton>
        <IconButton label="Move scene left" disabled={selIdx <= 0} onClick={() => selectedSceneId && moveScene(selectedSceneId, -1)}>
          <ChevronLeft className="size-4" />
        </IconButton>
        <IconButton label="Move scene right" disabled={selIdx < 0 || selIdx >= project.scenes.length - 1} onClick={() => selectedSceneId && moveScene(selectedSceneId, 1)}>
          <ChevronRight className="size-4" />
        </IconButton>
        <IconButton
          label="Delete scene"
          disabled={project.scenes.length <= 1}
          onClick={() => selectedSceneId && deleteScene(selectedSceneId)}
          className="hover:text-coral"
        >
          <Trash2 className="size-4" />
        </IconButton>
      </div>
      <div className="scroll-thin relative flex-1 overflow-x-auto overflow-y-hidden px-3 pb-3">
        <div
          ref={trackRef}
          className="relative flex h-full gap-1"
          style={{ width: Math.max(total * pxPerMs, 100) + project.scenes.length * 4 }}
          onPointerDown={(e) => {
            // Clicking the empty ruler area seeks.
            if (e.target !== e.currentTarget || !trackRef.current) return;
            const r = trackRef.current.getBoundingClientRect();
            setPlaying(false);
            setTime((e.clientX - r.left) / pxPerMs);
          }}
        >
          {project.scenes.map((scene, i) => (
            <button
              key={scene.id}
              onClick={() => selectScene(scene.id)}
              className={cx(
                "group relative flex h-full shrink-0 flex-col gap-1 overflow-hidden rounded-xl border-2 p-1.5 text-left transition-colors",
                scene.id === selectedSceneId ? "border-yellow bg-raised" : "border-line bg-panel hover:border-lavender/60",
              )}
              style={{ width: scene.durationMs * pxPerMs }}
              aria-pressed={scene.id === selectedSceneId}
            >
              <div className="flex items-center justify-between gap-1 text-[11px]">
                <span className="truncate font-medium">
                  {i + 1}. {scene.name}
                </span>
                <span className="shrink-0 font-mono text-mute">{(scene.durationMs / 1000).toFixed(1)}s</span>
              </div>
              <SceneThumb project={project} scene={scene} />
              {scene.transition.type !== "none" && i > 0 && (
                <span className="absolute top-0 left-0 h-1 bg-lavender/70" style={{ width: scene.transition.durationMs * pxPerMs }} title={`${scene.transition.type} transition`} />
              )}
            </button>
          ))}
          <div
            className="pointer-events-none absolute top-0 bottom-0 w-0.5 bg-coral"
            style={{ left: timeMs * pxPerMs + (starts.findLastIndex((s) => s <= timeMs) || 0) * 4 }}
          >
            <div className="absolute -top-1 -left-1.5 size-3.5 rounded-full border-2 border-night bg-coral" />
          </div>
        </div>
      </div>
    </div>
  );
}
