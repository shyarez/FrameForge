"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ChevronDown, Clock, Layers, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "@/lib/client/api";
import { evaluateScene, sceneRestTime } from "@/lib/engine/evaluate";
import { createProject, type TemplateId } from "@/lib/schema/factory";
import { CANVAS_SIZES, type AspectRatio, type Scene } from "@/lib/schema/project";
import type { ProjectSummary } from "@/lib/server/storage";
import { SceneView } from "@/components/render/SceneView";
import { Logo, Wordmark } from "@/components/brand/Logo";
import { PixelOcean } from "@/components/pixel/PixelOcean";
import { Sprite } from "@/components/pixel/Sprite";
import type { SpriteName } from "@/components/pixel/sprites";
import { ArcadeLabel, Button, Field, IconButton, Select, TextInput, cx } from "@/components/ui/primitives";
import { ThemeToggle } from "@/components/theme/theme";
import { PhaseButton, useOceanPhase } from "./OceanClock";

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

  // Fit the scene to the card's actual width (16:9 box), whatever the project's aspect ratio.
  const boxRef = useRef<HTMLDivElement>(null);
  const [boxW, setBoxW] = useState(360);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setBoxW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const logical = CANVAS_SIZES[aspect];
  const state = useMemo(() => ({ sceneIndex: 0, sceneStartMs: 0, localMs: t, layers: [{ state: evaluateScene(scene, t), opacity: 1, translateX: 0 }] }), [scene, t]);
  const scale = Math.min(boxW / logical.width, (boxW * 9) / 16 / logical.height);
  return (
    <div ref={boxRef} className="flex aspect-video w-full items-center justify-center overflow-hidden bg-ink">
      <div style={{ width: logical.width * scale, height: logical.height * scale }} className="overflow-hidden">
        <div style={{ transform: `scale(${scale})`, transformOrigin: "0 0" }}>
          <SceneView state={state} width={logical.width} height={logical.height} projectId={projectId} />
        </div>
      </div>
    </div>
  );
}

function Chip({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx("inline-flex items-center gap-1.5 bg-raised px-2 py-1.5", className)}>{children}</span>;
}

function ProjectCard({ p, onDelete, index }: { p: ProjectSummary; onDelete: () => void; index: number }) {
  const [hover, setHover] = useState(false);
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ delay: Math.min(index * 0.06, 0.4), type: "spring", stiffness: 320, damping: 26 }}
      className="group relative"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <Link
        href={`/editor/${p.id}`}
        onFocus={() => setHover(true)}
        onBlur={() => setHover(false)}
        className="px-box block bg-night transition-transform duration-150 group-hover:-translate-y-1.5 group-hover:[--px-c:var(--color-aqua)] motion-reduce:group-hover:translate-y-0"
      >
        <div className="relative border-b-[3px] border-line">
          <LivePreview scene={p.firstScene} aspect={p.aspectRatio} projectId={p.id} active={hover} />
          <span className={cx("absolute bottom-2 left-2 bg-ink/85 px-2 py-1.5 transition-opacity", hover ? "opacity-100" : "opacity-0")}>
            <ArcadeLabel className="text-yellow-ink">▶ Playing</ArcadeLabel>
          </span>
        </div>
        <div className="flex flex-col gap-2 p-4">
          <ArcadeLabel className="text-mute">Save file</ArcadeLabel>
          <h3 className="truncate font-display text-xl font-semibold">{p.name}</h3>
          <div className="flex flex-wrap gap-2 text-xs text-mute">
            <Chip><Layers className="size-3.5" />{p.sceneCount} scene{p.sceneCount === 1 ? "" : "s"}</Chip>
            <Chip><Clock className="size-3.5" />{(p.durationMs / 1000).toFixed(1)}s</Chip>
            <Chip><ArcadeLabel className="text-aqua-ink">{p.aspectRatio}</ArcadeLabel></Chip>
          </div>
        </div>
      </Link>
      <IconButton
        label={`Delete ${p.name}`}
        onClick={onDelete}
        className="absolute top-2 right-2 bg-ink/90 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 hover:text-coral-ink"
      >
        <Trash2 className="size-4" />
      </IconButton>
    </motion.li>
  );
}

