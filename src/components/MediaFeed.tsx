import { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useContainerWidth } from '@/hooks/useContainerWidth';
import { useJustifiedLayout } from '@/hooks/useJustifiedLayout';
import type { MediaItem } from '@/lib/mediaItem';
import { MediaRow } from './MediaRow';

interface MediaFeedProps {
  items: ReadonlyArray<MediaItem>;
  targetRowHeight: number;
  gap: number;
}

export function MediaFeed({ items, targetRowHeight, gap }: MediaFeedProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const containerWidth = useContainerWidth(scrollRef);
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
