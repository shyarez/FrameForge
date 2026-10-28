"use client";

import { create } from "zustand";
import { createElement, createScene } from "@/lib/schema/factory";
import { sceneRestTime, sceneStartTimes } from "@/lib/engine/evaluate";
import { projectDurationMs, type AspectRatio, type ElementType, type Project, type Scene, type SceneElement } from "@/lib/schema/project";

/**
 * Editor state. History is a simple snapshot stack of the project document:
 * `commit` records one undo step; `beginGesture`/`endGesture` fold a whole drag into one step.
 */

const HISTORY_LIMIT = 100;

export type SaveState = "saved" | "dirty" | "saving" | "error";

interface EditorState {
  project: Project | null;
  past: Project[];
  future: Project[];
  gestureBase: Project | null;

  selectedSceneId: string | null;
  selectedElementId: string | null;
  timeMs: number;
  playing: boolean;
  saveState: SaveState;
  saveError?: string;

  load(project: Project): void;
  commit(mutate: (draft: Project) => void): void;
  beginGesture(): void;
  updateTransient(mutate: (draft: Project) => void): void;
  endGesture(): void;
  undo(): void;
  redo(): void;

  selectScene(id: string): void;
  selectElement(id: string | null): void;
  setTime(ms: number): void;
  setPlaying(p: boolean): void;
  setSaveState(s: SaveState, error?: string): void;

  rename(name: string): void;
  setAspectRatio(a: AspectRatio): void;
  addScene(): void;
  duplicateScene(id: string): void;
  deleteScene(id: string): void;
  moveScene(id: string, dir: -1 | 1): void;
  updateScene(id: string, patch: Partial<Omit<Scene, "id" | "elements">>): void;
  addElement(type: ElementType, overrides?: Partial<SceneElement>): void;
  updateElement(id: string, patch: Partial<SceneElement>): void;
  deleteElement(id: string): void;
  reorderElement(id: string, dir: "forward" | "backward"): void;
}

const clone = <T,>(v: T): T => structuredClone(v);

export function findScene(p: Project, id: string | null) {
  return p.scenes.find((s) => s.id === id) ?? null;
}

export function findElement(p: Project, id: string | null): { scene: Scene; element: SceneElement } | null {
  if (!id) return null;
  for (const scene of p.scenes) {
    const element = scene.elements.find((e) => e.id === id);
    if (element) return { scene, element };
  }
  return null;
}

