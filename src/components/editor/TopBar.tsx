"use client";

import Link from "next/link";
import { Check, CloudOff, Film, Loader2, Redo2, Save, Undo2 } from "lucide-react";
import { useDraft } from "@/lib/client/useDraft";
import { AspectRatioSchema, type AspectRatio } from "@/lib/schema/project";
import { Logo } from "@/components/brand/Logo";
import { Button, IconButton, Select } from "@/components/ui/primitives";
import { useEditor } from "@/store/editor";

function SaveIndicator() {
  const saveState = useEditor((s) => s.saveState);
  const saveError = useEditor((s) => s.saveError);
  const map = {
    saved: [<Check key="i" className="size-3.5 text-mint" />, "Saved"],
    dirty: [<span key="i" className="size-2 rounded-full bg-yellow" />, "Unsaved changes"],
    saving: [<Loader2 key="i" className="size-3.5 animate-spin" />, "Saving…"],
    error: [<CloudOff key="i" className="size-3.5 text-coral" />, saveError ?? "Save failed"],
  } as const;
  const [icon, label] = map[saveState];
  return (
    <span className="flex items-center gap-1.5 text-xs text-mute" aria-live="polite" title={label}>
      {icon}
      <span className="max-w-40 truncate">{label}</span>
    </span>
  );
}

export function TopBar({ onSave, onExport }: { onSave: () => void; onExport: () => void }) {
  const project = useEditor((s) => s.project)!;
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const { undo, redo, rename, setAspectRatio } = useEditor.getState();
  const [name, setName] = useDraft(project.name);

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-panel px-3">
      <Link href="/" className="flex items-center gap-2 rounded-xl px-1 py-1 hover:bg-raised" aria-label="Back to dashboard">
        <Logo className="size-8" />
      </Link>
      <input
        aria-label="Project title"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => name.trim() && name !== project.name && rename(name.trim())}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        className="w-64 min-w-0 rounded-lg border border-transparent bg-transparent px-2 py-1 font-display text-lg font-semibold outline-none hover:border-line focus:border-lavender"
      />
      <SaveIndicator />

      <div className="ml-auto flex items-center gap-1">
        <IconButton label="Undo (Ctrl+Z)" onClick={undo} disabled={!canUndo}><Undo2 className="size-4" /></IconButton>
        <IconButton label="Redo (Ctrl+Shift+Z)" onClick={redo} disabled={!canRedo}><Redo2 className="size-4" /></IconButton>
        <div className="mx-2 h-6 w-px bg-line" />
        <Select aria-label="Aspect ratio" value={project.aspectRatio} onChange={(e) => setAspectRatio(e.target.value as AspectRatio)} className="w-24">
          {AspectRatioSchema.options.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </Select>
        <Button onClick={onSave} title="Save (Ctrl+S)"><Save className="size-4" /> Save</Button>
        <Button variant="primary" onClick={onExport}><Film className="size-4" /> Export</Button>
      </div>
    </header>
  );
}
