import { useEffect, useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';
import type { LayoutResult, LayoutRow } from '@/lib/justifiedLayout';
import type { MediaItem } from '@/lib/mediaItem';

type Anchor = {
  itemId: string;
  // row.y - scrollTop at capture. With the y≥scrollTop anchor rule this is
  // ≥ 0 in the common case (the anchor row's top edge sits at or below the
  // viewport top). It can be negative only via the fallback branch in
  // findAnchorRow, when scrollTop is past the end of all rows. Restoration
  // math (scrollTop = row.y - offset) works for both signs.
  offsetFromViewportTop: number;
};

interface UseScrollAnchorParams {
  scrollRef: RefObject<HTMLElement | null>;
  layout: LayoutResult;
  items: ReadonlyArray<MediaItem>;
}

/**
 * Preserve the user's vertical position across layout changes (column-count
 * slider, viewport resize) by anchoring on the topmost visible row by item id.
 *
 * - Capture: on scroll, record the topmost visible row's leftmost item id and
 *   the row's y-offset from the viewport top. Stored in a ref, not React
 *   state — anchor updates fire on every scroll frame and must not provoke
 *   re-renders.
 * - Restore: every time `layout` changes by reference, useLayoutEffect runs
 *   *before paint*, finds the anchor item's new row, and sets scrollTop so
 *   the visual position is preserved.
 *
 * The capture listener is bound once at mount. It reads the latest layout and
 * items through refs so it never re-binds when those change — re-binding
 * would burn a frame on every column-count tick and race with restoration.
 *
 * Anchoring by id (not index) is the property that makes the live-prepend
 * stretch goal (S6) free: an item that moves rows when N items are prepended
 * above it stays anchored because we still find it by id. See CLAUDE.md §5
 * pillar 3.
 */
export function useScrollAnchor({ scrollRef, layout, items }: UseScrollAnchorParams) {
  const anchorRef = useRef<Anchor | null>(null);

  // Latest-value refs for the (mount-bound) scroll listener. Writing in the
  // render body keeps them in sync with the committed render at all times;
  // no useEffect indirection needed.
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const itemsRef = useRef(items);
  itemsRef.current = items;

  // Capture — bind once at mount.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return; // No scroll element on first mount — nothing to observe.

    let rafId: number | null = null;

    const capture = () => {
      rafId = null;
      const currentLayout = layoutRef.current;
      const currentItems = itemsRef.current;
      const rows = currentLayout.rows;
      if (rows.length === 0) return;

      const scrollTop = el.scrollTop;
      const viewportBottom = scrollTop + el.clientHeight;

      // Prefer the prev anchor's row if it's still visible anywhere in the
      // viewport. The earlier rule was "use it only if it's within the
      // topmost row's [startIndex, endIndex) range" — that broke after a
      // restoration into a denser layout. Restoration sets scrollTop so the
      // anchor row sits at its captured offset; in the new layout the offset
      // can span *several* shorter rows, so the topmost row at-or-below
      // scrollTop is some *other* row, not the anchor's row. The old rule
      // saw no match and walked the anchor to that other row's leftmost,
      // shifting position once per first cycle and then stabilizing wrong.
      //
      // The new rule: track the same anchor item as long as its row remains
      // in view. User-scrolled it off-screen → fall back to "topmost row's
      // leftmost item" (the default capture for fresh scrolls).
      let anchorRow: LayoutRow | undefined;
      let anchorItem: MediaItem | undefined;

      const prevId = anchorRef.current?.itemId;
      if (prevId) {
        const prevItemIdx = findItemIndexById(currentItems, prevId);
        if (prevItemIdx !== -1) {
          const r = findRowByItemIndex(rows, prevItemIdx);
          if (r !== -1) {
            const candidate = rows[r];
            const stillVisible =
              candidate.y + candidate.height > scrollTop &&
              candidate.y < viewportBottom;
            if (stillVisible) {
              anchorRow = candidate;
              anchorItem = currentItems[prevItemIdx];
            }
          }
        }
      }

      if (!anchorRow || !anchorItem) {
        const rowIdx = findAnchorRow(rows, scrollTop);
        if (rowIdx === -1) return;
        anchorRow = rows[rowIdx];
        anchorItem = currentItems[anchorRow.startIndex];
      }
      if (!anchorItem) return;

      anchorRef.current = {
        itemId: anchorItem.id,
        offsetFromViewportTop: anchorRow.y - scrollTop,
      };
    };

    const onScroll = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(capture);
    };

    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- listener bound once; latest layout/items reach it via refs.
  }, []);

  // Restore — fires on every layout reference change, synchronously before paint.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const anchor = anchorRef.current;
    if (!el) return;
    if (!anchor) return; // No anchor yet — first render(s) before any scroll. scrollTop=0 needs no restoration.
    if (layout.rows.length === 0) return; // Empty layout (e.g., containerWidth=0 on first paint).

    const itemIdx = items.findIndex((it) => it.id === anchor.itemId);
    if (itemIdx === -1) return; // Anchor item not in the new dataset — graceful no-op.

    const rowIdx = findRowByItemIndex(layout.rows, itemIdx);
    if (rowIdx === -1) return; // Defensive: an item index without a containing row would be a layout bug.

    // No explicit clear of an invalid anchor — the next scroll capture
    // overwrites anchorRef with a fresh value against the current layout.
    const row = layout.rows[rowIdx];
    const desired = row.y - anchor.offsetFromViewportTop;
    // Explicit clamp: when the new layout is shorter than the old (extreme
    // column-count or viewport changes), `desired` can exceed the valid
    // scrollTop range and the browser would silently clamp. Doing it here
    // makes the edge case visible and documents that we accept anchor loss
    // in that case — a subsequent scroll capture will record a new anchor at
    // the clamped position, and back-and-forth slider drags won't fully
    // round-trip. Out of scope to preserve anchor identity across clamps.
    const maxScroll = Math.max(0, layout.totalHeight - el.clientHeight);
    const target = Math.max(0, Math.min(desired, maxScroll));
    if (target === el.scrollTop) return;
    el.scrollTop = target;
    // Force any subscribed scroll listeners (notably @tanstack/react-virtual's
    // own listener, which caches its internal scrollOffset and uses it to
    // pick which rows to render) to observe the new scrollTop *inside this
    // useLayoutEffect*, before paint. The browser would deliver this event
    // asynchronously on its own, leaving one paint with the virtualizer's
    // stale offset — the virtualizer renders rows for the previous scrollTop
    // (in the new layout's coordinate space), and the viewport at the
    // restored scrollTop ends up empty. Dispatching synchronously lands the
    // update in the current commit cycle so the next paint is correct.
    el.dispatchEvent(new Event('scroll'));
  }, [layout, items, scrollRef]);
}

