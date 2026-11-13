"use client";

import { AlertTriangle, Check, CircleDashed, Loader2, Minus, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import type { AspectRatio } from "@/lib/schema/project";
import type { ShortJob } from "@/lib/server/shorts";
import type { Voice, VoiceStatus } from "@/lib/server/voice";
import type { WriterStatus } from "@/lib/server/writer";
import { ArcadeLabel, Button, Field, PixelProgress, Select, TextInput, cx } from "@/components/ui/primitives";

type Status = { voice: VoiceStatus; voices: Voice[]; writer: WriterStatus; pexels: { configured: boolean } };

const LENGTHS = [
  { scenes: 4, label: "About 15 seconds (4 scenes)" },
  { scenes: 6, label: "About 30 seconds (6 scenes)" },
  { scenes: 9, label: "About 45 seconds (9 scenes)" },
  { scenes: 12, label: "About 60 seconds (12 scenes)" },
];

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

function Check2({ ok, children }: { ok: boolean | undefined; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      {ok === undefined ? <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin text-mute" /> : ok ? <Check className="mt-0.5 size-3.5 shrink-0 text-mint-ink" /> : <Minus className="mt-0.5 size-3.5 shrink-0 text-coral-ink" />}
      <span>{children}</span>
    </li>
  );
}

function Progress({ job }: { job: ShortJob }) {
  return (
    <div className="flex flex-col gap-4" aria-live="polite">
      <PixelProgress value={job.progress} color={job.status === "error" ? "bg-coral" : job.status === "done" ? "bg-mint" : "bg-yellow"} />
      <ol className="flex flex-col gap-2 text-sm">
        {job.steps.map((s) => (
          <li key={s.key} className={cx("flex items-center gap-2", s.state === "pending" && "text-mute", s.state === "skipped" && "text-mute line-through")}>
            {s.state === "running" ? <Loader2 className="size-4 animate-spin text-yellow-ink" /> : s.state === "done" ? <Check className="size-4 text-mint-ink" /> : s.state === "error" ? <X className="size-4 text-coral-ink" /> : <CircleDashed className="size-4" />}
            <span>{s.label}</span>
            {s.detail && <span className="ml-auto truncate font-mono text-[11px] text-mute">{s.detail}</span>}
          </li>
        ))}
      </ol>
      {job.warnings.length > 0 && (
        <ul className="px-box-flat bg-yellow/10 p-3 text-xs text-yellow-ink [--px-c:var(--color-yellow)]">
          {job.warnings.map((w) => <li key={w}>{w}</li>)}
        </ul>
      )}
      {job.error && <p className="px-box-flat bg-coral/10 p-3 text-xs break-words text-coral-ink [--px-c:var(--color-coral)]" role="alert">{job.error}</p>}
    </div>
  );
}

/** Topic (or script) → voiced, captioned, stock-footage short, opened in the editor as a normal project. */
export function ShortGenerator({ onDone }: { onDone: (projectId: string) => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [mode, setMode] = useState<"topic" | "script">("topic");
  const [topic, setTopic] = useState("");
  const [script, setScript] = useState("");
  const [scenes, setScenes] = useState(6);
  const [aspect, setAspect] = useState<AspectRatio>("9:16");
  const [language, setLanguage] = useState("");
  const [voice, setVoice] = useState("default");
  const [speed, setSpeed] = useState(1);
  const [captions, setCaptions] = useState(true);
  const [footage, setFootage] = useState(true);
  const [music, setMusic] = useState<File | null>(null);
  const [job, setJob] = useState<ShortJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let live = true;
    api.shortsStatus().then((s) => live && setStatus(s)).catch((e) => live && setStatusError(msg(e)));
    return () => {
      live = false;
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  const voiceOk = status?.voice.connected ?? false;
  const writerOk = status?.writer.connected && status.writer.modelInstalled !== false;
  const canStart = mode === "topic" ? topic.trim().length > 2 && writerOk : script.trim().length > 2;

  const start = async () => {
    setError(null);
    try {
      const { job } = await api.startShort(
        {
          ...(mode === "topic" ? { topic: topic.trim() } : { script: script.trim() }),
          scenes,
          aspectRatio: aspect,
          ...(language.trim() ? { language: language.trim() } : {}),
          voice: voiceOk ? voice : null,
          speed,
          captions,
          footage: footage && Boolean(status?.pexels.configured),
        },
        music,
      );
      setJob(job);
      timer.current = setInterval(async () => {
        try {
          const { job: next } = await api.getShort(job.id);
          setJob(next);
          if (next.status === "done" || next.status === "error") {
            clearInterval(timer.current!);
            if (next.status === "done" && next.projectId && next.warnings.length === 0) onDone(next.projectId);
          }
        } catch (e) {
          clearInterval(timer.current!);
          setError(msg(e));
        }
      }, 700);
    } catch (e) {
      setError(msg(e));
    }
  };

  if (job) {
    return (
      <div className="flex flex-col gap-5">
        {job.title && <p className="font-display text-lg font-semibold">“{job.title}”</p>}
        <Progress job={job} />
        {error && <p className="text-xs text-coral-ink">{error}</p>}
        <div className="flex justify-end gap-3">
          {job.status === "error" && <Button variant="ghost" onClick={() => setJob(null)}>Back</Button>}
          {job.status === "done" && job.projectId && (
            <Button variant="primary" onClick={() => onDone(job.projectId!)}>Open in editor ▶</Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => {
      e.preventDefault();
      if (canStart) void start();
    }}>
      <ul className="px-box-flat flex flex-col gap-1.5 bg-ink p-3 text-xs text-mute" aria-label="Engine status">
        {statusError ? (
          <li className="text-coral-ink">{statusError}</li>
        ) : (
          <>
            <Check2 ok={status ? Boolean(writerOk) : undefined}>
              Script writer: {status ? (writerOk ? `Ollama · ${status.writer.model}` : status.writer.connected ? `run "ollama pull ${status.writer.model}"` : "Ollama not running — write your own script") : "checking…"}
            </Check2>
            <Check2 ok={status ? voiceOk : undefined}>
              Voice: {status ? (voiceOk ? `VoiceStudio${status.voice.version ? ` ${status.voice.version}` : ""}` : "VoiceStudio not running — the video will be silent") : "checking…"}
            </Check2>
            <Check2 ok={status ? status.pexels.configured : undefined}>
              Stock footage: {status ? (status.pexels.configured ? "Pexels" : "no Pexels key (set FF_PEXELS_API_KEY) — plain backgrounds") : "checking…"}
            </Check2>
          </>
        )}
      </ul>

      <div role="tablist" className="grid grid-cols-2 gap-2">
        {(["topic", "script"] as const).map((m) => (
          <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)}
            className={cx("px-box-flat py-2 font-display text-sm font-semibold", mode === m ? "bg-raised text-yellow-ink [--px-c:var(--color-yellow)]" : "bg-ink text-mute")}>
            {m === "topic" ? "From a topic" : "My own script"}
          </button>
        ))}
      </div>

      {mode === "topic" ? (
        <>
          <Field label="Topic">
            <TextInput autoFocus value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={500} placeholder="e.g. Why octopuses are so smart" />
          </Field>
          {status && !writerOk && <p className="flex items-center gap-1.5 text-xs text-coral-ink"><AlertTriangle className="size-3.5" /> Writing from a topic needs Ollama. Switch to “My own script”, or start Ollama.</p>}
        </>
      ) : (
        <Field label="Script (one scene per sentence)">
          <textarea value={script} onChange={(e) => setScript(e.target.value)} rows={5} maxLength={6000} aria-label="Script"
            className="scroll-thin px-box-flat w-full bg-ink p-2 text-sm text-paper outline-none focus:[--px-c:var(--color-aqua)]" />
        </Field>
      )}

      <div className="grid grid-cols-2 gap-4">
        {mode === "topic" && (
          <Field label="Length">
            <Select value={scenes} onChange={(e) => setScenes(Number(e.target.value))}>
              {LENGTHS.map((l) => <option key={l.scenes} value={l.scenes}>{l.label}</option>)}
            </Select>
          </Field>
        )}
        <Field label="Format">
          <Select value={aspect} onChange={(e) => setAspect(e.target.value as AspectRatio)}>
            <option value="9:16">9:16 Vertical (Shorts, Reels)</option>
            <option value="16:9">16:9 Landscape</option>
            <option value="1:1">1:1 Square</option>
          </Select>
        </Field>
        <Field label="Voice">
          <Select value={voice} onChange={(e) => setVoice(e.target.value)} disabled={!voiceOk}>
            {!voiceOk && <option value="default">No voice</option>}
            {voiceOk && !(status?.voices ?? []).some((v) => v.id === voice) && <option value={voice}>Default</option>}
            {(status?.voices ?? []).map((v) => <option key={v.id} value={v.id}>{v.name}{v.kind === "profile" ? " (yours)" : ""}</option>)}
          </Select>
        </Field>
        <Field label="Speed">
          <Select value={String(speed)} onChange={(e) => setSpeed(Number(e.target.value))} disabled={!voiceOk}>
            {[0.9, 1, 1.1, 1.2, 1.35].map((s) => <option key={s} value={s}>{s}×</option>)}
          </Select>
        </Field>
        <Field label="Language (optional)">
          <TextInput value={language} onChange={(e) => setLanguage(e.target.value)} maxLength={40} placeholder="English" />
        </Field>
        <Field label="Music (optional)">
          <input type="file" accept="audio/mpeg,audio/wav,audio/x-wav,audio/ogg,.mp3,.wav,.ogg" aria-label="Music file"
            onChange={(e) => setMusic(e.target.files?.[0] ?? null)}
            className="h-8 text-[11px] text-mute file:mr-2 file:h-8 file:border-0 file:bg-raised file:px-2 file:text-paper" />
        </Field>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" checked={captions} onChange={(e) => setCaptions(e.target.checked)} /> Captions</label>
        <label className={cx("flex items-center gap-2", !status?.pexels.configured && "text-mute")}>
          <input type="checkbox" checked={footage && Boolean(status?.pexels.configured)} disabled={!status?.pexels.configured} onChange={(e) => setFootage(e.target.checked)} /> Stock footage
        </label>
      </div>
      {error && <p className="text-xs break-words text-coral-ink" role="alert">{error}</p>}
      <Button variant="primary" type="submit" disabled={!canStart || !status} className="mt-1 h-11">
        <Sparkles className="size-4" /> Generate video
      </Button>
      <ArcadeLabel className="text-center text-[8px] text-mute">Everything stays editable afterwards</ArcadeLabel>
    </form>
  );
}
