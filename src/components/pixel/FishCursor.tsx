import { spriteDataUri } from "./Sprite";

/**
 * Tiny pixel-fish cursors: pink by default, aquamarine over anything clickable.
 * Text fields keep the text caret. Hotspot is the fish's nose.
 * Rendered unlayered so it outranks Tailwind's layered cursor utilities on clickable elements.
 */
const fish = spriteDataUri("fish", 2, { f: "#ff77a8", F: "#ffd166" });
const fishHover = spriteDataUri("fish", 2, { f: "#4ff0d0", F: "#effffb" });

const css = `
html{cursor:url("${fish}") 0 6,auto}
a,button,[role=tab],select,summary,input[type=range],input[type=color],input[type=checkbox]{cursor:url("${fishHover}") 0 6,pointer}
button:disabled{cursor:not-allowed}
`;

export function FishCursor() {
  return <style>{css}</style>;
}
