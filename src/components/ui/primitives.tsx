"use client";

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

type Variant = "primary" | "ghost" | "danger" | "soft";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-yellow text-ink hover:bg-[#ffdc85] font-semibold",
  soft: "bg-raised text-paper hover:bg-line",
  ghost: "text-mute hover:text-paper hover:bg-raised shadow-none!",
  danger: "bg-coral/15 text-coral hover:bg-coral/25",
};

export function Button({ variant = "soft", className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...props}
      className={cx(
        "btn-press inline-flex h-9 items-center justify-center gap-2 rounded-xl px-3 text-sm disabled:cursor-not-allowed disabled:opacity-40",
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
        "inline-flex size-9 items-center justify-center rounded-xl text-mute transition-colors hover:bg-raised hover:text-paper disabled:pointer-events-none disabled:opacity-30",
        className,
      )}
    />
  );
}

export function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={cx("flex min-w-0 flex-col gap-1", className)}>
      <span className="text-[11px] font-medium tracking-wide text-mute uppercase">{label}</span>
      {children}
    </label>
  );
}

const inputCls =
  "h-8 w-full min-w-0 rounded-lg border border-line bg-night px-2 text-sm text-paper outline-none transition-colors focus:border-lavender";

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(inputCls, props.className)} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(inputCls, "cursor-pointer", props.className)} />;
}

export { cx };
