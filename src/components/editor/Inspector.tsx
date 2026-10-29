"use client";

import { AlertTriangle, ArrowDown, ArrowUp, BarChart3, Copy, Image as ImageIcon, Shapes, Trash2, Type } from "lucide-react";
import { useState } from "react";
import { useDraft } from "@/lib/client/useDraft";
import { formatValue } from "@/lib/data/format";
import {
  AnimationPresetSchema,
  EasingSchema,
  type Animation,
  type ChartElement,
  type ImageElement,
  type Scene,
  type SceneElement,
} from "@/lib/schema/project";
import { Button, Field, IconButton, Select, TextInput, cx } from "@/components/ui/primitives";
import { EvidenceInspector } from "./EvidenceInspector";
import { findElement, findScene, useEditor } from "@/store/editor";

/** Number field that commits on blur/Enter so typing doesn't spam undo history. */
function NumberField({ label, value, onCommit, step = 1, min, max }: { label: string; value: number; onCommit: (v: number) => void; step?: number; min?: number; max?: number }) {
  const [text, setText] = useDraft(String(Math.round(value * 100) / 100));
  const commit = () => {
    let v = Number(text);
    if (!Number.isFinite(v)) return setText(String(value));
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    if (v !== value) onCommit(v);
    else setText(String(value));
  };
  return (
    <Field label={label}>
      <TextInput type="number" step={step} value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} />
    </Field>
  );
}

/** Text input/area with local state; one undo step per edit session instead of per keystroke. */
function CommitText({ value, onCommit, multiline, className, ...rest }: { value: string; onCommit: (v: string) => void; multiline?: boolean; className?: string; "aria-label"?: string; rows?: number }) {
  const [text, setText] = useDraft(value);
  const commit = () => {
    if (text !== value) onCommit(text);
  };
  if (multiline)
    return (
      <textarea {...rest} value={text} onChange={(e) => setText(e.target.value)} onBlur={commit}
        className={`scroll-thin px-box-flat w-full bg-ink p-2 text-sm text-paper outline-none focus:[--px-c:var(--color-aqua)] ${className ?? ""}`} />
    );
  return <TextInput {...rest} className={className} value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} />;
}

function ColorField({ label, value, onCommit }: { label: string; value: string; onCommit: (v: string) => void }) {
  return (
    <Field label={label}>
      <div className="px-box-flat flex h-8 items-center gap-2 bg-ink px-1.5">
        <input type="color" aria-label={label} value={value.slice(0, 7)} onChange={(e) => onCommit(e.target.value)} className="size-5 cursor-pointer rounded border-0 bg-transparent p-0" />
        <span className="font-mono text-xs text-mute">{value}</span>
      </div>
    </Field>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b-2 border-line px-4 py-4">
      <h3 className="mb-3.5 flex items-center gap-2 font-display text-[15px] font-semibold text-aqua-ink">
        <span aria-hidden className="size-2 bg-aqua" />
        {title}
      </h3>
      <div className="grid grid-cols-2 gap-3">{children}</div>
    </section>
  );
}

const PRESET_LABELS: Record<Animation["preset"], string> = { none: "None", fade: "Fade", "slide-up": "Slide up", "slide-left": "Slide in", scale: "Scale", pop: "Pop" };

