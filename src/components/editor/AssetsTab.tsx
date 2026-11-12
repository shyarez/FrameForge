"use client";

import { ImagePlus, Loader2, Mic, Music2, Pause, Play, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { api } from "@/lib/client/api";
import { CANVAS_SIZES } from "@/lib/schema/project";
import type { AssetInfo } from "@/lib/server/assets";
import { fmtTime } from "./Timeline";
import { resolveAssetSrc } from "@/components/render/SceneView";
import { Sprite } from "@/components/pixel/Sprite";
import { ArcadeLabel, IconButton, cx } from "@/components/ui/primitives";
import { useEditor } from "@/store/editor";

const ACCEPT = "image/png,image/jpeg,image/gif,image/webp,audio/mpeg,audio/wav,audio/x-wav,audio/ogg,.mp3,.wav,.ogg";

/** Default music settings when a track is first chosen. */
export const DEFAULT_MUSIC = { volume: 0.35, loop: true, fadeInMs: 1000, fadeOutMs: 1500, duck: 0.3 };

/** One audio file: listen, use as this scene's narration, or as the background music. */
function AudioRow({ a, index, onRemove }: { a: AssetInfo; index: number; onRemove: () => void }) {
  const project = useEditor((s) => s.project)!;
  const selectedSceneId = useEditor((s) => s.selectedSceneId);
  const { setNarration, setMusic } = useEditor.getState();
  const [playing, setPlaying] = useState(false);
  const el = useRef<HTMLAudioElement | null>(null);
  const toggle = () => {
    if (!el.current) {
      el.current = new Audio(resolveAssetSrc(project.id, a.ref));
      el.current.onended = () => setPlaying(false);
    }
    if (playing) {
      el.current.pause();
      setPlaying(false);
    } else {
      el.current.currentTime = 0;
      void el.current.play().then(() => setPlaying(true), () => setPlaying(false));
    }
  };
  useEffect(() => () => el.current?.pause(), []);
  const isMusic = project.music?.src === a.ref;
  const narratedScenes = project.scenes.filter((s) => s.narration?.src === a.ref).length;
  const durationMs = a.durationMs ?? 0;
  return (
    <li className="px-box-flat bg-ink p-2.5">
      <div className="flex items-center gap-2">
        <IconButton label={playing ? `Stop audio ${index + 1}` : `Listen to audio ${index + 1}`} onClick={toggle} className="size-7 shrink-0">
          {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
        </IconButton>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">Audio {index + 1}</span>
          <span className="block font-mono text-[10px] text-mute">
            {a.kind.toUpperCase()} · {durationMs ? fmtTime(durationMs) : "?"}
            {isMusic && " · music"}
            {narratedScenes > 0 && ` · ${narratedScenes} scene${narratedScenes === 1 ? "" : "s"}`}
          </span>
        </span>
        <IconButton label={`Delete audio ${a.name}`} onClick={onRemove} className="size-7 shrink-0 hover:text-coral-ink">
          <Trash2 className="size-3.5" />
        </IconButton>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        <button type="button" disabled={!selectedSceneId || !durationMs}
          onClick={() => selectedSceneId && setNarration(selectedSceneId, { src: a.ref, durationMs, volume: 1, offsetMs: 0 })}
          className="px-box-flat flex items-center justify-center gap-1 bg-panel py-1 text-[11px] hover:[--px-c:var(--color-aqua)] disabled:opacity-50">
          <Mic className="size-3" /> Narrate scene
        </button>
        <button type="button" disabled={!durationMs}
          onClick={() => setMusic(isMusic ? undefined : { ...DEFAULT_MUSIC, ...project.music, src: a.ref, durationMs })}
          className="px-box-flat flex items-center justify-center gap-1 bg-panel py-1 text-[11px] hover:[--px-c:var(--color-aqua)] disabled:opacity-50">
          <Music2 className="size-3" /> {isMusic ? "Remove music" : "Use as music"}
        </button>
      </div>
    </li>
  );
}

/** Natural pixel size of an image URL. */
function naturalSize(src: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => reject(new Error("Could not read image"));
    img.src = src;
  });
}