/**
 * Pick the anchor row: the topmost row whose top edge is at or below
 * scrollTop — i.e., the first row with y >= scrollTop. Its top edge stays
 * within or below the viewport top at all times, so the anchor item remains
 * in view across layout changes that shrink cells. (Cells get shorter ⇒ row
 * moves down relative to its captured offset, but the top edge is still
 * ≤ scrollTop + the row's new height — bounded inside the viewport rather
 * than slipping above it.)
 *
 * Earlier this picked the first row that *intersects* scrollTop (i.e., a
 * straddling row when one existed). That kept the row's top edge stable but
 * let the row's leftmost item end up entirely above the viewport in the new
 * layout — the row top was preserved at y=-270, and once cells shrunk below
 * 270px the item was gone. The y≥scrollTop rule prevents that by keeping the
 * top edge non-negative relative to the viewport.
 *
 * Falls back to the final row if scrollTop is past the end of all rows
 * (defensive: shouldn't normally happen, but a clamped restoration could
 * leave us there, and anchoring to *something* beats refusing).
 *
 * Returns -1 only if `rows` is empty.
 */
function findAnchorRow(
  rows: ReadonlyArray<LayoutRow>,
  scrollTop: number,
): number {
  let lo = 0;
  let hi = rows.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (rows[mid].y < scrollTop) lo = mid + 1;
    else hi = mid;
  }
  if (lo < rows.length) return lo;
  return rows.length > 0 ? rows.length - 1 : -1;
}

/**
 * Linear scan for an item by id. Sub-ms at 2k items; used only on each
 * capture frame (rAF-throttled). A Map<id, index> would be O(1) but the
 * indexing pass is per render and would itself be O(n), so the practical
 * cost is the same.
 */
function findItemIndexById(
  items: ReadonlyArray<MediaItem>,
  id: string,
): number {
  for (let i = 0; i < items.length; i++) {
    if (items[i].id === id) return i;
  }
  return -1;
}

/**
 * Binary search for the row whose [startIndex, endIndex) range contains
 * `itemIdx`. Returns -1 if no row claims this index — only possible if the
 * item is beyond the layout's tail, which shouldn't happen with a consistent
 * (items, layout) pair.
 */
function findRowByItemIndex(
  rows: ReadonlyArray<LayoutRow>,
  itemIdx: number,
): number {
  let lo = 0;
  let hi = rows.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const r = rows[mid];
    if (r.endIndex <= itemIdx) lo = mid + 1;
    else if (r.startIndex > itemIdx) hi = mid;
    else return mid;
  }
  return -1;
}