function AnimationFields({ anim, onChange }: { anim: Animation; onChange: (a: Animation) => void }) {
  return (
    <>
      <Field label="Preset">
        <Select value={anim.preset} onChange={(e) => onChange({ ...anim, preset: e.target.value as Animation["preset"] })}>
          {AnimationPresetSchema.options.map((p) => (
            <option key={p} value={p}>{PRESET_LABELS[p]}</option>
          ))}
        </Select>
      </Field>
      <Field label="Easing">
        <Select value={anim.easing} onChange={(e) => onChange({ ...anim, easing: e.target.value as Animation["easing"] })} disabled={anim.preset === "none"}>
          {EasingSchema.options.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </Select>
      </Field>
      <NumberField label="Delay (ms)" value={anim.delayMs} min={0} step={100} onCommit={(v) => onChange({ ...anim, delayMs: v })} />
      <NumberField label="Duration (ms)" value={anim.durationMs} min={0} step={100} onCommit={(v) => onChange({ ...anim, durationMs: v })} />
    </>
  );
}

function ChartDataEditor({ el, update }: { el: ChartElement; update: (p: Partial<SceneElement>) => void }) {
  const [text, setText] = useDraft(el.data.map((d) => `${d.label}, ${d.value}`).join("\n"));
  const isValid = (d: { label: string; value: number }) => d.label.length > 0 && Number.isFinite(d.value);
  const commit = () => {
    const data = text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const i = l.lastIndexOf(",");
        return { label: l.slice(0, i).trim(), value: Number(l.slice(i + 1)) };
      })
      .filter(isValid);
    update({ data } as Partial<ChartElement>);
  };
  return (
    <Field label="Data (label, value per line)" className="col-span-2">
      <textarea value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} rows={5}
        className="scroll-thin px-box-flat w-full bg-ink p-2 font-mono text-xs text-paper outline-none focus:[--px-c:var(--color-aqua)]" />
    </Field>
  );
}

