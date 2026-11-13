"use client";

import { AlertTriangle, Captions, Loader2, Mic, RefreshCw, Sparkles, Type, UserPlus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { captionElements, narrationState, sceneSpokenText } from "@/lib/engine/narration";
import type { Scene } from "@/lib/schema/project";
import type { Voice, VoiceStatus } from "@/lib/server/voice";
import type { WriterStatus } from "@/lib/server/writer";
import { Button, Field, Select, TextInput, cx } from "@/components/ui/primitives";
import { findScene, useEditor } from "@/store/editor";

type Status = { voice: VoiceStatus; writer: WriterStatus };

/** Engine status and voices are shared by every scene's panel and fetched once per session (or on retry). */
let statusCache: Promise<Status> | null = null;
let voicesCache: Promise<Voice[]> | null = null;
const loadStatus = (force = false) => (statusCache = !force && statusCache ? statusCache : api.voiceStatus().catch((e) => {
  statusCache = null;
  throw e;
}));
const loadVoices = (force = false) => (voicesCache = !force && voicesCache ? voicesCache : api.listVoices().then((r) => r.voices).catch(() => {
  voicesCache = null;
  return [] as Voice[];
}));

/** Remembered between scenes so a whole video uses the same voice by default. */
let lastVoice = "default";
let lastSpeed = 1;

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

function NotConnected({ status, onRetry, busy }: { status: VoiceStatus; onRetry: () => void; busy: boolean }) {
  return (
    <div className="px-box-flat col-span-2 bg-coral/10 p-2.5 text-[11px] leading-relaxed text-coral-ink [--px-c:var(--color-coral)]" role="status">
      <p className="mb-1 flex items-center gap-1.5 font-semibold">
        <AlertTriangle className="size-3.5" /> VoiceStudio is not connected
      </p>
      <p className="text-paper/80">
        Open VoiceStudio and install a speech model (Catalogue → Models). FrameForge looks for it at <span className="font-mono">{status.url}</span>.
      </p>
      <Button variant="ghost" className="mt-2 h-7 px-2 text-[11px]" onClick={onRetry} disabled={busy}>
        <RefreshCw className={cx("size-3", busy && "animate-spin")} /> Check again
      </Button>
    </div>
  );
}

function CloneVoice({ onCreated }: { onCreated: (v: Voice) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="col-span-2 flex items-center gap-1.5 text-left text-[11px] text-aqua-ink hover:underline">
        <UserPlus className="size-3" /> Clone a voice from a sample…
      </button>
    );
  const create = async () => {
    if (!file || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const { voice } = await api.cloneVoice(name.trim(), file, text.trim() || undefined);
      onCreated(voice);
      setOpen(false);
      setName("");
      setText("");
      setFile(null);
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="px-box-flat col-span-2 grid gap-2 bg-ink p-2.5">
      <p className="text-[11px] leading-relaxed text-mute">
        Upload 10–30 seconds of clear speech. Only clone your own voice or a voice you have permission to use.
      </p>
      <Field label="Voice name">
        <TextInput value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
      </Field>
      <Field label="Sample (MP3, WAV, OGG)">
        <input type="file" accept="audio/mpeg,audio/wav,audio/x-wav,audio/ogg,.mp3,.wav,.ogg" aria-label="Voice sample"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-[11px] text-mute file:mr-2 file:border-0 file:bg-raised file:px-2 file:py-1 file:text-paper" />
      </Field>
      <Field label="What the sample says (optional, improves quality)">
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={2000}
          className="scroll-thin px-box-flat w-full bg-night p-2 text-xs text-paper outline-none" />
      </Field>
      {error && <p className="text-[11px] break-words text-coral-ink" role="alert">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => setOpen(false)}>Cancel</Button>
        <Button className="h-7 px-2 text-[11px]" onClick={() => void create()} disabled={busy || !file || !name.trim()}>
          {busy ? <Loader2 className="size-3 animate-spin" /> : <UserPlus className="size-3" />} Create voice
        </Button>
      </div>
    </div>
  );
}

/** Generate a scene's voice-over with VoiceStudio, optionally fit the scene to it and add timed captions. */
export function VoicePanel({ scene }: { scene: Scene }) {
  const project = useEditor((s) => s.project)!;
  const [status, setStatus] = useState<Status | null>(null);
  const [checking, setChecking] = useState(false);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [script, setScript] = useState(scene.narration?.script?.text ?? "");
  /** The scene text the script was based on (for out-of-date detection), if any. */
  const basis = useRef<string | undefined>(scene.narration?.script?.fromSceneText);
  const [voice, setVoice] = useState(scene.narration?.script?.voice ?? lastVoice);
  const [speed, setSpeed] = useState(scene.narration?.script?.speed ?? lastSpeed);
  const [description, setDescription] = useState("");
  const [fit, setFit] = useState(true);
  const [captions, setCaptions] = useState(true);
  const [busy, setBusy] = useState<null | "write" | "speak" | "captions">(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (force: boolean) => {
    setChecking(true);
    try {
      const s = await loadStatus(force);
      setStatus(s);
      if (s.voice.connected) setVoices(await loadVoices(force));
    } catch (e) {
      setError(msg(e));
    } finally {
      setChecking(false);
    }
  }, []);
  // Initial load uses the shared cache; setState only happens in the async callbacks.
  useEffect(() => {
    let live = true;
    loadStatus()
      .then(async (s) => {
        if (!live) return;
        setStatus(s);
        if (s.voice.connected) {
          const v = await loadVoices();
          if (live) setVoices(v);
        }
      })
      .catch((e) => live && setError(msg(e)));
    return () => {
      live = false;
    };
  }, []);

  const state = narrationState(scene);
  const spoken = sceneSpokenText(scene);

  const addCaptions = async (sceneId: string, assetRef: string) => {
    // The generated voice-over's script (if any) gives captions their exact wording.
    const scriptText = findScene(useEditor.getState().project!, sceneId)?.narration?.script?.text;
    const { cues } = await api.transcribe(project.id, assetRef, scriptText);
    const sc = findScene(useEditor.getState().project!, sceneId);
    if (!sc) return;
    useEditor.getState().setCaptions(sceneId, captionElements(cues, sc, useEditor.getState().project!.aspectRatio));
  };

  const generate = async () => {
    const text = script.trim();
    if (!text) return;
    setBusy("speak");
    setError(null);
    try {
      const { asset } = await api.speak(project.id, { text, voice, speed, ...(description.trim() ? { description: description.trim() } : {}) });
      const st = useEditor.getState();
      st.setAssets([...st.assets.filter((a) => a.name !== asset.name), asset]);
      lastVoice = voice;
      lastSpeed = speed;
      st.setNarration(scene.id, {
        src: asset.ref,
        durationMs: asset.durationMs!,
        volume: scene.narration?.volume ?? 1,
        offsetMs: scene.narration?.offsetMs ?? 0,
        script: { text, voice, speed, ...(basis.current !== undefined ? { fromSceneText: basis.current } : {}) },
      });
      if (fit) st.fitSceneToNarration(scene.id);
      if (captions) {
        setBusy("captions");
        await addCaptions(scene.id, asset.ref);
      }
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(null);
    }
  };

  const write = async () => {
    setBusy("write");
    setError(null);
    try {
      const { text } = await api.writeNarration(project.id, spoken);
      setScript(text);
      basis.current = spoken;
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(null);
    }
  };

  const refreshCaptions = async () => {
    if (!scene.narration) return;
    setBusy("captions");
    setError(null);
    try {
      await addCaptions(scene.id, scene.narration.src);
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(null);
    }
  };

  const captionCount = scene.elements.filter((e) => e.role === "caption").length;
  const connected = status?.voice.connected;

  return (
    <>
      {state === "outdated" && (
        <p className="px-box-flat col-span-2 bg-coral/10 p-2 text-[11px] text-coral-ink [--px-c:var(--color-coral)]" role="status">
          <AlertTriangle className="mr-1 inline size-3" />
          The scene&apos;s text changed after this voice-over was made. Use the scene text again and regenerate.
        </p>
      )}
      {status && !connected && <NotConnected status={status.voice} onRetry={() => void refresh(true)} busy={checking} />}
      {status?.voice.connected && status.voice.modelsReady === false && (
        <p className="col-span-2 text-[11px] text-coral-ink">VoiceStudio has no speech model yet{status.voice.missing?.length ? ` (missing: ${status.voice.missing.join(", ")})` : ""}. Install one in Catalogue → Models.</p>
      )}

      <Field label="Script" className="col-span-2">
        <textarea value={script} onChange={(e) => setScript(e.target.value)} rows={4} maxLength={4096} aria-label="Narration script"
          placeholder="What the narrator says in this scene…"
          className="scroll-thin px-box-flat w-full bg-ink p-2 text-xs leading-relaxed text-paper outline-none focus:[--px-c:var(--color-aqua)]" />
      </Field>
      <Button variant="ghost" className="h-7 justify-center px-1 text-[11px]" disabled={!spoken} title="Read the scene's on-screen text"
        onClick={() => {
          setScript(spoken);
          basis.current = spoken;
        }}>
        <Type className="size-3" /> Scene text
      </Button>
      <Button variant="ghost" className="h-7 justify-center px-1 text-[11px]" disabled={!spoken || busy !== null || !status?.writer.connected}
        title={status?.writer.connected ? `Rewrite the scene text as narration with ${status.writer.model} (local)` : `Ollama is not running at ${status?.writer.url ?? "localhost:11434"}`}
        onClick={() => void write()}>
        {busy === "write" ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />} Write with AI
      </Button>

      <Field label="Voice">
        <Select value={voice} onChange={(e) => setVoice(e.target.value)} disabled={!connected}>
          {!voices.some((v) => v.id === voice) && <option value={voice}>{voice === "default" ? "Default" : voice}</option>}
          {voices.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
              {v.kind === "profile" ? " (yours)" : ""}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Speed">
        <Select value={String(speed)} onChange={(e) => setSpeed(Number(e.target.value))} disabled={!connected}>
          {[0.8, 0.9, 1, 1.1, 1.2, 1.35, 1.5].map((s) => (
            <option key={s} value={s}>{s}×</option>
          ))}
        </Select>
      </Field>
      <Field label="Describe the voice (optional)" className="col-span-2">
        <TextInput value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} disabled={!connected}
          placeholder="e.g. warm, calm, slight British accent" />
      </Field>
      {connected && (
        <CloneVoice
          onCreated={(v) => {
            setVoices((vs) => [v, ...vs.filter((x) => x.id !== v.id)]);
            voicesCache = null;
            setVoice(v.id);
          }}
        />
      )}
      <label className="col-span-2 flex items-center gap-2 text-[11px] text-mute">
        <input type="checkbox" checked={fit} onChange={(e) => setFit(e.target.checked)} /> Fit scene length to the voice
      </label>
      <label className="col-span-2 flex items-center gap-2 text-[11px] text-mute">
        <input type="checkbox" checked={captions} onChange={(e) => setCaptions(e.target.checked)} /> Add timed captions
      </label>
      <Button className="col-span-2 h-8 justify-center text-xs" disabled={!connected || !script.trim() || busy !== null} onClick={() => void generate()}>
        {busy === "speak" || busy === "captions" ? <Loader2 className="size-3.5 animate-spin" /> : <Mic className="size-3.5" />}
        {busy === "speak" ? "Generating voice…" : busy === "captions" ? "Timing captions…" : scene.narration?.script ? "Regenerate voice-over" : "Generate voice-over"}
      </Button>
      {scene.narration && (
        <Button variant="ghost" className="col-span-2 h-7 justify-center text-[11px]" disabled={!connected || busy !== null} onClick={() => void refreshCaptions()}>
          <Captions className="size-3" /> {captionCount ? `Re-time captions (${captionCount})` : "Add captions from voice-over"}
        </Button>
      )}
      {captionCount > 0 && <p className="col-span-2 text-[11px] text-mute">Captions are timed to the voice-over. Re-time them after changing the scene length.</p>}
      {error && <p className="px-box-flat col-span-2 bg-coral/10 p-2 text-[11px] break-words text-coral-ink [--px-c:var(--color-coral)]" role="alert">{error}</p>}
    </>
  );
}