function NewProjectForm({ initialTemplate, onCreated }: { initialTemplate: TemplateId; onCreated: (id: string) => void }) {
  const [name, setName] = useState("");
  const [aspectRatio, setAspect] = useState<AspectRatio>("16:9");
  const [template, setTemplate] = useState<TemplateId>(initialTemplate);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="flex flex-col gap-4"
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
      <div className="grid grid-cols-2 gap-4">
        <Field label="Aspect ratio">
          <Select value={aspectRatio} onChange={(e) => setAspect(e.target.value as AspectRatio)}>
            <option value="16:9">16:9 Landscape</option>
            <option value="9:16">9:16 Vertical</option>
            <option value="1:1">1:1 Square</option>
          </Select>
        </Field>
        <Field label="Start from">
          <Select value={template} onChange={(e) => setTemplate(e.target.value as TemplateId)}>
            <option value="launch">Starter animation</option>
            <option value="blank">Blank scene</option>
          </Select>
        </Field>
      </div>
      {error && <p className="text-xs text-coral-ink">{error}</p>}
      <Button variant="primary" type="submit" disabled={busy} className="mt-2 h-11">
        {busy ? "Loading level…" : "Create project ▶"}
      </Button>
    </form>
  );
}

const QUEST: { level: number; title: string; body: string; sprite: SpriteName; status: "ready" | "soon"; tint: string }[] = [
  { level: 1, title: "Create", body: "Start a project from a starter animation or a blank scene.", sprite: "clapper", status: "ready", tint: "bg-yellow" },
  { level: 2, title: "Animate", body: "Arrange text, shapes and charts. Add fade, slide, scale and pop.", sprite: "monitor", status: "ready", tint: "bg-aqua" },
  { level: 3, title: "Data story", body: "Import a CSV and generate evidence-linked chart scenes.", sprite: "database", status: "soon", tint: "bg-mint" },
  { level: 4, title: "Export", body: "Render frame-by-frame to a verified H.264 MP4.", sprite: "reel", status: "ready", tint: "bg-coral" },
];

