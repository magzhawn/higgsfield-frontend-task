/**
 * Verification harness for src/lib/justifiedLayout.ts.
 *
 * Runs the layout against the real dataset at several scenarios and prints
 * per-scenario statistics + a final PASS/REVIEW verdict per scenario.
 *
 * Not a real test framework — just a script we eyeball before committing.
 * Output is the script's user-facing surface (per CLAUDE.md §8 carve-out).
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { justifiedLayout } from '../src/lib/justifiedLayout.ts';
import type { LayoutResult } from '../src/lib/justifiedLayout.ts';
import type { MediaItem } from '../src/lib/mediaItem.ts';

// ---- Scenarios -------------------------------------------------------------

type Scenario = {
  name: string;
  containerWidth: number;
  targetRowHeight: number;
  gap: number;
};

const SCENARIOS: ReadonlyArray<Scenario> = [
  { name: 'baseline desktop', containerWidth: 1200, targetRowHeight: 240, gap: 8 },
  { name: 'smaller cells', containerWidth: 1200, targetRowHeight: 180, gap: 8 },
  { name: 'larger cells', containerWidth: 1200, targetRowHeight: 320, gap: 8 },
  { name: 'mobile-ish', containerWidth: 600, targetRowHeight: 200, gap: 6 },
  { name: 'wide desktop', containerWidth: 1920, targetRowHeight: 280, gap: 12 },
];

// PASS criteria: at least 80% of rows in the tight band AND the last-row cap
// behaved correctly (either fired-and-equaled-target, or did-not-fire-and-
// matched-naturalHeight). Both must hold.
const TIGHT_PASS_FRACTION = 0.8;

// ---- Dataset ---------------------------------------------------------------

const here = dirname(fileURLToPath(import.meta.url));
const itemsPath = resolve(here, '..', 'src', 'data', 'items.json');
const items: MediaItem[] = JSON.parse(readFileSync(itemsPath, 'utf8'));

// ---- Stats helpers ---------------------------------------------------------

const mean = (xs: number[]) => xs.reduce((s, n) => s + n, 0) / xs.length;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mode = (xs: number[]) => {
  const counts = new Map<number, number>();
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
  let best = xs[0], bestC = -1;
  for (const [v, c] of counts) if (c > bestC) { best = v; bestC = c; }
  return best;
};
const pct = (a: number, b: number) => ((a / b) * 100).toFixed(1);

// Float comparison: layout outputs are doubles, the cap sets height to
// targetRowHeight exactly, and naturalHeight comes from the same formula the
// algorithm uses. 1e-6 is more than enough to absorb any reordering noise.
const closeEnough = (a: number, b: number) => Math.abs(a - b) < 1e-6;

// ---- Per-scenario summary --------------------------------------------------

type Verdict = { name: string; pass: boolean; tightPct: number; capOk: boolean };

function summarize(scenario: Scenario, layout: LayoutResult): Verdict {
  const { name, containerWidth, targetRowHeight, gap } = scenario;
  const { rows } = layout;
  const heights = rows.map((r) => r.height);
  const counts = rows.map((r) => r.items.length);

  // Bands per the spec.
  const tightLo = targetRowHeight * 0.85;
  const tightHi = targetRowHeight * 1.15;
  const accLo = targetRowHeight * 0.7;
  const accHi = targetRowHeight * 1.4;

  const tightCount = heights.filter((h) => h >= tightLo && h <= tightHi).length;
  const accCount = heights.filter((h) => h >= accLo && h <= accHi).length;

  // Outliers = outside the acceptable band. Worst-N by absolute distance from
  // target — easier to interpret than raw min/max.
  const outliers = rows
    .map((r, i) => ({ index: i, height: r.height, dev: Math.abs(r.height - targetRowHeight) }))
    .filter((o) => o.height < accLo || o.height > accHi)
    .sort((a, b) => b.dev - a.dev);
  const worst3 = outliers.slice(0, 3);

  // Last-row analysis — recompute the natural height independently from the
  // input items, so we can verify the cap fired iff it should have.
  const last = rows[rows.length - 1];
  const lastSlice = items.slice(last.startIndex, last.endIndex);
  const lastN = lastSlice.length;
  const lastArSum = lastSlice.reduce((s, it) => s + it.aspectRatio, 0);
  const lastNatural = (containerWidth - (lastN - 1) * gap) / lastArSum;
  const lastShouldCap = lastNatural > targetRowHeight * 1.5;
  const lastFinal = last.height;
  const capOk = lastShouldCap
    ? closeEnough(lastFinal, targetRowHeight)
    : closeEnough(lastFinal, lastNatural);
  const lastCell = last.items[last.items.length - 1];
  const lastUsedWidth = lastCell.x + lastCell.width;
  const lastWidthRatio = lastUsedWidth / containerWidth;

  const totalItems = counts.reduce((s, n) => s + n, 0);

  console.log(`\n=== ${name} (cw=${containerWidth}, target=${targetRowHeight}, gap=${gap}) ===`);
  console.log(`rows: ${rows.length}   total height: ${Math.round(layout.totalHeight)}px   items: ${totalItems}`);
  console.log(`row h    min ${Math.min(...heights).toFixed(1)}  max ${Math.max(...heights).toFixed(1)}  mean ${mean(heights).toFixed(1)}  median ${median(heights).toFixed(1)}`);
  console.log(`tight    [${tightLo.toFixed(0)}, ${tightHi.toFixed(0)}]   ${tightCount}/${rows.length}  (${pct(tightCount, rows.length)}%)`);
  console.log(`accept   [${accLo.toFixed(0)}, ${accHi.toFixed(0)}]   ${accCount}/${rows.length}  (${pct(accCount, rows.length)}%)`);
  console.log(`outliers ${outliers.length}${worst3.length ? '   worst: ' + worst3.map((o) => `[#${o.index} h=${o.height.toFixed(1)}]`).join(' ') : ''}`);
  console.log(`items/r  min ${Math.min(...counts)}  max ${Math.max(...counts)}  mean ${mean(counts).toFixed(2)}  median ${median(counts)}  mode ${mode(counts)}`);
  console.log(`last     n=${lastN}  natural=${lastNatural.toFixed(1)}  final=${lastFinal.toFixed(1)}  shouldCap=${lastShouldCap}  capOk=${capOk}  widthRatio=${lastWidthRatio.toFixed(3)}`);

  const tightPct = tightCount / rows.length;
  return { name, pass: tightPct >= TIGHT_PASS_FRACTION && capOk, tightPct, capOk };
}

// ---- Sanity checks ---------------------------------------------------------

console.log('=== sanity ===');
const empty = justifiedLayout({ items: [], containerWidth: 1200, targetRowHeight: 240, gap: 8 });
const emptyOk = empty.rows.length === 0 && empty.totalHeight === 0;
console.log(`empty input         rows=${empty.rows.length} totalHeight=${empty.totalHeight}   ${emptyOk ? 'OK' : 'FAIL'}`);

const zeroWidth = justifiedLayout({ items, containerWidth: 0, targetRowHeight: 240, gap: 8 });
const zeroWidthOk = zeroWidth.rows.length === 0 && zeroWidth.totalHeight === 0;
console.log(`containerWidth=0    rows=${zeroWidth.rows.length} totalHeight=${zeroWidth.totalHeight}   ${zeroWidthOk ? 'OK' : 'FAIL'}`);

// ---- Run real scenarios ----------------------------------------------------

const verdicts: Verdict[] = [];
for (const scenario of SCENARIOS) {
  const layout = justifiedLayout({
    items,
    containerWidth: scenario.containerWidth,
    targetRowHeight: scenario.targetRowHeight,
    gap: scenario.gap,
  });
  verdicts.push(summarize(scenario, layout));
}

// ---- Final verdict ---------------------------------------------------------

console.log('\n=== verdict ===');
for (const v of verdicts) {
  const tag = v.pass ? 'PASS  ' : 'REVIEW';
  console.log(`${tag}  ${v.name.padEnd(20)}  tight=${(v.tightPct * 100).toFixed(1)}%  capOk=${v.capOk}`);
}
