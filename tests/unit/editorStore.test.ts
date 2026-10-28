import { beforeEach, describe, expect, it } from "vitest";
import { evaluateProject } from "@/lib/engine/evaluate";
import { createProject } from "@/lib/schema/factory";
import { ProjectSchema } from "@/lib/schema/project";
import { findElement, useEditor } from "@/store/editor";

const s = () => useEditor.getState();
const elements = () => s().project!.scenes.find((x) => x.id === s().selectedSceneId)!.elements;

beforeEach(() => {
  s().load(createProject("Store test", "16:9", "blank"));
  useEditor.setState({ clipboard: null });
});

describe("editor store", () => {
  it("adds, duplicates and undoes elements", () => {
    s().addElement("shape");
    const id = s().selectedElementId!;
    s().duplicateElement(id);
    expect(elements()).toHaveLength(2);
    const [a, b] = elements();
    expect(b.id).not.toBe(a.id);
    expect(b.x).toBe(a.x + 40);
    expect(b.name).toBe(`${a.name} copy`);
    s().undo();
    expect(elements()).toHaveLength(1);
    s().redo();
    expect(elements()).toHaveLength(2);
  });

  it("keeps newly added elements visible on a blank scene (playhead moves to the rest pose)", () => {
    expect(s().timeMs).toBe(0);
    for (const type of ["shape", "text", "chart"] as const) {
      s().addElement(type);
      const id = s().selectedElementId!;
      const visible = evaluateProject(s().project!, s().timeMs).layers.at(-1)!.state.elements.find((e) => e.element.id === id)!;
      expect(visible.visible, `${type} at ${s().timeMs}ms`).toBe(true);
      expect(visible.opacity).toBeCloseTo(1);
    }
  });

  it("copies and pastes with fresh ids, cascading the offset", () => {
    s().addElement("text");
    const id = s().selectedElementId!;
    s().copyElement(id);
    s().pasteElement();
    s().pasteElement();
    const ids = elements().map((e) => e.id);
    expect(new Set(ids).size).toBe(3);
    expect(elements().map((e) => e.x)).toEqual([elements()[0].x, elements()[0].x + 40, elements()[0].x + 80]);
  });

  it("folds a whole gesture into one undo step", () => {
    s().addElement("shape");
    const id = s().selectedElementId!;
    const startX = findElement(s().project!, id)!.element.x;
    const pastBefore = s().past.length;
    s().beginGesture();
    for (let i = 1; i <= 10; i++) s().updateTransient((d) => void (findElement(d, id)!.element.x = startX + i * 5));
    s().endGesture();
    expect(s().past.length).toBe(pastBefore + 1);
    s().undo();
    expect(findElement(s().project!, id)!.element.x).toBe(startX);
  });

  it("never deletes the last scene and keeps the document valid", () => {
    s().deleteScene(s().selectedSceneId!);
    expect(s().project!.scenes).toHaveLength(1);
    s().addScene();
    s().addElement("chart");
    s().duplicateScene(s().selectedSceneId!);
    expect(s().project!.scenes).toHaveLength(3);
    expect(ProjectSchema.safeParse(s().project).success).toBe(true);
  });
});
