"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Clock, Layers, Plus, Sparkles, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/client/api";
import { evaluateScene, sceneRestTime } from "@/lib/engine/evaluate";
import { CANVAS_SIZES, type AspectRatio, type Scene } from "@/lib/schema/project";
import type { ProjectSummary } from "@/lib/server/storage";
import { SceneView } from "@/components/render/SceneView";
import { Logo } from "@/components/brand/Logo";
import { Button, Field, IconButton, Select, TextInput } from "@/components/ui/primitives";

/** Scene thumbnail that plays its animation in a loop while hovered. */
function LivePreview({ scene, aspect, projectId, active }: { scene: Scene; aspect: AspectRatio; projectId: string; active: boolean }) {
  const reduce = useReducedMotion();
  const playing = active && !reduce;
  const [playT, setPlayT] = useState(0);
  const t = playing ? playT : sceneRestTime(scene);
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const start = performance.now();
    const tick = () => {
      setPlayT((performance.now() - start) % scene.durationMs);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, scene]);

  const logical = CANVAS_SIZES[aspect];
  const state = useMemo(() => ({ sceneIndex: 0, sceneStartMs: 0, localMs: t, layers: [{ state: evaluateScene(scene, t), opacity: 1, translateX: 0 }] }), [scene, t]);
  // Fit inside a 16:9 card box regardless of the project's aspect ratio.
  const boxW = 320;
  const boxH = 180;
  const scale = Math.min(boxW / logical.width, boxH / logical.height);
  return (
    <div className="flex aspect-video w-full items-center justify-center overflow-hidden bg-ink">
      <div style={{ width: logical.width * scale, height: logical.height * scale }} className="overflow-hidden">
        <div style={{ transform: `scale(${scale})`, transformOrigin: "0 0" }}>
          <SceneView state={state} width={logical.width} height={logical.height} projectId={projectId} />
        </div>
      </div>
    </div>
  );
}

function ProjectCard({ p, onDelete, index }: { p: ProjectSummary; onDelete: () => void; index: number }) {
  const [hover, setHover] = useState(false);
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ delay: Math.min(index * 0.05, 0.4), type: "spring", stiffness: 300, damping: 28 }}
      className="group relative"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <Link
        href={`/editor/${p.id}`}
        onFocus={() => setHover(true)}
        onBlur={() => setHover(false)}
        className="block overflow-hidden rounded-3xl border-2 border-line bg-panel shadow-[0_6px_0_0_#0a0920] transition-transform group-hover:-translate-y-1 motion-reduce:group-hover:translate-y-0"
      >
        <LivePreview scene={p.firstScene} aspect={p.aspectRatio} projectId={p.id} active={hover} />
        <div className="flex flex-col gap-1 border-t-2 border-line p-4">
          <h3 className="truncate font-display text-lg font-semibold">{p.name}</h3>
          <p className="flex items-center gap-3 text-xs text-mute">
            <span className="flex items-center gap-1"><Layers className="size-3.5" />{p.sceneCount} scene{p.sceneCount === 1 ? "" : "s"}</span>
            <span className="flex items-center gap-1"><Clock className="size-3.5" />{(p.durationMs / 1000).toFixed(1)}s</span>
            <span className="rounded-md bg-raised px-1.5 py-0.5 font-mono">{p.aspectRatio}</span>
          </p>
        </div>
      </Link>
      <IconButton
        label={`Delete ${p.name}`}
        onClick={onDelete}
        className="absolute top-3 right-3 bg-ink/80 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 hover:text-coral"
      >
        <Trash2 className="size-4" />
      </IconButton>
    </motion.li>
  );
}

function NewProjectForm({ onCreated }: { onCreated: (id: string) => void }) {
  const [name, setName] = useState("");
  const [aspectRatio, setAspect] = useState<AspectRatio>("16:9");
  const [template, setTemplate] = useState<"launch" | "blank">("launch");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          const { project } = await api.createProject({ name: name.trim() || "Untitled project", aspectRatio, template });
          onCreated(project.id);
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
          setBusy(false);
        }
      }}
    >
      <Field label="Project name">
        <TextInput autoFocus placeholder="e.g. Quarterly sales story" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Aspect ratio">
          <Select value={aspectRatio} onChange={(e) => setAspect(e.target.value as AspectRatio)}>
            <option value="16:9">16:9 Landscape</option>
            <option value="9:16">9:16 Vertical</option>
            <option value="1:1">1:1 Square</option>
          </Select>
        </Field>
        <Field label="Start from">
          <Select value={template} onChange={(e) => setTemplate(e.target.value as "launch" | "blank")}>
            <option value="launch">Starter animation</option>
            <option value="blank">Blank scene</option>
          </Select>
        </Field>
      </div>
      {error && <p className="text-xs text-coral">{error}</p>}
      <Button variant="primary" type="submit" disabled={busy} className="mt-1">
        {busy ? "Creating…" : "Create project"}
      </Button>
    </form>
  );
}

