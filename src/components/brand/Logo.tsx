import { Sprite } from "@/components/pixel/Sprite";

/** FrameForge mark: a pixel film frame with a play glyph (original artwork). */
export function Logo({ className, scale = 2 }: { className?: string; scale?: number }) {
  return <Sprite name="logo" scale={scale} className={className} />;
}

export function Wordmark() {
  return (
    <span className="flex items-center gap-2.5">
      <Logo scale={2} />
      <span className="font-display text-xl font-bold tracking-wide">
        FrameForge<span className="text-aqua"> Studio</span>
      </span>
    </span>
  );
}
