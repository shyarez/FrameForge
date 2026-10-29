"use client";

import { Database, FlaskConical, Loader2, RefreshCw, Sparkles, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { api } from "@/lib/client/api";
import type { DatasetView } from "@/lib/server/datasets";
import { Sprite } from "@/components/pixel/Sprite";
import { ArcadeLabel, Button, IconButton } from "@/components/ui/primitives";
import { useEditor } from "@/store/editor";
import { DataStoryDialog } from "./DataStoryDialog";
import { UpdateDialog } from "./UpdateDialog";

export function DatasetsTab() {
  const project = useEditor((s) => s.project)!;
  const { addDataset, removeDataset } = useEditor.getState();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<{ id: string; initial?: DatasetView } | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);

  const upload = async (file: File) => {
    setError(null);
    setBusy(true);
    try {
      const { dataset } = await api.uploadDataset(project.id, file);
      addDataset(dataset.ref);
      setOpen({ id: dataset.ref.id, initial: dataset });
    } catch (e) {
      setError(`${file.name}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const trySample = async () => {
    setError(null);
    try {
      const res = await fetch("/samples/sample_sales_2024.csv");
      if (!res.ok) throw new Error("Sample file missing");
      await upload(new File([await res.blob()], "sample_sales_2024.csv", { type: "text/csv" }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const remove = async (id: string, name: string) => {
    const linked = project.evidence.some((e) => e.datasetId === id);
    if (!confirm(linked ? `Remove "${name}"? Scenes generated from it keep their current text and charts, but lose their data links.` : `Remove "${name}"?`)) return;
    try {
      await api.deleteDataset(project.id, id);
      removeDataset(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="flex flex-col gap-3.5">
      <ArcadeLabel className="block text-mute">Datasets</ArcadeLabel>
      <Button variant="primary" onClick={() => input.current?.click()} disabled={busy}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />} {busy ? "Analysing…" : "Upload CSV"}
      </Button>
      <button type="button" onClick={() => void trySample()} disabled={busy}
        className="flex items-center justify-center gap-1.5 text-xs text-aqua-ink underline-offset-2 hover:underline disabled:opacity-40">
        <FlaskConical className="size-3.5" /> Try the synthetic sample (sales, 48 rows)
      </button>
      <input ref={input} type="file" accept=".csv,text/csv" hidden aria-label="Upload CSV file"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
          e.target.value = "";
        }} />
      <p className="text-[11px] leading-relaxed text-mute">CSV with a header row · up to 5 MB, 50,000 rows, 100 columns.</p>
      {error && <p className="px-box-flat bg-coral/10 p-2 text-[11px] break-words text-coral-ink [--px-c:var(--color-coral)]" role="alert">{error}</p>}

      {project.datasets.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-4 text-center">
          <Sprite name="database" scale={3} className="animate-bob" />
          <p className="text-[11px] text-mute">No datasets yet. Upload a CSV to turn it into an animated, evidence-linked data story.</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {project.datasets.map((d) => {
            const claims = project.evidence.filter((e) => e.datasetId === d.id).length;
            return (
              <li key={d.id} className="px-box-flat bg-panel p-3">
                <div className="flex items-start gap-2">
                  <Database className="mt-0.5 size-4 shrink-0 text-aqua-ink" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-display text-[15px] font-semibold" title={d.name}>{d.name}</p>
                    <p className="text-[11px] text-mute">
                      {d.rowCount.toLocaleString()} rows · {d.columnCount} columns · v{d.version}
                    </p>
                    <p className="text-[11px] text-mute">{claims ? `${claims} evidence-linked claims` : "Not used in scenes yet"}</p>
                  </div>
                  <IconButton label={`Remove dataset ${d.name}`} onClick={() => void remove(d.id, d.name)} className="size-7 hover:text-coral-ink">
                    <Trash2 className="size-3.5" />
                  </IconButton>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2.5">
                  <Button variant="blue" className="h-8 px-2 text-sm" onClick={() => setOpen({ id: d.id })}>
                    <Sparkles className="size-4" /> Story
                  </Button>
                  <Button className="h-8 px-2 text-sm" onClick={() => setUpdating(d.id)} title="Upload a new version and refresh only the affected scenes">
                    <RefreshCw className="size-4" /> Update
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <DataStoryDialog datasetId={open?.id ?? null} initial={open?.initial} onClose={() => setOpen(null)} />
      <UpdateDialog datasetId={updating} onClose={() => setUpdating(null)} />
    </div>
  );
}
