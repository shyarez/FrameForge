"use client";

import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { evaluateProject } from "@/lib/engine/evaluate";
import { CANVAS_SIZES, ProjectSchema, type Project } from "@/lib/schema/project";
import { SceneView } from "@/components/render/SceneView";

/**
 * Headless render target. The exporter (Playwright) drives it through:
 *   await window.__ffInit(project, outWidth, outHeight)
 *   await window.__ffSeek(timeMs)   // resolves once the frame is fully painted
 * Animation state comes only from evaluateProject — nothing here depends on wall-clock time.
 */

declare global {
  interface Window {
    __ffInit?: (project: unknown, width: number, height: number) => Promise<void>;
    __ffSeek?: (timeMs: number) => Promise<void>;
    __ffReady?: boolean;
  }
}

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

async function settle() {
  await document.fonts.ready;
  const imgs = Array.from(document.images);
  await Promise.all(imgs.map((img) => (img.complete ? Promise.resolve() : img.decode().catch(() => undefined))));
  await nextFrame();
  await nextFrame();
}

export function RenderStage() {
  const [cfg, setCfg] = useState<{ project: Project; width: number; height: number } | null>(null);
  const [timeMs, setTimeMs] = useState(0);

  useEffect(() => {
    window.__ffInit = async (raw, width, height) => {
      const project = ProjectSchema.parse(raw);
      flushSync(() => {
        setCfg({ project, width, height });
        setTimeMs(0);
      });
      await settle();
    };
    window.__ffSeek = async (t) => {
      flushSync(() => setTimeMs(t));
      await settle();
    };
    window.__ffReady = true;
    return () => {
      delete window.__ffInit;
      delete window.__ffSeek;
      window.__ffReady = false;
    };
  }, []);

  // The Next.js dev indicator is injected as <nextjs-portal>; it must never reach a video frame.
  const hideDevOverlay = <style>{`nextjs-portal{display:none!important}html,body{background:#000;margin:0}`}</style>;
  if (!cfg) return hideDevOverlay;
  const logical = CANVAS_SIZES[cfg.project.aspectRatio];
  const scale = cfg.width / logical.width;
  return (
    <div style={{ position: "fixed", left: 0, top: 0, width: cfg.width, height: cfg.height, overflow: "hidden" }}>
      {hideDevOverlay}
      <div style={{ transform: `scale(${scale})`, transformOrigin: "0 0" }}>
        <SceneView state={evaluateProject(cfg.project, timeMs)} width={logical.width} height={logical.height} projectId={cfg.project.id} />
      </div>
    </div>
  );
}