export const useEditor = create<EditorState>()((set, get) => {
  /** Mutate a draft copy and record history. */
  const commit = (mutate: (draft: Project) => void) => {
    const { project, past } = get();
    if (!project) return;
    const draft = clone(project);
    mutate(draft);
    set({ project: draft, past: [...past, project].slice(-HISTORY_LIMIT), future: [], saveState: "dirty" });
  };

  const seekToScene = (p: Project, sceneId: string) => {
    const idx = p.scenes.findIndex((s) => s.id === sceneId);
    if (idx < 0) return 0;
    return sceneStartTimes(p)[idx] + sceneRestTime(p.scenes[idx]);
  };

  return {
    project: null,
    past: [],
    future: [],
    gestureBase: null,
    selectedSceneId: null,
    selectedElementId: null,
    timeMs: 0,
    playing: false,
    saveState: "saved",

    load(project) {
      const first = project.scenes[0];
      set({
        project,
        past: [],
        future: [],
        selectedSceneId: first.id,
        selectedElementId: null,
        timeMs: seekToScene(project, first.id),
        playing: false,
        saveState: "saved",
      });
    },

    commit,

    beginGesture() {
      set({ gestureBase: get().project });
    },
    updateTransient(mutate) {
      const { project } = get();
      if (!project) return;
      const draft = clone(project);
      mutate(draft);
      set({ project: draft, saveState: "dirty" });
    },
    endGesture() {
      const { gestureBase, project, past } = get();
      if (gestureBase && project && gestureBase !== project) {
        set({ past: [...past, gestureBase].slice(-HISTORY_LIMIT), future: [] });
      }
      set({ gestureBase: null });
    },

    undo() {
      const { past, project, future, selectedSceneId } = get();
      if (!past.length || !project) return;
      const prev = past[past.length - 1];
      set({
        project: prev,
        past: past.slice(0, -1),
        future: [project, ...future],
        saveState: "dirty",
        selectedSceneId: findScene(prev, selectedSceneId) ? selectedSceneId : prev.scenes[0].id,
      });
    },
    redo() {
      const { past, project, future, selectedSceneId } = get();
      if (!future.length || !project) return;
      const next = future[0];
      set({
        project: next,
        past: [...past, project],
        future: future.slice(1),
        saveState: "dirty",
        selectedSceneId: findScene(next, selectedSceneId) ? selectedSceneId : next.scenes[0].id,
      });
    },

    selectScene(id) {
      const p = get().project;
      if (!p) return;
      set({ selectedSceneId: id, selectedElementId: null, playing: false, timeMs: seekToScene(p, id) });
    },
    selectElement(id) {
      set({ selectedElementId: id });
    },
    setTime(ms) {
      const p = get().project;
      if (!p) return;
      const total = projectDurationMs(p);
      const t = Math.max(0, Math.min(ms, total));
      const starts = sceneStartTimes(p);
      let idx = p.scenes.length - 1;
      for (let i = 0; i < starts.length; i++) if (t < starts[i] + p.scenes[i].durationMs) { idx = i; break; }
      const sceneId = p.scenes[idx].id;
      set((s) => ({ timeMs: t, selectedSceneId: sceneId, selectedElementId: s.selectedSceneId === sceneId ? s.selectedElementId : null }));
    },
    setPlaying(playing) {
      const p = get().project;
      if (playing && p && get().timeMs >= projectDurationMs(p) - 1) set({ timeMs: 0 });
      set({ playing });
    },
    setSaveState(saveState, saveError) {
      set({ saveState, saveError });
    },

    rename(name) {
      commit((d) => void (d.name = name.slice(0, 120) || "Untitled project"));
    },
    setAspectRatio(a) {
      commit((d) => void (d.aspectRatio = a));
    },
    addScene() {
      const scene = createScene(`Scene ${(get().project?.scenes.length ?? 0) + 1}`);
      const after = get().selectedSceneId;
      commit((d) => {
        const i = d.scenes.findIndex((s) => s.id === after);
        d.scenes.splice(i < 0 ? d.scenes.length : i + 1, 0, scene);
      });
      get().selectScene(scene.id);
    },
    duplicateScene(id) {
      const p = get().project;
      const src = p && findScene(p, id);
      if (!src) return;
      const copy = clone(src);
      copy.id = createScene().id;
      copy.name = `${src.name} copy`;
      copy.elements = copy.elements.map((e) => ({ ...e, id: createElement(e.type, p.aspectRatio).id }));
      commit((d) => d.scenes.splice(d.scenes.findIndex((s) => s.id === id) + 1, 0, copy));
      get().selectScene(copy.id);
    },
    deleteScene(id) {
      const p = get().project;
      if (!p || p.scenes.length <= 1) return;
      const idx = p.scenes.findIndex((s) => s.id === id);
      commit((d) => void (d.scenes = d.scenes.filter((s) => s.id !== id)));
      const next = get().project!.scenes[Math.max(0, idx - 1)];
      get().selectScene(next.id);
    },
    moveScene(id, dir) {
      commit((d) => {
        const i = d.scenes.findIndex((s) => s.id === id);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= d.scenes.length) return;
        [d.scenes[i], d.scenes[j]] = [d.scenes[j], d.scenes[i]];
      });
      get().selectScene(id);
    },
    updateScene(id, patch) {
      commit((d) => {
        const s = findScene(d, id);
        if (s) Object.assign(s, patch);
      });
    },
    addElement(type, overrides) {
      const { project, selectedSceneId } = get();
      if (!project || !selectedSceneId) return;
      const el = { ...createElement(type, project.aspectRatio), ...overrides } as SceneElement;
      commit((d) => findScene(d, selectedSceneId)?.elements.push(el));
      set({ selectedElementId: el.id, playing: false });
    },
    updateElement(id, patch) {
      commit((d) => {
        const hit = findElement(d, id);
        if (hit) Object.assign(hit.element, patch);
      });
    },
    deleteElement(id) {
      commit((d) => {
        for (const s of d.scenes) s.elements = s.elements.filter((e) => e.id !== id);
      });
      if (get().selectedElementId === id) set({ selectedElementId: null });
    },
    reorderElement(id, dir) {
      commit((d) => {
        const hit = findElement(d, id);
        if (!hit) return;
        const els = hit.scene.elements;
        const i = els.indexOf(hit.element);
        const j = dir === "forward" ? i + 1 : i - 1;
        if (j < 0 || j >= els.length) return;
        [els[i], els[j]] = [els[j], els[i]];
      });
    },
  };
});
