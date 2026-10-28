"use client";

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

type Variant = "primary" | "ghost" | "danger" | "soft" | "blue" | "mint";

const VARIANTS: Record<Variant, string> = {
  primary: "px-btn bg-yellow text-onaccent",
  blue: "px-btn bg-blue text-paper",
  mint: "px-btn bg-mint text-onaccent",
  soft: "px-btn bg-raised text-paper [--px-c:var(--color-edge)]",
  danger: "px-btn bg-coral text-onaccent",
  ghost: "text-mute hover:text-paper hover:bg-raised",
};

/** Arcade-style button. Labels use the pixel display face. */
export function Button({ variant = "soft", className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...props}
      className={cx(
        "inline-flex h-9 items-center justify-center gap-2 px-3.5 font-display text-[15px] font-semibold tracking-wide disabled:cursor-not-allowed disabled:opacity-40",
        VARIANTS[variant],
        className,
      )}
    />
  );
}

export function IconButton({ label, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      {...props}
      aria-label={label}
      title={label}
      className={cx(
        "btn-press inline-flex size-9 items-center justify-center text-mute transition-colors hover:bg-raised hover:text-paper disabled:pointer-events-none disabled:opacity-30",
        className,
      )}
    />
  );
}

/** Tiny uppercase arcade label, used for section headers and chips. */
export function ArcadeLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx("font-arcade text-[9px] leading-none tracking-wider uppercase", className)}>{children}</span>;
}

export function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={cx("flex min-w-0 flex-col justify-end gap-1.5", className)}>
      <span className="font-arcade text-[9px] leading-[1.5] tracking-wider text-mute uppercase">{label}</span>
      {children}
    </label>
  );
}

const inputCls =
  "px-box-flat h-8 w-full min-w-0 bg-ink px-2 text-sm text-paper outline-none transition-colors focus:[--px-c:var(--color-aqua)]";

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(inputCls, props.className)} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(inputCls, "cursor-pointer", props.className)} />;
}

/** Segmented 8-bit progress bar. */
export function PixelProgress({ value, color = "bg-yellow", segments = 24 }: { value: number; color?: string; segments?: number }) {
  const filled = Math.round(Math.max(0, Math.min(1, value)) * segments);
  return (
    <div className="px-box-flat flex gap-[3px] bg-ink p-[3px]" role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      {Array.from({ length: segments }, (_, i) => (
        <div key={i} className={cx("h-3 flex-1", i < filled ? color : "bg-raised")} />
      ))}
    </div>
  );
}

export { cx };
