import type { Metadata } from "next";
import { Bricolage_Grotesque, Geist_Mono, Mulish, Pixelify_Sans, Press_Start_2P } from "next/font/google";
import { FishCursor } from "@/components/pixel/FishCursor";
import "./globals.css";

// These variables are also used inside rendered video frames (see FONT_STACKS).
const display = Bricolage_Grotesque({ variable: "--ff-display", subsets: ["latin"], weight: ["400", "500", "600", "700", "800"] });
const ui = Mulish({ variable: "--ff-ui", subsets: ["latin"] });
const code = Geist_Mono({ variable: "--ff-code", subsets: ["latin"] });
const pixel = Pixelify_Sans({ variable: "--ff-pixel", subsets: ["latin"] });
const arcade = Press_Start_2P({ variable: "--ff-arcade", subsets: ["latin"], weight: "400" });

export const metadata: Metadata = {
  title: "FrameForge Studio",
  description: "Visual video editor with evidence-aware data storytelling.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${ui.variable} ${code.variable} ${pixel.variable} ${arcade.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <FishCursor />
        {children}
      </body>
    </html>
  );
}
