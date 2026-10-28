"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { evaluateProject } from "@/lib/engine/evaluate";
import { CANVAS_SIZES, type SceneElement } from "@/lib/schema/project";
import { SceneView } from "@/components/render/SceneView";
import { findElement, findScene, useEditor } from "@/store/editor";

type Handle = "nw" | "ne" | "sw" | "se";
type Drag =
  | { kind: "move"; id: string; startX: number; startY: number; orig: { x: number; y: number } }
  | { kind: "resize"; id: string; handle: Handle; startX: number; startY: number; orig: { x: number; y: number; width: number; height: number } };

/** Point-in-rect that accounts for the element's rotation about its centre. */
function hits(el: SceneElement, px: number, py: number) {
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  const a = (-el.rotation * Math.PI) / 180;
  const dx = px - cx;
  const dy = py - cy;
  const lx = dx * Math.cos(a) - dy * Math.sin(a);
  const ly = dx * Math.sin(a) + dy * Math.cos(a);
  return Math.abs(lx) <= el.width / 2 && Math.abs(ly) <= el.height / 2;
}

export function CanvasStage() {
  const project = useEditor((s) => s.project)!;
  const timeMs = useEditor((s) => s.timeMs);
  const playing = useEditor((s) => s.playing);
  const selectedSceneId = useEditor((s) => s.selectedSceneId);
  const selectedElementId = useEditor((s) => s.selectedElementId);
  const { selectElement, beginGesture, updateTransient, endGesture } = useEditor.getState();

  const wrapRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 800, h: 450 });
  const drag = useRef<Drag | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const logical = CANVAS_SIZES[project.aspectRatio];
  const scale = Math.max(0.05, Math.min((box.w - 48) / logical.width, (box.h - 48) / logical.height));
  const state = useMemo(() => evaluateProject(project, timeMs), [project, timeMs]);
  const scene = findScene(project, selectedSceneId);
  const selected = !playing ? findElement(project, selectedElementId)?.element : undefined;

  const toLogical = (e: { clientX: number; clientY: number }, stage: HTMLElement) => {
    const r = stage.getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  };

  const onStageDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (playing || !scene || e.button !== 0) return;
    const p = toLogical(e, e.currentTarget);
    const hit = [...scene.elements].reverse().find((el) => hits(el, p.x, p.y));
    selectElement(hit?.id ?? null);
    if (!hit) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    beginGesture();
    drag.current = { kind: "move", id: hit.id, startX: p.x, startY: p.y, orig: { x: hit.x, y: hit.y } };
  };

  const onHandleDown = (handle: Handle) => (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!selected) return;
    e.stopPropagation();
    const stage = e.currentTarget.closest("[data-stage]") as HTMLElement;
    stage.setPointerCapture(e.pointerId);
    const p = toLogical(e, stage);
    beginGesture();
    drag.current = { kind: "resize", id: selected.id, handle, startX: p.x, startY: p.y, orig: { x: selected.x, y: selected.y, width: selected.width, height: selected.height } };
  };

  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const p = toLogical(e, e.currentTarget);
    const dx = Math.round(p.x - d.startX);
    const dy = Math.round(p.y - d.startY);
    updateTransient((draft) => {
      const el = findElement(draft, d.id)?.element;
      if (!el) return;
      if (d.kind === "move") {
        el.x = d.orig.x + dx;
        el.y = d.orig.y + dy;
        return;
      }
      const o = d.orig;
      const west = d.handle.includes("w");
      const north = d.handle.includes("n");
      let w = Math.max(10, o.width + (west ? -dx : dx));
      let h = Math.max(10, o.height + (north ? -dy : dy));
      if (e.shiftKey) {
        const ratio = o.width / o.height;
        if (w / h > ratio) h = w / ratio;
        else w = h * ratio;
      }
      el.width = Math.round(w);
      el.height = Math.round(h);
      el.x = west ? o.x + o.width - el.width : o.x;
      el.y = north ? o.y + o.height - el.height : o.y;
    });
  };

  const onUp = () => {
    if (drag.current) endGesture();
    drag.current = null;
  };

  const hs = 12 / scale; // handle size in logical px so it stays constant on screen

  return (
    <div ref={wrapRef} className="bg-dots relative flex min-h-0 flex-1 items-center justify-center overflow-hidden">
      <div
        className="relative shrink-0 overflow-hidden rounded-md shadow-[0_0_0_1px_#34307a,0_20px_60px_-20px_#000]"
        style={{ width: logical.width * scale, height: logical.height * scale }}
      >
        <div
          data-stage
          role="application"
          aria-label="Scene canvas"
          className={playing ? "cursor-default" : "cursor-crosshair"}
          style={{ width: logical.width, height: logical.height, transform: `scale(${scale})`, transformOrigin: "0 0", position: "relative", touchAction: "none" }}
          onPointerDown={onStageDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        >
          <SceneView state={state} width={logical.width} height={logical.height} projectId={project.id} />
          {selected && (
            <div
              className="pointer-events-none absolute"
              style={{
                left: selected.x,
                top: selected.y,
                width: selected.width,
                height: selected.height,
                transform: `rotate(${selected.rotation}deg)`,
                outline: `${2 / scale}px solid #ffd166`,
                cursor: "move",
              }}
            >
              {(["nw", "ne", "sw", "se"] as Handle[]).map((h) => (
                <div
                  key={h}
                  onPointerDown={onHandleDown(h)}
                  className="pointer-events-auto absolute rounded-sm bg-yellow"
                  style={{
                    width: hs,
                    height: hs,
                    left: h.includes("w") ? -hs / 2 : undefined,
                    right: h.includes("e") ? -hs / 2 : undefined,
                    top: h.includes("n") ? -hs / 2 : undefined,
                    bottom: h.includes("s") ? -hs / 2 : undefined,
                    cursor: h === "nw" || h === "se" ? "nwse-resize" : "nesw-resize",
                    boxShadow: `0 0 0 ${2 / scale}px #0f0e2a`,
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </div>
      {scene && scene.elements.length === 0 && !playing && (
        <div className="pointer-events-none absolute inset-x-0 bottom-6 text-center text-sm text-mute">
          This scene is empty — add text, shapes or a chart from the left panel.
        </div>
      )}
    </div>
  );
}
