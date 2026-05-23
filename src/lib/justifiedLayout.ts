/**
 * Pure justified-row layout.
 *
 * Walks a sequence of items — each described by `aspectRatio` only — and breaks
 * them into rows whose items share a common height that justifies the row to
 * the container width. Greedy, not globally optimal (see CLAUDE.md §5 pillar 1
 * for why we rejected Knuth-Plass DP).
 *
 * No React, no DOM, no MediaItem coupling. The input shape is the bare minimum
 * the algorithm needs; callers map their richer types onto `{ aspectRatio }`.
 *
 * Units: containerWidth, targetRowHeight, gap, and every output dimension are
 * CSS pixels in the same coordinate space. Outputs may be fractional — browsers
 * sub-pixel render correctly, and any integer rounding belongs at the render
 * boundary (not here).
 */

export type LayoutInput = {
  items: ReadonlyArray<{ aspectRatio: number }>;
  containerWidth: number;
  targetRowHeight: number;
  gap: number;
};

/**
 * Position and size of a single item within its row. `x` is the item's left
 * offset relative to the row's left edge (not the container).
 */
export type LayoutCell = {
  width: number;
  height: number;
  x: number;
};

/**
 * A row of items, sharing the same height by construction. `startIndex` and
 * `endIndex` (exclusive) map cells back to the original input array — the
 * React layer uses these to look up the matching MediaItem by index.
 */
export type LayoutRow = {
  startIndex: number;
  endIndex: number;
  // Shared by every cell in this row by construction. Read directly here
  // (rather than via items[0].height) for cheap virtualizer integration —
  // estimateSize(rowIndex) becomes layout.rows[rowIndex].height with no
  // defensive chain — and to keep a defined height even if items[] is empty.
  height: number;
  y: number;
  items: ReadonlyArray<LayoutCell>;
};

export type LayoutResult = {
  rows: ReadonlyArray<LayoutRow>;
  totalHeight: number;
};

export function justifiedLayout(input: LayoutInput): LayoutResult {
  const { items, containerWidth, targetRowHeight, gap } = input;

  // Empty input — no rows, no height.
  if (items.length === 0) return { rows: [], totalHeight: 0 };

  // Defensive against transient measurement state: ResizeObserver can fire
  // before the container has a meaningful width, and a column-count slider
  // mid-drag can briefly produce a non-positive target. Empty layout beats
  // a tree of NaN-filled rows.
  if (containerWidth <= 0 || targetRowHeight <= 0) {
    return { rows: [], totalHeight: 0 };
  }

  const rows: LayoutRow[] = [];
  let y = 0;
  let cursor = 0;

  while (cursor < items.length) {
    const { endExclusive, height: naturalHeight } = findRowEnd(
      items,
      cursor,
      containerWidth,
      targetRowHeight,
      gap,
    );

    // Last-row cap: when the trailing row's natural height runs way over the
    // target (typical when only a few items remain with a small aspect-ratio
    // sum), cap at target and leave the row left-aligned. A single absurdly
    // tall row at the end of the feed reads as a bug; a short row reads as
    // intentional. See CLAUDE.md §5 pillar 1.
    const isLastRow = endExclusive === items.length;
    const height =
      isLastRow && naturalHeight > targetRowHeight * 1.5
        ? targetRowHeight
        : naturalHeight;

    // Build cells. Each cell's width = aspectRatio * row height. When the row
    // is capped, cells keep their natural-aspect widths at the capped height,
    // so the row ends short of containerWidth instead of stretching.
    const cells: LayoutCell[] = [];
    let x = 0;
    for (let k = cursor; k < endExclusive; k++) {
      const w = items[k].aspectRatio * height;
      cells.push({ width: w, height, x });
      x += w + gap;
    }
    // x now overruns the row by one trailing gap (loop adds gap after every
    // cell). Don't read it post-loop — derive used width from the last cell.

    rows.push({ startIndex: cursor, endIndex: endExclusive, height, y, items: cells });
    y += height + gap;
    cursor = endExclusive;
  }

  // y over-counts by one trailing gap (the loop adds `gap` after every row,
  // including the last). Subtract so totalHeight is just the content extent.
  return { rows, totalHeight: y - gap };
}

/**
 * Decide where the current row ends. Greedy: extend the row one item at a time;
 * row height drops monotonically as items are added (positive aspect ratios).
 * Once it crosses below target, choose whether keeping or dropping the marginal
 * item lands closer to target. A first item whose natural row height is already
 * below target is an extreme panorama and gets its own row — there is no choice.
 */
function findRowEnd(
  items: ReadonlyArray<{ aspectRatio: number }>,
  start: number,
  containerWidth: number,
  targetRowHeight: number,
  gap: number,
): { endExclusive: number; height: number } {
  // h(start, end) = (containerWidth - (n - 1) * gap) / arSum,  n = end - start.
  // For n === 1 the gap term vanishes, so a single-item row's height is
  // exactly containerWidth / aspectRatio. Running arSum keeps the loop linear
  // in items-per-row (O(n) total across the whole feed).
  let arSum = 0;
  let lastGoodEnd = start;
  let lastGoodHeight = Infinity;

  for (let end = start + 1; end <= items.length; end++) {
    arSum += items[end - 1].aspectRatio;
    const n = end - start;
    const h = (containerWidth - (n - 1) * gap) / arSum;

    if (h >= targetRowHeight) {
      lastGoodEnd = end;
      lastGoodHeight = h;
      continue;
    }

    // h < target. Extreme-panorama short-circuit: if even one item alone
    // produces a row shorter than target, it gets its own row — adding more
    // items would only make it shorter.
    if (lastGoodEnd === start) return { endExclusive: end, height: h };

    // Otherwise compare: include the marginal item (h, below target) or
    // exclude it (lastGoodHeight, at-or-above target). Closer to target wins.
    return targetRowHeight - h < lastGoodHeight - targetRowHeight
      ? { endExclusive: end, height: h }
      : { endExclusive: lastGoodEnd, height: lastGoodHeight };
  }

  // Drained the input without h ever crossing below target — this is the
  // trailing row of the feed. The caller's last-row cap handles the "too tall"
  // case if it applies.
  return { endExclusive: items.length, height: lastGoodHeight };
}
