import { useCallback, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useContainerWidth } from '@/hooks/useContainerWidth';
import { useJustifiedLayout } from '@/hooks/useJustifiedLayout';
import { useScrollAnchor } from '@/hooks/useScrollAnchor';
import { VideoPlaybackProvider } from '@/hooks/useVideoPlayback';
import type { MediaItem as MediaItemType } from '@/lib/mediaItem';
import { MediaItem } from './MediaItem';

interface MediaFeedProps {
  items: ReadonlyArray<MediaItemType>;
  columns: number;
  gap: number;
}

export function MediaFeed({ items, columns, gap }: MediaFeedProps) {
  // Note on rendering strategy: we render MediaItems as a flat list under
  // .feed-inner, keyed by item.id, with each item carrying its own
  // translate(x, y). Rows are a *layout* concept (produced by
  // useJustifiedLayout) but not a *DOM* concept. The alternative — wrapping
  // each row in a .row div positioned via translateY — would re-key items
  // under their row, so a layout reflow that shifts an item from row N to
  // row M would unmount and remount its <img>, producing a brief
  // dark-placeholder flash even though the resource is cached. Flat keying
  // by item.id lets React's reconciliation reuse the same DOM node across
  // layout reshuffles. See Decisions log 2026-05-23.
  const scrollRef = useRef<HTMLDivElement>(null);
  const containerWidth = useContainerWidth(scrollRef);

  // Column count is the user-facing handle (ColumnCountControl emits it),
  // but the layout algorithm consumes a targetRowHeight. The translation
  // lives here because containerWidth lives here — lifting the measurement
  // up to App would mean splitting scrollRef from its measured element. The
  // formula treats `columns` as "this many roughly-square cells across" and
  // derives the matching row height; justified layout then packs more narrow
  // items per row and fewer wide ones around that target. See CLAUDE.md §5
  // pillar 1.
  const targetRowHeight =
    containerWidth > 0 ? (containerWidth - (columns - 1) * gap) / columns : 0;

  const layout = useJustifiedLayout(items, containerWidth, targetRowHeight, gap);

  // The virtualizer's internal getMeasurementOptions memo (in
  // @tanstack/virtual-core) does NOT include estimateSize in its dependencies.
  // It does include getItemKey. So when the layout reference changes (e.g., a
  // resize causes new row heights), re-creating estimateSize alone leaves the
  // cache stale and getTotalSize returns the previous layout's total — rows
  // positioned by the new layout end up extending past the scroll surface and
  // the viewport at max scrollTop renders empty. Re-creating getItemKey with
  // a [layout] dep changes its identity, the memo invalidates, and
  // measurements rebuild against the current estimateSize in the same render.
  // Returned key value is unchanged (the row index) so downstream behavior
  // is identical to the default.
  const getItemKey = useCallback((index: number) => index, [layout]);

  const virtualizer = useVirtualizer({
    count: layout.rows.length,
    getScrollElement: () => scrollRef.current,
    getItemKey,
    estimateSize: (i) => {
      // Size reported to the virtualizer is the row's contribution to scroll
      // height: its own height plus the gap separating it from the next row.
      // The last row contributes no trailing gap. This makes the virtualizer's
      // total height equal layout.totalHeight, and its start[i] equal row.y —
      // a consistency we'll lean on for scroll anchoring in Step 5.
      const isLast = i === layout.rows.length - 1;
      return layout.rows[i].height + (isLast ? 0 : gap);
    },
    // Render this many extra rows above and below the viewport. 5 is enough
    // to mask scroll-velocity hitches at typical mouse-wheel speeds on a
    // mid-tier laptop without spending DOM on rows the user will never reach.
    // The fast-scroll grace stretch (S2) would scale this dynamically; static
    // 5 is the placeholder.
    overscan: 5,
    // The library defaults to wrapping its internal re-renders in flushSync
    // on every scroll-driven update. We trigger one of those updates from
    // inside useScrollAnchor's useLayoutEffect (via a synthetic scroll
    // dispatch that lands the new offset same-frame), and flushSync from
    // inside a lifecycle method fires a React dev-mode warning. Disabling
    // useFlushSync uses a plain rerender; React 18 still flushes it in the
    // current commit cycle when we're already inside an effect, so the
    // visual outcome is the same.
    useFlushSync: false,
  });

  // Preserve the topmost-visible item across layout changes (column-count
  // slider, viewport resize). Capture on scroll, restore on layout reference
  // change — see useScrollAnchor for the mechanics.
  useScrollAnchor({ scrollRef, layout, items });

  // Provider wraps the whole feed (including the scroll element it controls)
  // rather than just .feed-inner. Both placements work for context delivery,
  // but wrapping outside reads as "the entire feed is under playback control"
  // and matches the provider's effect lifecycle, which reaches *into*
  // scrollRef.current. The provider renders no DOM — the resulting tree is
  // identical to the unwrapped version.
  return (
    <VideoPlaybackProvider scrollRef={scrollRef}>
      <div ref={scrollRef} className="feed">
        <div className="feed-inner" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().flatMap((virtualRow) => {
            const row = layout.rows[virtualRow.index];
            return row.items.map((cell, k) => {
              const item = items[row.startIndex + k];
              return (
                <MediaItem
                  key={item.id}
                  item={item}
                  cell={cell}
                  rowY={row.y}
                />
              );
            });
          })}
        </div>
      </div>
    </VideoPlaybackProvider>
  );
}
