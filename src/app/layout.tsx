import type { Metadata } from "next";
import { Bricolage_Grotesque, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

// These variables are also used inside rendered video frames (see FONT_STACKS).
const display = Bricolage_Grotesque({ variable: "--ff-display", subsets: ["latin"], weight: ["400", "500", "600", "700", "800"] });
const ui = Geist({ variable: "--ff-ui", subsets: ["latin"] });
const code = Geist_Mono({ variable: "--ff-code", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "FrameForge Studio",
  description: "Visual video editor with evidence-aware data storytelling.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${display.variable} ${ui.variable} ${code.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
