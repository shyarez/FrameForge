import type { Metadata } from "next";
import { Bricolage_Grotesque, Geist_Mono, Mulish, Pixelify_Sans, Press_Start_2P } from "next/font/google";
import { FishCursor } from "@/components/pixel/FishCursor";
import { THEME_BOOT_SCRIPT } from "@/components/theme/bootScript";
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
    // data-theme is set by the boot script before React hydrates, so the attribute legitimately differs.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${display.variable} ${ui.variable} ${code.variable} ${pixel.variable} ${arcade.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className="min-h-full">
        <FishCursor />
        {children}
      </body>
    </html>
  );
}
