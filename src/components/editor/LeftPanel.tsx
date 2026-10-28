"use client";

import { BarChart3, Circle, Database, Heading1, Image as ImageIcon, LineChart, PieChart, Shapes, Square, Type } from "lucide-react";
import { useState, type ReactNode } from "react";
import { PALETTE } from "@/lib/schema/factory";
import { Sprite } from "@/components/pixel/Sprite";
import { ArcadeLabel, cx } from "@/components/ui/primitives";
import { useEditor } from "@/store/editor";
import { AssetsTab } from "./AssetsTab";
import { DatasetsTab } from "./DatasetsTab";

type Tab = "elements" | "assets" | "charts" | "data";

function Tile({ icon, label, hint, onClick, tint }: { icon: ReactNode; label: string; hint: string; onClick: () => void; tint: string }) {
  return (
    <button
      onClick={onClick}
      className="px-box-flat group flex flex-col items-start gap-2.5 bg-panel p-3 text-left transition-transform duration-100 hover:-translate-y-0.5 hover:[--px-c:var(--color-aqua)] active:translate-y-0.5 motion-reduce:hover:translate-y-0"
    >
      <span className="px-box-flat flex size-9 items-center justify-center text-onaccent [--px-c:var(--color-edge)]" style={{ background: tint }}>
        {icon}
      </span>
      <span>
        <span className="block font-display text-[15px] font-semibold">{label}</span>
        <span className="block text-[11px] leading-tight text-mute">{hint}</span>
      </span>
    </button>
  );
}

export function LeftPanel() {
  const [tab, setTab] = useState<Tab>("elements");
  const addElement = useEditor((s) => s.addElement);

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r-[3px] border-line bg-night">
      <div role="tablist" className="grid grid-cols-4 gap-1.5 border-b-2 border-line p-2.5">
        {(
          [
            ["elements", "Elements", <Shapes key="i" className="size-4" />],
            ["assets", "Assets", <ImageIcon key="i" className="size-4" />],
            ["charts", "Charts", <BarChart3 key="i" className="size-4" />],
            ["data", "Data", <Database key="i" className="size-4" />],
          ] as const
        ).map(([id, label, icon]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={cx(
              "flex flex-col items-center justify-center gap-1 py-1.5 font-display text-[12px] font-semibold transition-colors",
              tab === id ? "px-box-flat bg-raised text-yellow-ink [--px-c:var(--color-yellow)]" : "text-mute hover:text-paper",
            )}
          >
            {icon}
            {label}
          </button>
        ))}
      </div>

      <div className="scroll-thin flex-1 overflow-y-auto p-3.5">
        {tab === "elements" && (
          <>
            <ArcadeLabel className="mb-3.5 block text-mute">Add to scene</ArcadeLabel>
            <div className="grid grid-cols-2 gap-3">
              <Tile tint={PALETTE.yellow} icon={<Heading1 className="size-5" />} label="Heading" hint="Big display type"
                onClick={() => addElement("text", { name: "Heading", text: "Your headline", fontSize: 110, fontWeight: 800, enter: { preset: "slide-up", delayMs: 0, durationMs: 700, easing: "easeOut" } })} />
              <Tile tint={PALETTE.aqua} icon={<Type className="size-5" />} label="Body text" hint="Supporting copy"
                onClick={() => addElement("text", { name: "Body", text: "Add supporting detail here", fontFamily: "sans", fontSize: 44, fontWeight: 400, height: 80 })} />
              <Tile tint={PALETTE.coral} icon={<Square className="size-5" />} label="Rectangle" hint="Rounded block"
                onClick={() => addElement("shape", { name: "Rectangle", shape: "rect", fill: PALETTE.coral })} />
              <Tile tint={PALETTE.mint} icon={<Circle className="size-5" />} label="Ellipse" hint="Circle or oval"
                onClick={() => addElement("shape", { name: "Ellipse", shape: "ellipse", fill: PALETTE.mint })} />
              <Tile tint={PALETTE.blue} icon={<span className="font-arcade text-[11px] text-paper">Aa</span>} label="Pixel title" hint="Retro arcade type"
                onClick={() => addElement("text", { name: "Pixel title", text: "LEVEL UP!", fontFamily: "pixel", fontSize: 120, fontWeight: 700, color: PALETTE.yellow, enter: { preset: "pop", delayMs: 0, durationMs: 700, easing: "backOut" } })} />
            </div>
          </>
        )}
        {tab === "assets" && <AssetsTab />}
        {tab === "data" && <DatasetsTab />}
        {tab === "charts" && (
          <div className="flex flex-col gap-3">
            <ArcadeLabel className="mb-0.5 block text-mute">Add a chart</ArcadeLabel>
            <div className="grid grid-cols-2 gap-3">
              <Tile tint={PALETTE.blue} icon={<BarChart3 className="size-5" />} label="Bar" hint="Compare groups"
                onClick={() => addElement("chart", { name: "Bar chart", chartType: "bar" })} />
              <Tile tint={PALETTE.yellow} icon={<LineChart className="size-5" />} label="Line" hint="Show a trend"
                onClick={() => addElement("chart", { name: "Line chart", chartType: "line" })} />
              <Tile tint={PALETTE.coral} icon={<PieChart className="size-5" />} label="Donut" hint="Show shares"
                onClick={() => addElement("chart", { name: "Donut chart", chartType: "donut" })} />
            </div>
            <div className="px-box-flat mt-2 flex gap-3 bg-ink p-3 [--px-c:var(--color-raised)]">
              <Sprite name="chart" scale={2} className="shrink-0" />
              <p className="text-[11px] leading-relaxed text-mute">
                Charts start with sample values you can edit in the inspector. Charts generated from an imported CSV will carry evidence links to their source calculations.
              </p>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
