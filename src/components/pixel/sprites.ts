/**
 * Original FrameForge pixel art. Each sprite is a grid of palette characters;
 * "." is transparent. Rendered by <Sprite> as crisp SVG rects.
 */

export const PIXEL_PALETTE: Record<string, string> = {
  k: "#031a24", // abyss outline
  w: "#effffb", // foam
  l: "#4ff0d0", // aquamarine
  L: "#1fb39a", // aquamarine shade
  b: "#38a6ff", // sea blue
  B: "#1c6fc4", // sea blue shade
  c: "#ff77a8", // coral pink
  C: "#d14a7d", // coral pink shade
  y: "#ffd166", // sand yellow
  Y: "#d9a23a", // sand shade
  m: "#7be495", // seafoam green
  M: "#3fae63", // seafoam shade
  g: "#7fb3b8", // sea grey
  G: "#124a57", // deep grey
  // Swappable fish colours (override per instance with <Sprite swap>).
  f: "#ff77a8", // fish body
  F: "#ffd166", // fish stripe
};

export const SPRITES = {
  logo: [
    ".kkkkkkkkkkkkk..",
    "klllllllllllllk.",
    "klkkkkkkkkkkklk.",
    "klkkkkkkkkkkklk.",
    "klkkkyykkkkkklk.",
    "klkkkyyyykkkklk.",
    "klkkkyyyyyykklk.",
    "klkkkyyyykkkklk.",
    "klkkkyykkkkkklk.",
    "klkkkkkkkkkkklk.",
    "klllllllllllllk.",
    "kLLLLLLLLLLLLLk.",
    ".kkkkkkkkkkkkk..",
  ],
  clapper: [
    ".kkkkkkkkkkkkkk.",
    "kyykkyykkyykkyyk",
    "kkyykkyykkyykkyk",
    ".kkkkkkkkkkkkkk.",
    "kGGGGGGGGGGGGGGk",
    "kGwwwwwGGwwwwwGk",
    "kGGGGGGGGGGGGGGk",
    "kGwwwGGGGGwwwwGk",
    "kGGGGGGGGGGGGGGk",
    "kGwwwwwwwGGGGGGk",
    "kGGGGGGGGGGGGGGk",
    ".kkkkkkkkkkkkkk.",
  ],
  monitor: [
    ".kkkkkkkkkkkkkk.",
    "kggggggggggggggk",
    "kgkkkkkkkkkkkkgk",
    "kgkbbbbbbbbbbkgk",
    "kgkbbbwbbbbbbkgk",
    "kgkbbbwwbbbbbkgk",
    "kgkbbbwwwbbbbkgk",
    "kgkbbbwwbbbbbkgk",
    "kgkbbbwbbbbbbkgk",
    "kgkkkkkkkkkkkkgk",
    "kggggggggggcgmgk",
    ".kkkkkkkkkkkkkk.",
    "......kGGk......",
    "....kkkkkkkk....",
  ],
  chart: [
    "............kk..",
    "...........kyyk.",
    "...........kyyk.",
    ".......kk..kyyk.",
    "......kcck.kyyk.",
    "......kcck.kyyk.",
    "..kk..kcck.kyyk.",
    ".kbbk.kcck.kyyk.",
    ".kbbk.kcck.kyyk.",
    ".kbbk.kcck.kyyk.",
    "kkkkkkkkkkkkkkkk",
  ],
  reel: [
    "...kkkkkk...",
    ".kkllllllkk.",
    ".klllkklllk.",
    "klllkkkklllk",
    "kllllllllllk",
    "kkkllkkllkkk",
    "kkkllkkllkkk",
    "kllllllllllk",
    "klllkkkklllk",
    ".klllkklllk.",
    ".kkllllllkk.",
    "...kkkkkk...",
  ],
  star: ["..y..", ".yyy.", "yyyyy", ".yyy.", "..y.."],
  sparkle: ["..w..", "..w..", "wwwww", "..w..", "..w.."],
  bot: [
    ".......yy.......",
    ".......kk.......",
    "...kkkkkkkkkk...",
    "..kllllllllllk..",
    "..klkkkkkkkklk..",
    "..klkmmkkmmklk..",
    "..klkmmkkmmklk..",
    "..klkkkkkkkklk..",
    "..klkkmmmmkklk..",
    "..klkkkkkkkklk..",
    "..kllllllllllk..",
    "...kkkkkkkkkk...",
    "....kcccccck....",
    ".kk.kccyycck.kk.",
    "....kcccccck....",
    "....kk....kk....",
  ],
  database: [
    "..kkkkkkkkkk..",
    ".kmmmmmmmmmmk.",
    "kmmMMMMMMMMmmk",
    "kMmmmmmmmmmmMk",
    "kMMMMMMMMMMMMk",
    "kmmmmmmmmmmmmk",
    "kMmmmmmmmmmmMk",
    "kMMMMMMMMMMMMk",
    "kmmmmmmmmmmmmk",
    "kMmmmmmmmmmmMk",
    ".kMMMMMMMMMMk.",
    "..kkkkkkkkkk..",
  ],
  /** Left-facing fish; flip horizontally to swim right. */
  fish: [
    "..kkkkkk...",
    ".kffffffk.k",
    "kfwkffffkkk",
    "kffFFFFfkk.",
    "kfffffffkkk",
    ".kffffffk.k",
    "..kkkkkk...",
  ],
  jelly: [
    "..kkkkk..",
    ".kccccck.",
    "kcwccccck",
    "kccccccck",
    "kCkCkCkCk",
    ".C.C.C.C.",
    "C.C.C.C..",
    ".C.C.C.C.",
    "..C...C..",
  ],
  starfish: [
    "...y...",
    "...y...",
    "yyyyyyy",
    ".yyyyy.",
    "..yYy..",
    ".yy.yy.",
    "yy...yy",
  ],
  bubble: [".w.", "w.w", ".w."],
} as const;

export type SpriteName = keyof typeof SPRITES;