/** Original decorative illustration: floating frames and shapes. */
function HeroArt() {
  const reduce = useReducedMotion();
  const float = (d: number, y = 10) => (reduce ? {} : { animate: { y: [0, -y, 0] }, transition: { duration: 4 + d, repeat: Infinity, ease: "easeInOut" as const } });
  return (
    <div className="relative hidden h-56 w-80 shrink-0 lg:block" aria-hidden="true">
      <motion.div {...float(0)} className="absolute top-6 left-8 h-32 w-52 rotate-[-6deg] rounded-2xl border-[3px] border-ink bg-lavender shadow-[0_6px_0_0_#0a0920]">
        <div className="m-3 h-20 rounded-xl bg-ink p-3">
          <div className="mb-2 h-2 w-20 rounded bg-yellow" />
          <div className="flex h-10 items-end gap-1.5">
            {[40, 70, 30, 90, 55].map((h, i) => <div key={i} className="w-4 rounded-sm bg-blue" style={{ height: `${h}%` }} />)}
          </div>
        </div>
      </motion.div>
      <motion.div {...float(1, 14)} className="absolute top-0 right-4 size-16 rounded-full border-[3px] border-ink bg-yellow" />
      <motion.div {...float(0.5, 8)} className="absolute right-0 bottom-4 h-20 w-32 rotate-[8deg] rounded-2xl border-[3px] border-ink bg-coral shadow-[0_6px_0_0_#0a0920]" />
      <motion.div {...float(1.5, 12)} className="absolute bottom-0 left-2 size-10 rotate-12 rounded-lg border-[3px] border-ink bg-mint" />
    </div>
  );
}

export function Dashboard() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    api.listProjects().then((r) => setProjects(r.projects)).catch((e) => setError(e.message));
  }, []);

  const remove = async (p: ProjectSummary) => {
    if (!confirm(`Delete “${p.name}”? This cannot be undone.`)) return;
    try {
      await api.deleteProject(p.id);
      setProjects((list) => list?.filter((x) => x.id !== p.id) ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="bg-dots min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center gap-3 px-6 py-5">
        <Logo className="size-9" />
        <span className="font-display text-xl font-bold tracking-tight">FrameForge<span className="text-lavender"> Studio</span></span>
      </header>

      <section className="mx-auto flex max-w-6xl items-center justify-between gap-8 px-6 pt-6 pb-10">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
          <p className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-raised px-3 py-1 text-xs font-medium text-lavender">
            <Sparkles className="size-3.5" /> Motion graphics + data stories
          </p>
          <h1 className="max-w-xl font-display text-5xl leading-[1.02] font-extrabold tracking-tight">
            Turn ideas — and <span className="text-yellow">data</span> — into videos that move.
          </h1>
          <p className="mt-4 max-w-lg text-mute">Compose animated scenes, preview them instantly, and export real MP4 files rendered frame-by-frame.</p>
          <Button variant="primary" className="mt-6 h-11 px-5 text-base" onClick={() => setCreating(true)}>
            <Plus className="size-5" /> New project
          </Button>
        </motion.div>
        <HeroArt />
      </section>

      <main className="mx-auto max-w-6xl px-6 pb-16">
        <h2 className="mb-4 font-display text-2xl font-bold">Your projects</h2>
        {error && <p className="mb-4 rounded-xl bg-coral/10 p-3 text-sm text-coral">{error}</p>}
        {projects === null && !error && (
          <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
            {[0, 1, 2].map((i) => <li key={i} className="h-60 animate-pulse rounded-3xl bg-panel" />)}
          </ul>
        )}
        {projects?.length === 0 && (
          <div className="flex flex-col items-center gap-3 rounded-3xl border-2 border-dashed border-line px-6 py-14 text-center">
            <Logo className="size-14" />
            <p className="font-display text-xl font-semibold">No projects yet</p>
            <p className="max-w-sm text-sm text-mute">Start from the animated starter to see the editor and MP4 export in action within a minute.</p>
            <Button variant="primary" onClick={() => setCreating(true)}><Plus className="size-4" /> Create your first project</Button>
          </div>
        )}
        {projects && projects.length > 0 && (
          <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            <AnimatePresence>
              {projects.map((p, i) => <ProjectCard key={p.id} p={p} index={i} onDelete={() => remove(p)} />)}
            </AnimatePresence>
          </ul>
        )}
      </main>

      <AnimatePresence>
        {creating && (
          <motion.div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/70 p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onMouseDown={(e) => e.target === e.currentTarget && setCreating(false)}>
            <motion.div role="dialog" aria-modal="true" aria-label="New project" className="w-full max-w-md rounded-3xl border-2 border-line bg-panel p-6 shadow-[0_8px_0_0_#0a0920]"
              initial={{ y: 24, scale: 0.97 }} animate={{ y: 0, scale: 1 }} exit={{ y: 24, scale: 0.97 }} transition={{ type: "spring", stiffness: 380, damping: 30 }}
              onKeyDown={(e) => e.key === "Escape" && setCreating(false)}>
              <h2 className="mb-4 font-display text-2xl font-bold">New project</h2>
              <NewProjectForm onCreated={(id) => router.push(`/editor/${id}`)} />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
