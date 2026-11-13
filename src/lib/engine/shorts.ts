/**
 * Pure helpers for the short-video generator: turning a script into scenes and finding fallback
 * search terms when no language model is available.
 */

export const MAX_SHORT_SCENES = 12;

/** Split a script into scene lines: one sentence each, merging very short ones, at most MAX_SHORT_SCENES. */
export function splitScript(script: string, maxScenes = MAX_SHORT_SCENES): string[] {
  const text = script
    .replace(/\r/g, "")
    .replace(/[*#_`>]/g, "")
    .replace(/\[[^\]]*\]|\([^)]*\)/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,!?;:])/g, "$1")
    .trim();
  if (!text) return [];
  // Sentence ends: . ! ? (and CJK equivalents) followed by a space or the end — so 1.5 or e.g. "3.0x" stay intact.
  const parts: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (!/[.!?。！？]/.test(text[i])) continue;
    let j = i;
    while (j + 1 < text.length && /[.!?。！？"”’)]/.test(text[j + 1])) j++;
    const next = text[j + 1];
    if (next === undefined || next === " " || /[。！？]/.test(text[i])) {
      parts.push(text.slice(start, j + 1).trim());
      start = j + 1;
      i = j;
    }
  }
  if (start < text.length && text.slice(start).trim()) parts.push(text.slice(start).trim());
  const merged: string[] = [];
  for (const p of parts) {
    const last = merged[merged.length - 1];
    if (last && (last.split(" ").length < 4 || p.split(" ").length < 3)) merged[merged.length - 1] = `${last} ${p}`;
    else merged.push(p);
  }
  // Too many sentences: join neighbours until it fits.
  while (merged.length > maxScenes) {
    let best = 0;
    for (let i = 1; i < merged.length - 1; i++) if (merged[i].length + merged[i + 1].length < merged[best].length + merged[best + 1].length) best = i;
    merged.splice(best, 2, `${merged[best]} ${merged[best + 1]}`);
  }
  return merged;
}

const STOP = new Set(
  "a an the and or but if then than so of to in on at by for with from as is are was were be been being this that these those it its into over under about after before during your you we our they their them he she his her i me my not no do does did can could will would should may might have has had more most less very just also how what why when where who which there here all any some each every one two three".split(" "),
);

/** Up to `n` content words from a sentence (longest first), as a crude search term when no LLM is available. */
export function keywordTerms(sentence: string, n = 2): string {
  const words = sentence
    .toLowerCase()
    .replace(/[^a-z\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOP.has(w));
  const uniq = [...new Set(words)].sort((a, b) => b.length - a.length);
  return uniq.slice(0, n).join(" ") || "abstract background";
}
