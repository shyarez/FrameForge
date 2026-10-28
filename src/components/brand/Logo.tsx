/** FrameForge mark: a film frame with a spark, drawn as inline SVG (original artwork). */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden="true">
      <rect x="2" y="6" width="36" height="28" rx="9" fill="#b8a4ff" />
      <rect x="2" y="6" width="36" height="28" rx="9" fill="none" stroke="#0f0e2a" strokeWidth="2.5" />
      <rect x="9" y="12" width="22" height="16" rx="4" fill="#0f0e2a" />
      <path d="M18 15.5 L25 20 L18 24.5 Z" fill="#ffd166" />
      <circle cx="33" cy="7" r="4.5" fill="#ff6b6b" stroke="#0f0e2a" strokeWidth="2" />
    </svg>
  );
}
