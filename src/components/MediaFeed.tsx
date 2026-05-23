import { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useContainerWidth } from '@/hooks/useContainerWidth';
import { useJustifiedLayout } from '@/hooks/useJustifiedLayout';
import { useScrollAnchor } from '@/hooks/useScrollAnchor';
import type { MediaItem } from '@/lib/mediaItem';
import { MediaRow } from './MediaRow';

interface MediaFeedProps {
  items: ReadonlyArray<MediaItem>;
  columns: number;
  gap: number;
}

export function MediaFeed({ items, columns, gap }: MediaFeedProps) {
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

  const virtualizer = useVirtualizer({
    count: layout.rows.length,
    getScrollElement: () => scrollRef.current,
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
  });

  // Preserve the topmost-visible item across layout changes (column-count
  // slider, viewport resize). Capture on scroll, restore on layout reference
  // change — see useScrollAnchor for the mechanics.
  useScrollAnchor({ scrollRef, layout, items });

  return (
    <div ref={scrollRef} className="feed">
      <div className="feed-inner" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const row = layout.rows[virtualRow.index];
          return (
            <MediaRow
              key={virtualRow.key}
              row={row}
              items={items.slice(row.startIndex, row.endIndex)}
            />
          );
        })}
      </div>
    </div>
  );
}
