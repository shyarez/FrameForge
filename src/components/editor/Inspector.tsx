"use client";

import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { useDraft } from "@/lib/client/useDraft";
import {
  AnimationPresetSchema,
  EasingSchema,
  type Animation,
  type ChartElement,
  type Scene,
  type SceneElement,
} from "@/lib/schema/project";
import { Button, Field, IconButton, Select, TextInput } from "@/components/ui/primitives";
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
        className={`scroll-thin w-full rounded-lg border border-line bg-night p-2 text-sm text-paper outline-none focus:border-lavender ${className ?? ""}`} />
    );
  return <TextInput {...rest} className={className} value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} />;
}

function ColorField({ label, value, onCommit }: { label: string; value: string; onCommit: (v: string) => void }) {
  return (
    <Field label={label}>
      <div className="flex h-8 items-center gap-2 rounded-lg border border-line bg-night px-1.5">
        <input type="color" aria-label={label} value={value.slice(0, 7)} onChange={(e) => onCommit(e.target.value)} className="size-5 cursor-pointer rounded border-0 bg-transparent p-0" />
        <span className="font-mono text-xs text-mute">{value}</span>
      </div>
    </Field>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-line px-4 py-3">
      <h3 className="mb-2.5 font-display text-xs font-semibold tracking-wide text-lavender uppercase">{title}</h3>
      <div className="grid grid-cols-2 gap-2.5">{children}</div>
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
        className="scroll-thin w-full rounded-lg border border-line bg-night p-2 font-mono text-xs text-paper outline-none focus:border-lavender" />
    </Field>
  );
}

function ElementInspector({ el }: { el: SceneElement }) {
  const { updateElement, deleteElement, reorderElement } = useEditor.getState();
  const update = (patch: Partial<SceneElement>) => updateElement(el.id, patch);
  const styleUpdate = (patch: Partial<SceneElement>) => updateElement(el.id, { ...patch, styleLocked: true } as Partial<SceneElement>);

  return (
    <>
      <div className="flex items-center gap-1 border-b border-line px-4 py-3">
        <CommitText aria-label="Element name" value={el.name} onCommit={(name) => update({ name })} className="flex-1 font-medium" />
        <IconButton label="Bring forward" onClick={() => reorderElement(el.id, "forward")}><ArrowUp className="size-4" /></IconButton>
        <IconButton label="Send backward" onClick={() => reorderElement(el.id, "backward")}><ArrowDown className="size-4" /></IconButton>
        <IconButton label="Delete element" onClick={() => deleteElement(el.id)} className="hover:text-coral"><Trash2 className="size-4" /></IconButton>
      </div>

      {el.type === "text" && (
        <Section title="Text">
          <Field label="Content" className="col-span-2">
            <CommitText multiline rows={3} value={el.text} onCommit={(text) => update({ text })} />
          </Field>
          <Field label="Font">
            <Select value={el.fontFamily} onChange={(e) => styleUpdate({ fontFamily: e.target.value as typeof el.fontFamily })}>
              <option value="display">Display</option>
              <option value="sans">Sans</option>
              <option value="mono">Mono</option>
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
          <NumberField label="Stroke width" value={el.strokeWidth} min={0} onCommit={(v) => styleUpdate({ strokeWidth: v, stroke: el.stroke ?? "#f7f4ff" })} />
        </Section>
      )}

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

function SceneInspector({ scene, isFirst }: { scene: Scene; isFirst: boolean }) {
  const updateScene = useEditor((s) => s.updateScene);
  const update = (patch: Partial<Scene>) => updateScene(scene.id, patch);
  return (
    <>
      <div className="border-b border-line px-4 py-3">
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
      <p className="px-4 py-3 text-xs leading-relaxed text-mute">Select an element on the canvas to edit its properties and animation.</p>
    </>
  );
}

export function Inspector() {
  const project = useEditor((s) => s.project)!;
  const selectedElementId = useEditor((s) => s.selectedElementId);
  const selectedSceneId = useEditor((s) => s.selectedSceneId);
  const hit = findElement(project, selectedElementId);
  const scene = findScene(project, selectedSceneId);

  return (
    <aside className="scroll-thin flex w-72 shrink-0 flex-col overflow-y-auto border-l border-line bg-night" aria-label="Properties">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-line px-4">
        <h2 className="font-display text-sm font-semibold">{hit ? "Element" : "Properties"}</h2>
        {hit && (
          <Button variant="ghost" className="h-7 px-2 text-xs" onClick={() => useEditor.getState().selectElement(null)}>
            Scene settings
          </Button>
        )}
      </div>
      {hit ? <ElementInspector key={hit.element.id} el={hit.element} /> : scene ? <SceneInspector scene={scene} isFirst={project.scenes[0].id === scene.id} /> : null}
    </aside>
  );
}
