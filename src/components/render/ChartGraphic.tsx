import type { ChartElement } from "@/lib/schema/project";

/** Pure SVG chart. `reveal` (0..1) comes from the evaluator so preview and export match frame-for-frame. */
export function ChartGraphic({ el, reveal }: { el: ChartElement; reveal: number }) {
  const { width: w, height: h, data, colors, textColor, showValues } = el;
  if (data.length === 0) {
    return (
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
        <text x={w / 2} y={h / 2} fill={textColor} opacity={0.5} fontSize={32} textAnchor="middle">
          No data
        </text>
      </svg>
    );
  }
  const color = (i: number) => colors[i % colors.length];
  // Animated values use the precision of the dataset so counting-up numbers don't flicker decimals.
  const decimals = Math.min(2, Math.max(0, ...data.map((d) => (String(d.value).split(".")[1] ?? "").length)));
  const fmt = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const labelSize = Math.max(16, Math.min(32, h * 0.05));

  if (el.chartType === "donut") {
    const total = data.reduce((s, d) => s + Math.max(0, d.value), 0) || 1;
    const r = Math.min(w * 0.5, h) * 0.42;
    const cx = Math.min(w * 0.3, r + 20);
    const cy = h / 2;
    const stroke = r * 0.38;
    const circ = 2 * Math.PI * r;
    // Cumulative start offset of each segment, computed up front so render stays pure.
    const fracs = data.map((d) => (Math.max(0, d.value) / total) * reveal);
    const offsets = fracs.map((_, i) => fracs.slice(0, i).reduce((s, f) => s + f, 0));
    return (
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
        <g transform={`rotate(-90 ${cx} ${cy})`}>
          {data.map((d, i) => {
            return (
              <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={color(i)} strokeWidth={stroke}
                strokeDasharray={`${fracs[i] * circ} ${circ}`} strokeDashoffset={-offsets[i] * circ} />
            );
          })}
        </g>
        {data.map((d, i) => {
          const y = cy - (data.length * labelSize * 1.6) / 2 + i * labelSize * 1.6 + labelSize;
          return (
            <g key={i} opacity={reveal}>
              <rect x={cx + r + stroke} y={y - labelSize * 0.8} width={labelSize} height={labelSize} rx={4} fill={color(i)} />
              <text x={cx + r + stroke + labelSize * 1.5} y={y} fill={textColor} fontSize={labelSize}>
                {d.label}
                {showValues ? `  ${((Math.max(0, d.value) / total) * 100).toFixed(1)}%` : ""}
              </text>
            </g>
          );
        })}
      </svg>
    );
  }

  const padL = 16;
  const padB = labelSize * 2;
  const padT = showValues ? labelSize * 1.8 : 12;
  const plotW = w - padL * 2;
  const plotH = h - padB - padT;
  const max = Math.max(...data.map((d) => d.value), 0);
  const min = Math.min(...data.map((d) => d.value), 0);
  const span = max - min || 1;
  const yOf = (v: number) => padT + plotH - ((v - min) / span) * plotH;
  const zeroY = yOf(0);
  const step = plotW / data.length;

  if (el.chartType === "line") {
    const pts = data.map((d, i) => [padL + step * (i + 0.5), yOf(d.value)] as const);
    const path = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
    // Approximate path length for the draw-on effect; deterministic for a given dataset.
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const shown = Math.ceil(reveal * pts.length);
    return (
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
        <line x1={padL} x2={w - padL} y1={zeroY} y2={zeroY} stroke={textColor} strokeOpacity={0.25} strokeWidth={2} />
        <path d={path} fill="none" stroke={color(0)} strokeWidth={Math.max(4, h * 0.012)} strokeLinecap="round" strokeLinejoin="round"
          strokeDasharray={len} strokeDashoffset={len * (1 - reveal)} />
        {pts.map(([x, y], i) => (
          <g key={i}>
            <circle cx={x} cy={y} r={i < shown ? Math.max(6, h * 0.014) : 0} fill={color(1 % colors.length)} />
            {showValues && i < shown && (
              <text x={x} y={y - labelSize * 0.8} fill={textColor} fontSize={labelSize * 0.85} textAnchor="middle">{fmt(data[i].value)}</text>
            )}
            {(data.length <= 16 || i % Math.ceil(data.length / 12) === 0) && (
              <text x={x} y={h - labelSize * 0.6} fill={textColor} fillOpacity={0.75} fontSize={labelSize * 0.85} textAnchor="middle">{data[i].label}</text>
            )}
          </g>
        ))}
      </svg>
    );
  }

  const barW = step * 0.64;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <line x1={padL} x2={w - padL} y1={zeroY} y2={zeroY} stroke={textColor} strokeOpacity={0.25} strokeWidth={2} />
      {data.map((d, i) => {
        // Bars grow one after another for a staggered reveal.
        const local = Math.max(0, Math.min(1, reveal * 1.6 - (i / data.length) * 0.6));
        const top = yOf(d.value * local);
        const x = padL + step * i + (step - barW) / 2;
        const y = Math.min(top, zeroY);
        const bh = Math.abs(zeroY - top);
        return (
          <g key={i}>
            <rect x={x} y={y} width={barW} height={bh} rx={Math.min(16, barW / 4)} fill={color(i)} />
            {showValues && local > 0 && (
              <text x={x + barW / 2} y={y - labelSize * 0.5} fill={textColor} fontSize={labelSize} fontWeight={700} textAnchor="middle" opacity={local}>
                {fmt(d.value * local)}
              </text>
            )}
            <text x={x + barW / 2} y={h - labelSize * 0.6} fill={textColor} fillOpacity={0.75} fontSize={labelSize * 0.9} textAnchor="middle">
              {d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