export function AssetsTab() {
  const project = useEditor((s) => s.project)!;
  const allAssets = useEditor((s) => s.assets);
  const assets = allAssets.filter((a) => a.media !== "audio");
  const audio = allAssets.filter((a) => a.media === "audio");
  const { setAssets, addElement } = useEditor.getState();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const upload = async (files: FileList | File[]) => {
    setError(null);
    for (const file of Array.from(files)) {
      setBusy((b) => b + 1);
      try {
        const { asset } = await api.uploadAsset(project.id, file);
        setAssets([...useEditor.getState().assets, asset]);
      } catch (e) {
        setError(`${file.name}: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setBusy((b) => b - 1);
      }
    }
  };

  const place = async (ref: string) => {
    const canvas = CANVAS_SIZES[project.aspectRatio];
    let w = Math.round(canvas.width * 0.5);
    let h = Math.round(canvas.height * 0.5);
    try {
      const n = await naturalSize(resolveAssetSrc(project.id, ref));
      const scale = Math.min((canvas.width * 0.6) / n.w, (canvas.height * 0.6) / n.h);
      w = Math.max(10, Math.round(n.w * scale));
      h = Math.max(10, Math.round(n.h * scale));
    } catch {
      // Fall back to a centred half-canvas box; the image still loads in the element.
    }
    addElement("image", { src: ref, name: "Image", width: w, height: h, x: Math.round((canvas.width - w) / 2), y: Math.round((canvas.height - h) / 2) });
  };

  const remove = async (name: string, ref: string) => {
    const used = project.scenes.some((s) => s.elements.some((e) => e.type === "image" && e.src === ref));
    if (!confirm(used ? "This image is used in your scenes. Delete it anyway? Those elements will show a placeholder." : "Delete this image?")) return;
    await removeFile(name);
  };

  const removeAudio = async (name: string, ref: string) => {
    const used = project.music?.src === ref || project.scenes.some((s) => s.narration?.src === ref);
    if (!confirm(used ? "This audio is used in your project. Delete it and remove it from the timeline?" : "Delete this audio?")) return;
    if (used) {
      useEditor.getState().commit((d) => {
        if (d.music?.src === ref) delete d.music;
        for (const s of d.scenes) if (s.narration?.src === ref) delete s.narration;
      });
    }
    await removeFile(name);
  };

  const removeFile = async (name: string) => {
    try {
      await api.deleteAsset(project.id, name);
      setAssets(useEditor.getState().assets.filter((a) => a.name !== name));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) void upload(e.dataTransfer.files);
  };

  return (
    <div className="flex flex-col gap-3.5">
      <ArcadeLabel className="block text-mute">Project assets</ArcadeLabel>
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cx(
          "px-box-flat flex flex-col items-center gap-2 border-dashed bg-ink px-3 py-5 text-center transition-colors",
          dragging ? "bg-raised [--px-c:var(--color-aqua)]" : "hover:[--px-c:var(--color-aqua)]",
        )}
      >
        {busy > 0 ? <Loader2 className="size-6 animate-spin text-aqua-ink" /> : <ImagePlus className="size-6 text-aqua-ink" />}
        <span className="font-display text-[15px] font-semibold">{busy > 0 ? "Uploading…" : "Upload image or audio"}</span>
        <span className="text-[11px] text-mute">Click or drop · PNG, JPEG, GIF, WebP (8 MB) · MP3, WAV, OGG (25 MB)</span>
      </button>
      <input ref={input} type="file" accept={ACCEPT} multiple hidden aria-label="Upload image or audio files"
        onChange={(e) => {
          if (e.target.files?.length) void upload(e.target.files);
          e.target.value = "";
        }} />
      {error && <p className="px-box-flat bg-coral/10 p-2 text-[11px] break-words text-coral-ink [--px-c:var(--color-coral)]" role="alert">{error}</p>}

      {assets.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-4 text-center">
          <Sprite name="bot" scale={3} className="animate-bob" />
          <p className="text-[11px] text-mute">No images yet. Uploaded images appear here — click one to add it to the current scene.</p>
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-3">
          {assets.map((a) => (
            <li key={a.name} className="group relative">
              <button type="button" onClick={() => void place(a.ref)} aria-label={`Add image ${a.name} to scene`}
                className="px-box-flat block aspect-square w-full overflow-hidden bg-ink transition-transform hover:-translate-y-0.5 hover:[--px-c:var(--color-aqua)]">
                {/* eslint-disable-next-line @next/next/no-img-element -- project-local asset thumbnail */}
                <img src={resolveAssetSrc(project.id, a.ref)} alt="" className="size-full object-cover" draggable={false} />
              </button>
              <IconButton label={`Delete image ${a.name}`} onClick={() => void remove(a.name, a.ref)}
                className="absolute top-1 right-1 size-7 bg-ink/85 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 hover:text-coral-ink">
                <Trash2 className="size-3.5" />
              </IconButton>
            </li>
          ))}
        </ul>
      )}

      <ArcadeLabel className="mt-2 block text-mute">Audio</ArcadeLabel>
      {audio.length === 0 ? (
        <p className="text-[11px] text-mute">No audio yet. Upload a voice-over or a music track, then use it as a scene&apos;s narration or as background music.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {audio.map((a, i) => (
            <AudioRow key={a.name} a={a} index={i} onRemove={() => void removeAudio(a.name, a.ref)} />
          ))}
        </ul>
      )}
    </div>
  );
}