function ImageFields({ el, update, styleUpdate }: { el: ImageElement; update: (p: Partial<SceneElement>) => void; styleUpdate: (p: Partial<SceneElement>) => void }) {
  const assets = useEditor((s) => s.assets);
  const known = assets.some((a) => a.ref === el.src);
  return (
    <Section title="Image">
      <Field label="Source" className="col-span-2">
        <Select value={known ? el.src : ""} onChange={(e) => e.target.value && update({ src: e.target.value } as Partial<ImageElement>)}>
          {!known && <option value="">{el.src ? "Missing image" : "Choose an image…"}</option>}
          {assets.map((a, i) => (
            <option key={a.name} value={a.ref}>
              Image {i + 1} ({a.kind.toUpperCase()}, {Math.max(1, Math.round(a.bytes / 1024))} KB)
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Fit">
        <Select value={el.fit} onChange={(e) => styleUpdate({ fit: e.target.value as ImageElement["fit"] } as Partial<ImageElement>)}>
          <option value="cover">Cover</option>
          <option value="contain">Contain</option>
        </Select>
      </Field>
      <NumberField label="Corner radius" value={el.radius} min={0} onCommit={(v) => styleUpdate({ radius: v } as Partial<ImageElement>)} />
      {assets.length === 0 && <p className="col-span-2 text-[11px] text-mute">Upload images in the Assets tab on the left.</p>}
    </Section>
  );
}

/** Which evidence records an element displays: calculation, value and source dataset version. */
function EvidenceSection({ el }: { el: SceneElement }) {
  const project = useEditor((s) => s.project)!;
  const ids = el.type === "text" ? el.binding?.evidence ?? [] : el.type === "chart" && el.binding ? [el.binding.evidenceId] : [];
  if (!ids.length) return null;
  return (
    <section className="border-b-2 border-line px-4 py-4">
      <h3 className="mb-3 flex items-center gap-2 font-display text-[15px] font-semibold text-mint-ink">
        <span aria-hidden className="size-2 bg-mint" />
        Evidence
      </h3>
      <ul className="flex flex-col gap-2">
        {ids.map((id) => {
          const ev = project.evidence.find((e) => e.id === id);
          const ds = ev && project.datasets.find((d) => d.id === ev.datasetId);
          if (!ev) return <li key={id} className="text-xs text-coral-ink">Missing evidence {id}</li>;
          const value =
            ev.result.kind === "scalar"
              ? formatValue(ev.result.value, ev.format, ev.unit ?? undefined) + (ev.result.label ? ` (${ev.result.label})` : "")
              : `${ev.result.points.length} points`;
          return (
            <li key={id} className="px-box-flat bg-ink p-2.5 text-xs">
              <p className="font-semibold">{ev.label}</p>
              <p className="mt-1 font-mono text-[11px] text-yellow-ink">= {value}</p>
              <p className="mt-1 font-mono text-[10px] break-all text-mute">{JSON.stringify(ev.calc)}</p>
              <p className="mt-1 text-[10px] text-mute">
                {ds?.name ?? ev.datasetId} · v{ev.datasetVersion} · {ev.sceneIds.length} scene{ev.sceneIds.length === 1 ? "" : "s"}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ElementInspector({ el }: { el: SceneElement }) {
  const { updateElement, deleteElement, reorderElement, duplicateElement } = useEditor.getState();
  const update = (patch: Partial<SceneElement>) => updateElement(el.id, patch);
  const styleUpdate = (patch: Partial<SceneElement>) => updateElement(el.id, { ...patch, styleLocked: true } as Partial<SceneElement>);

  return (
    <>
      <div className="flex items-center gap-1 border-b-2 border-line px-4 py-3">
        <CommitText aria-label="Element name" value={el.name} onCommit={(name) => update({ name })} className="flex-1 font-medium" />
        <IconButton label="Bring forward" onClick={() => reorderElement(el.id, "forward")}><ArrowUp className="size-4" /></IconButton>
        <IconButton label="Send backward" onClick={() => reorderElement(el.id, "backward")}><ArrowDown className="size-4" /></IconButton>
        <IconButton label="Duplicate element (Ctrl+D)" onClick={() => duplicateElement(el.id)}><Copy className="size-4" /></IconButton>
        <IconButton label="Delete element" onClick={() => deleteElement(el.id)} className="hover:text-coral-ink"><Trash2 className="size-4" /></IconButton>
      </div>

      {el.type === "text" && (
        <Section title="Text">
          <Field label="Content" className="col-span-2">
            {/* A manual content edit replaces the data-bound text, so the binding is dropped (and the UI says so). */}
            <CommitText multiline rows={3} value={el.text} onCommit={(text) => update(el.binding ? { text, binding: undefined } : { text })} />
            {el.binding && <span className="text-[11px] text-mute">Editing this text unlinks it from its data.</span>}
          </Field>
          <Field label="Font">
            <Select value={el.fontFamily} onChange={(e) => styleUpdate({ fontFamily: e.target.value as typeof el.fontFamily })}>
              <option value="display">Display</option>
              <option value="sans">Sans</option>
              <option value="mono">Mono</option>
              <option value="pixel">Pixel</option>
              <option value="arcade">Arcade</option>
            </Select>
          </Field>
          <NumberField label="Size" value={el.fontSize} min={4} max={800} onCommit={(v) => styleUpdate({ fontSize: v })} />
          <Field label="Weight">
            <Select value={el.fontWeight} onChange={(e) => styleUpdate({ fontWeight: Number(e.target.value) })}>
              {[300, 400, 500, 600, 700, 800].map((w) => <option key={w} value={w}>{w}</option>)}
            </Select>
          </Field>
          <Field label="Align">
            <Select value={el.align} onChange={(e) => styleUpdate({ align: e.target.value as typeof el.align })}>
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </Select>
          </Field>
          <ColorField label="Color" value={el.color} onCommit={(v) => styleUpdate({ color: v })} />
          <NumberField label="Line height" value={el.lineHeight} step={0.05} min={0.5} max={4} onCommit={(v) => styleUpdate({ lineHeight: v })} />
        </Section>
      )}

      {el.type === "shape" && (
        <Section title="Shape">
          <Field label="Kind">
            <Select value={el.shape} onChange={(e) => styleUpdate({ shape: e.target.value as typeof el.shape })}>
              <option value="rect">Rectangle</option>
              <option value="ellipse">Ellipse</option>
            </Select>
          </Field>
          <ColorField label="Fill" value={el.fill} onCommit={(v) => styleUpdate({ fill: v })} />
          <NumberField label="Corner radius" value={el.radius} min={0} onCommit={(v) => styleUpdate({ radius: v })} />
          <NumberField label="Stroke width" value={el.strokeWidth} min={0} onCommit={(v) => styleUpdate({ strokeWidth: v, stroke: el.stroke ?? "#effffb" })} />
        </Section>
      )}

      <EvidenceSection el={el} />

      {el.type === "image" && <ImageFields el={el} update={update} styleUpdate={styleUpdate} />}

      {el.type === "chart" && (
        <Section title="Chart">
          <Field label="Type">
            <Select value={el.chartType} onChange={(e) => styleUpdate({ chartType: e.target.value as ChartElement["chartType"] })}>
              <option value="bar">Bar</option>
              <option value="line">Line</option>
              <option value="donut">Donut</option>
            </Select>
          </Field>
          <Field label="Values">
            <Select value={el.showValues ? "yes" : "no"} onChange={(e) => styleUpdate({ showValues: e.target.value === "yes" })}>
              <option value="yes">Shown</option>
              <option value="no">Hidden</option>
            </Select>
          </Field>
          <ChartDataEditor el={el} update={update} />
        </Section>
      )}

      <Section title="Layout">
        <NumberField label="X" value={el.x} onCommit={(v) => update({ x: v })} />
        <NumberField label="Y" value={el.y} onCommit={(v) => update({ y: v })} />
        <NumberField label="Width" value={el.width} min={1} onCommit={(v) => update({ width: v })} />
        <NumberField label="Height" value={el.height} min={1} onCommit={(v) => update({ height: v })} />
        <NumberField label="Rotation" value={el.rotation} step={5} onCommit={(v) => update({ rotation: v })} />
        <NumberField label="Opacity" value={el.opacity} step={0.1} min={0} max={1} onCommit={(v) => styleUpdate({ opacity: v })} />
      </Section>

      <Section title="Enter animation">
        <AnimationFields anim={el.enter} onChange={(enter) => update({ enter })} />
      </Section>
      <Section title="Exit animation">
        <AnimationFields
          anim={el.exit ?? { preset: "none", delayMs: 0, durationMs: 500, easing: "easeInOut" }}
          onChange={(exit) => update({ exit })}
        />
      </Section>
    </>
  );
}

const LAYER_ICON = { text: Type, shape: Shapes, image: ImageIcon, chart: BarChart3 } as const;

/** Elements of the scene, topmost first. Lets you select elements that are hidden or covered on the canvas. */
function LayersList({ scene }: { scene: Scene }) {
  const selectElement = useEditor((s) => s.selectElement);
  const ordered = [...scene.elements].reverse();
  return (
    <section className="px-4 py-4">
      <h3 className="mb-3 flex items-center gap-2 font-display text-[15px] font-semibold text-aqua-ink">
        <span aria-hidden className="size-2 bg-aqua" />
        Layers
        <span className="ml-auto font-mono text-[11px] font-normal text-mute">{scene.elements.length}</span>
      </h3>
      {ordered.length === 0 ? (
        <p className="text-xs leading-relaxed text-mute">No elements yet. Add one from the left panel.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {ordered.map((el) => {
            const Icon = LAYER_ICON[el.type];
            return (
              <li key={el.id}>
                <button type="button" onClick={() => selectElement(el.id)}
                  className="px-box-flat flex w-full items-center gap-2 bg-ink px-2 py-1.5 text-left text-sm hover:[--px-c:var(--color-aqua)]">
                  <Icon className="size-3.5 shrink-0 text-mute" />
                  <span className="truncate">{el.name}</span>
                  {el.enter.preset !== "none" && <span className="ml-auto shrink-0 font-arcade text-[8px] text-mute uppercase">{el.enter.preset}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-3 text-[11px] leading-relaxed text-mute">Click a layer or an element on the canvas to edit it.</p>
    </section>
  );
}

function SceneInspector({ scene, isFirst }: { scene: Scene; isFirst: boolean }) {
  const updateScene = useEditor((s) => s.updateScene);
  const update = (patch: Partial<Scene>) => updateScene(scene.id, patch);
  return (
    <>
      <div className="border-b-2 border-line px-4 py-3">
        <p className="mb-1 text-[11px] text-mute uppercase">Scene</p>
        <CommitText aria-label="Scene name" value={scene.name} onCommit={(name) => update({ name })} className="font-medium" />
      </div>
      <Section title="Scene">
        <NumberField label="Duration (s)" value={scene.durationMs / 1000} step={0.5} min={0.5} max={120} onCommit={(v) => update({ durationMs: Math.round(v * 1000) })} />
        <ColorField label="Background" value={scene.background} onCommit={(v) => update({ background: v })} />
      </Section>
      <Section title="Transition in">
        <Field label="Type">
          <Select value={scene.transition.type} disabled={isFirst} onChange={(e) => update({ transition: { ...scene.transition, type: e.target.value as Scene["transition"]["type"] } })}>
            <option value="none">None</option>
            <option value="fade">Fade</option>
            <option value="slide">Slide</option>
          </Select>
        </Field>
        <NumberField label="Duration (ms)" value={scene.transition.durationMs} min={0} max={5000} step={100} onCommit={(v) => update({ transition: { ...scene.transition, durationMs: v } })} />
        {isFirst && <p className="col-span-2 text-[11px] text-mute">The first scene has no incoming transition.</p>}
      </Section>
      <LayersList scene={scene} />
    </>
  );
}

/** Shown on scenes a dataset update could not refresh. */
function StaleBanner({ scene }: { scene: Scene }) {
  if (!scene.stale) return null;
  return (
    <div className="px-box-flat m-3 bg-coral/10 p-3 text-xs text-coral-ink [--px-c:var(--color-coral)]" role="status">
      <p className="mb-1 flex items-center gap-1.5 font-semibold"><AlertTriangle className="size-3.5" /> Stale after data v{scene.stale.version}</p>
      <ul className="list-disc pl-4">
        {scene.stale.reasons.map((r) => <li key={r}>{r}</li>)}
      </ul>
    </div>
  );
}

export function Inspector() {
  const project = useEditor((s) => s.project)!;
  const selectedElementId = useEditor((s) => s.selectedElementId);
  const selectedSceneId = useEditor((s) => s.selectedSceneId);
  const [tab, setTab] = useState<"properties" | "evidence">("properties");
  const hit = findElement(project, selectedElementId);
  const scene = findScene(project, selectedSceneId);

  return (
    <aside className="scroll-thin flex w-72 shrink-0 flex-col overflow-y-auto border-l-[3px] border-line bg-night" aria-label="Inspector">
      <div role="tablist" className="grid h-11 shrink-0 grid-cols-2 border-b-[3px] border-line bg-panel">
        {(
          [
            ["properties", hit ? "Element" : "Properties"],
            ["evidence", `Evidence (${project.evidence.length})`],
          ] as const
        ).map(([id, label]) => (
          <button key={id} role="tab" type="button" aria-selected={tab === id} onClick={() => setTab(id)}
            className={cx("font-arcade text-[9px] tracking-wider uppercase transition-colors", tab === id ? "bg-night text-yellow-ink" : "text-mute hover:text-paper")}>
            {label}
          </button>
        ))}
      </div>
      {tab === "evidence" ? (
        <EvidenceInspector />
      ) : (
        <>
          {hit && (
            <Button variant="ghost" className="mx-3 mt-2 h-7 justify-start px-2 text-xs" onClick={() => useEditor.getState().selectElement(null)}>
              ← Scene settings
            </Button>
          )}
          {scene && <StaleBanner scene={scene} />}
          {hit ? <ElementInspector key={hit.element.id} el={hit.element} /> : scene ? <SceneInspector scene={scene} isFirst={project.scenes[0].id === scene.id} /> : null}
        </>
      )}
    </aside>
  );
}
