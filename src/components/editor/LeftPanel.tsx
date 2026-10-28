"use client";

import { BarChart3, Circle, Heading1, LineChart, PieChart, Shapes, Square, Type } from "lucide-react";
import { useState, type ReactNode } from "react";
import { PALETTE } from "@/lib/schema/factory";
import { cx } from "@/components/ui/primitives";
import { useEditor } from "@/store/editor";

type Tab = "elements" | "charts";

function Tile({ icon, label, hint, onClick, tint }: { icon: ReactNode; label: string; hint: string; onClick: () => void; tint: string }) {
  return (
    <button
      onClick={onClick}
      className="group flex flex-col items-start gap-2 rounded-2xl border border-line bg-panel p-3 text-left transition-all hover:-translate-y-0.5 hover:border-lavender/70 motion-reduce:hover:translate-y-0"
    >
      <span className="flex size-9 items-center justify-center rounded-xl text-ink" style={{ background: tint }}>
        {icon}
      </span>
      <span>
        <span className="block text-sm font-semibold">{label}</span>
        <span className="block text-[11px] leading-tight text-mute">{hint}</span>
      </span>
    </button>
  );
}

export function LeftPanel() {
  const [tab, setTab] = useState<Tab>("elements");
  const addElement = useEditor((s) => s.addElement);

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-line bg-night">
      <div role="tablist" className="flex gap-1 p-2">
        {(
          [
            ["elements", "Elements", <Shapes key="i" className="size-4" />],
            ["charts", "Charts", <BarChart3 key="i" className="size-4" />],
          ] as const
        ).map(([id, label, icon]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={cx(
              "flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-medium transition-colors",
              tab === id ? "bg-raised text-paper" : "text-mute hover:text-paper",
            )}
          >
            {icon}
            {label}
          </button>
        ))}
      </div>

      <div className="scroll-thin flex-1 overflow-y-auto p-3 pt-1">
        {tab === "elements" && (
          <div className="grid grid-cols-2 gap-2">
            <Tile tint={PALETTE.yellow} icon={<Heading1 className="size-5" />} label="Heading" hint="Big display type"
              onClick={() => addElement("text", { name: "Heading", text: "Your headline", fontSize: 110, fontWeight: 800, enter: { preset: "slide-up", delayMs: 0, durationMs: 700, easing: "easeOut" } })} />
            <Tile tint={PALETTE.lavender} icon={<Type className="size-5" />} label="Body text" hint="Supporting copy"
              onClick={() => addElement("text", { name: "Body", text: "Add supporting detail here", fontFamily: "sans", fontSize: 44, fontWeight: 400, height: 80 })} />
            <Tile tint={PALETTE.coral} icon={<Square className="size-5" />} label="Rectangle" hint="Rounded block"
              onClick={() => addElement("shape", { name: "Rectangle", shape: "rect", fill: PALETTE.coral })} />
            <Tile tint={PALETTE.mint} icon={<Circle className="size-5" />} label="Ellipse" hint="Circle or oval"
              onClick={() => addElement("shape", { name: "Ellipse", shape: "ellipse", fill: PALETTE.mint })} />
          </div>
        )}
        {tab === "charts" && (
          <div className="flex flex-col gap-2">
            <div className="grid grid-cols-2 gap-2">
              <Tile tint={PALETTE.blue} icon={<BarChart3 className="size-5" />} label="Bar" hint="Compare groups"
                onClick={() => addElement("chart", { name: "Bar chart", chartType: "bar" })} />
              <Tile tint={PALETTE.yellow} icon={<LineChart className="size-5" />} label="Line" hint="Show a trend"
                onClick={() => addElement("chart", { name: "Line chart", chartType: "line" })} />
              <Tile tint={PALETTE.coral} icon={<PieChart className="size-5" />} label="Donut" hint="Show shares"
                onClick={() => addElement("chart", { name: "Donut chart", chartType: "donut" })} />
            </div>
            <p className="rounded-xl border border-dashed border-line p-3 text-[11px] leading-relaxed text-mute">
              Charts start with sample values you can edit in the inspector. Charts generated from an imported CSV will carry evidence links to their source calculations.
            </p>
          </div>
        )}
      </div>
    </aside>
  );
}