function QuestMap() {
  return (
    <section id="quest" className="relative mx-auto max-w-6xl scroll-mt-20 px-6 py-20">
      <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-80px" }} className="mb-12 text-center">
        <ArcadeLabel className="text-aqua-ink">Ocean 1</ArcadeLabel>
        <h2 className="px-text-shadow mt-4 font-display text-4xl font-bold sm:text-5xl">Your quest: idea → MP4</h2>
      </motion.div>
      <div className="relative">
        {/* Dotted pixel path linking the levels */}
        <div aria-hidden className="absolute top-14 right-[12%] left-[12%] hidden h-[6px] bg-[repeating-linear-gradient(90deg,var(--color-line)_0_12px,transparent_12px_22px)] lg:block" />
        <ol className="relative grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {QUEST.map((q, i) => (
            <motion.li key={q.level} initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-60px" }}
              transition={{ delay: i * 0.12, type: "spring", stiffness: 260, damping: 22 }} className="flex flex-col items-center text-center">
              <div className={cx("px-box relative mb-6 flex size-28 items-center justify-center", q.tint, q.status === "soon" && "opacity-60 grayscale-[0.4]")}>
                <Sprite name={q.sprite} scale={4} className={q.status === "ready" ? "animate-bob" : undefined} />
                <span className="px-box-flat absolute -top-3 -right-3 bg-ink px-2 py-1.5"><ArcadeLabel className="text-yellow-ink">LV{q.level}</ArcadeLabel></span>
              </div>
              <h3 className="font-display text-2xl font-bold">{q.title}</h3>
              <p className="mt-2 max-w-[15rem] text-sm text-mute">{q.body}</p>
              <span className={cx("mt-3 px-2 py-1.5", q.status === "ready" ? "bg-mint/15 text-mint-ink" : "bg-raised text-mute")}>
                <ArcadeLabel>{q.status === "ready" ? "Unlocked" : "Coming soon"}</ArcadeLabel>
              </span>
            </motion.li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/** Preview art for template cards, built from the real template so it matches what you get. */
function TemplateArt({ template }: { template: TemplateId }) {
  // Factory IDs are random; pin them so server and client render identical markup.
  const scene = useMemo(() => {
    const s = createProject("preview", "16:9", template).scenes[0];
    return { ...s, id: `tpl-${template}`, elements: s.elements.map((e, i) => ({ ...e, id: `tpl-${template}-${i}` })) };
  }, [template]);
  const [hover, setHover] = useState(false);
  return (
    <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <LivePreview scene={scene} aspect="16:9" projectId="preview" active={hover} />
    </div>
  );
}

export function Dashboard() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState<TemplateId | null>(null);
  const ocean = useOceanPhase();

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
    <div className="min-h-screen">
      <nav className="sticky top-0 z-40 border-b-[3px] border-line bg-ink/95">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-8 px-6">
          <Wordmark />
          <div className="hidden items-center gap-6 font-display text-[15px] text-mute md:flex">
            <a href="#quest" className="hover:text-paper">Quest</a>
            <a href="#projects" className="hover:text-paper">Projects</a>
            <a href="#templates" className="hover:text-paper">Templates</a>
          </div>
          <ThemeToggle className="ml-auto" />
          <Button variant="primary" onClick={() => setCreating("launch")}>
            <Plus className="size-4" /> New project
          </Button>
        </div>
      </nav>

      {/* Hero */}
      {/* text-paper re-resolves the text colour inside the dark scope; inherited colour would come from the page theme. */}
      <header data-theme="dark" className="relative flex h-[min(86vh,720px)] min-h-[520px] flex-col items-center overflow-hidden text-paper">
        <PixelOcean className="absolute inset-0 h-full w-full" palette={ocean.palette} />
        <div className="absolute top-5 right-5 z-20">
          <PhaseButton phase={ocean.phase} mode={ocean.mode} onClick={ocean.cycle} />
        </div>
        <div className="relative z-10 flex flex-col items-center px-6 pt-[11vh] text-center">
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
            <ArcadeLabel className="text-[12px] text-paper">Dive in to</ArcadeLabel>
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: "spring", stiffness: 220, damping: 16, delay: 0.1 }}
            className="px-text-shadow mt-5 font-display text-6xl leading-[0.95] font-bold sm:text-7xl lg:text-8xl"
          >
            <span className="text-yellow-ink">Forge Your</span>
            <br />
            <span className="transition-colors duration-1000" style={{ color: ocean.palette.titleAccent }}>Video Story</span>
          </motion.h1>
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }} className="px-text-thin mt-6 max-w-xl text-lg font-semibold text-white">
            Animate scenes, turn data into motion, and export real MP4s — frame by frame.
          </motion.p>
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.55 }} className="mt-8 flex gap-4">
            <Button variant="primary" className="h-12 px-6 text-lg" onClick={() => setCreating("launch")}>Get started</Button>
            <a href="#quest" className="px-btn inline-flex h-12 items-center gap-2 bg-raised px-5 font-display text-lg font-semibold [--px-c:var(--color-edge)]">
              How it works <ChevronDown className="size-4" />
            </a>
          </motion.div>
        </div>
        <motion.div initial={{ x: -40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: 0.8, type: "spring" }} className="absolute bottom-[9%] left-[12%] z-10 hidden md:block">
          <div className="relative">
            <div className="px-box-flat absolute -top-11 left-16 bg-paper px-3 py-2 whitespace-nowrap text-onaccent [--px-c:var(--color-edge)]">
              <ArcadeLabel>Ready to render!</ArcadeLabel>
            </div>
            <Sprite name="bot" scale={5} className="animate-bob" />
          </div>
        </motion.div>
      </header>

      <QuestMap />

      <main id="projects" className="mx-auto max-w-6xl scroll-mt-20 px-6 pb-20">
        <div className="mb-8 flex items-end justify-between gap-4">
          <div>
            <ArcadeLabel className="text-aqua-ink">Continue</ArcadeLabel>
            <h2 className="px-text-shadow mt-3 font-display text-4xl font-bold">Your save files</h2>
          </div>
          {projects && projects.length > 0 && <p className="text-sm text-mute">Hover a card to play its first scene.</p>}
        </div>
        {error && <p className="px-box-flat mb-6 bg-coral/10 p-3 text-sm text-coral-ink [--px-c:var(--color-coral)]">{error}</p>}
        {projects === null && !error && (
          <ul className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
            {[0, 1, 2].map((i) => <li key={i} className="px-box h-72 animate-pulse bg-night" />)}
          </ul>
        )}
        {projects?.length === 0 && (
          <div className="px-box flex flex-col items-center gap-4 bg-night px-6 py-14 text-center">
            <Sprite name="bot" scale={5} className="animate-bob" />
            <p className="font-display text-2xl font-semibold">No save files yet</p>
            <p className="max-w-sm text-sm text-mute">Start from the animated starter to see the editor and MP4 export in action within a minute.</p>
            <Button variant="primary" onClick={() => setCreating("launch")}><Plus className="size-4" /> Create your first project</Button>
          </div>
        )}
        {projects && projects.length > 0 && (
          <ul className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            <AnimatePresence>
              {projects.map((p, i) => <ProjectCard key={p.id} p={p} index={i} onDelete={() => remove(p)} />)}
            </AnimatePresence>
          </ul>
        )}
      </main>

      <section id="templates" className="mx-auto max-w-6xl scroll-mt-20 px-6 pb-24">
        <ArcadeLabel className="text-aqua-ink">New game</ArcadeLabel>
        <h2 className="px-text-shadow mt-3 mb-8 font-display text-4xl font-bold">Choose a starting level</h2>
        <div className="grid gap-8 sm:grid-cols-2">
          {(
            [
              ["launch", "Starter animation", "Two scenes: a kinetic title card and an animated bar chart.", "bg-yellow"],
              ["blank", "Blank canvas", "One empty scene. Build everything yourself.", "bg-aqua"],
            ] as const
          ).map(([id, title, body, tint], i) => (
            <motion.button key={id} onClick={() => setCreating(id)} initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
              transition={{ delay: i * 0.1 }} className="px-box group bg-night text-left transition-transform hover:-translate-y-1.5 hover:[--px-c:var(--color-aqua)] motion-reduce:hover:translate-y-0">
              <div className="border-b-[3px] border-line"><TemplateArt template={id} /></div>
              <div className="flex items-center gap-4 p-5">
                <span className={cx("px-box-flat flex size-12 shrink-0 items-center justify-center [--px-c:var(--color-edge)]", tint)}>
                  <Sprite name={id === "launch" ? "clapper" : "monitor"} scale={2} />
                </span>
                <span>
                  <span className="block font-display text-xl font-semibold">{title}</span>
                  <span className="block text-sm text-mute">{body}</span>
                </span>
              </div>
            </motion.button>
          ))}
        </div>
      </section>

      <footer className="border-t-[3px] border-line py-8">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 text-sm text-mute">
          <span className="flex items-center gap-2"><Logo scale={1} /> FrameForge Studio</span>
          <ArcadeLabel>Made frame by frame</ArcadeLabel>
        </div>
      </footer>

      <AnimatePresence>
        {creating && (
          <motion.div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onMouseDown={(e) => e.target === e.currentTarget && setCreating(null)}>
            <motion.div role="dialog" aria-modal="true" aria-label="New project" className="px-box w-full max-w-md bg-panel p-7"
              initial={{ y: 30, scale: 0.9 }} animate={{ y: 0, scale: 1 }} exit={{ y: 30, scale: 0.9 }} transition={{ type: "spring", stiffness: 400, damping: 24 }}
              onKeyDown={(e) => e.key === "Escape" && setCreating(null)}>
              <div className="mb-6 flex items-center gap-3">
                <Sprite name="clapper" scale={3} />
                <div>
                  <ArcadeLabel className="text-aqua-ink">New game</ArcadeLabel>
                  <h2 className="mt-1.5 font-display text-3xl font-bold">New project</h2>
                </div>
              </div>
              <NewProjectForm initialTemplate={creating} onCreated={(id) => router.push(`/editor/${id}`)} />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
