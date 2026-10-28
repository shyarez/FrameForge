import type { CSSProperties } from "react";
import type { ElementVisualState, ProjectVisualState, SceneLayer } from "@/lib/engine/evaluate";
import type { SceneElement } from "@/lib/schema/project";
import { ChartGraphic } from "./ChartGraphic";

/**
 * Renders evaluator output at logical canvas size. Contains no time logic of its own:
 * the browser preview and the MP4 exporter both mount this same component.
 */

export const FONT_STACKS = {
  display: "var(--ff-display), 'Bricolage Grotesque', system-ui, sans-serif",
  sans: "var(--ff-ui), 'Mulish', system-ui, sans-serif",
  mono: "var(--ff-code), 'Geist Mono', ui-monospace, monospace",
  pixel: "var(--ff-pixel), 'Pixelify Sans', system-ui, sans-serif",
  arcade: "var(--ff-arcade), 'Press Start 2P', ui-monospace, monospace",
} as const;

export function resolveAssetSrc(projectId: string, src: string): string {
  if (src.startsWith("asset:")) return `/api/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(src.slice(6))}`;
  if (src.startsWith("data:image/")) return src;
  return "";
}

function ElementBody({ el, reveal, text, projectId }: { el: SceneElement; reveal: number; text?: string; projectId: string }) {
  switch (el.type) {
    case "text":
      return (
        <div
          style={{
            width: "100%",
            height: "100%",
            color: el.color,
            fontSize: el.fontSize,
            fontWeight: el.fontWeight,
            fontFamily: FONT_STACKS[el.fontFamily],
            textAlign: el.align,
            lineHeight: el.lineHeight,
            whiteSpace: "pre-wrap",
            overflowWrap: "break-word",
          }}
        >
          {text ?? el.text}
        </div>
      );
    case "shape":
      return (
        <div
          style={{
            width: "100%",
            height: "100%",
            background: el.fill,
            borderRadius: el.shape === "ellipse" ? "50%" : el.radius,
            border: el.strokeWidth > 0 && el.stroke ? `${el.strokeWidth}px solid ${el.stroke}` : undefined,
            boxSizing: "border-box",
          }}
        />
      );
    case "image": {
      const src = resolveAssetSrc(projectId, el.src);
      return src ? (
        // eslint-disable-next-line @next/next/no-img-element -- frames must render the exact asset synchronously
        <img src={src} alt={el.name} draggable={false}
          style={{ width: "100%", height: "100%", objectFit: el.fit, borderRadius: el.radius, display: "block" }} />
      ) : (
        <div style={{ width: "100%", height: "100%", borderRadius: el.radius, border: "4px dashed #4ff0d066",
          display: "grid", placeItems: "center", color: "#4ff0d0aa", fontSize: 32, fontFamily: FONT_STACKS.sans }}>
          No image
        </div>
      );
    }
    case "chart":
      return <ChartGraphic el={el} reveal={reveal} />;
  }
}

function ElementNode({ s, projectId, hidden }: { s: ElementVisualState; projectId: string; hidden?: boolean }) {
  const el = s.element;
  if (!s.visible || hidden) return null;
  const style: CSSProperties = {
    position: "absolute",
    left: el.x,
    top: el.y,
    width: el.width,
    height: el.height,
    opacity: s.opacity,
    transform: `translate(${s.translateX}px, ${s.translateY}px) rotate(${el.rotation}deg) scale(${s.scale})`,
    transformOrigin: "center center",
  };
  return (
    <div style={style} data-element-id={el.id}>
      <ElementBody el={el} reveal={s.reveal} text={s.text} projectId={projectId} />
    </div>
  );
}

function Layer({ layer, width, height, projectId, hideElementId }: { layer: SceneLayer; width: number; height: number; projectId: string; hideElementId?: string }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        width,
        height,
        overflow: "hidden",
        background: layer.state.scene.background,
        opacity: layer.opacity,
        transform: layer.translateX ? `translateX(${layer.translateX}px)` : undefined,
      }}
    >
      {layer.state.elements.map((s) => (
        <ElementNode key={s.element.id} s={s} projectId={projectId} hidden={s.element.id === hideElementId} />
      ))}
    </div>
  );
}

export function SceneView({
  state,
  width,
  height,
  projectId,
  hideElementId,
}: {
  state: ProjectVisualState;
  width: number;
  height: number;
  projectId: string;
  /** Editor only: hide one element (e.g. while it is being edited in place). */
  hideElementId?: string;
}) {
  return (
    <div style={{ position: "relative", width, height, overflow: "hidden", background: "#000" }}>
      {state.layers.map((layer, i) => (
        <Layer key={`${layer.state.scene.id}-${i}`} layer={layer} width={width} height={height} projectId={projectId} hideElementId={hideElementId} />
      ))}
    </div>
  );
}
