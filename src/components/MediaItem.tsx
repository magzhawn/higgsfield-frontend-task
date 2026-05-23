import { useRef } from 'react';
import { isImage } from '@/lib/mediaItem';
import type { MediaItem as MediaItemType } from '@/lib/mediaItem';
import type { LayoutCell } from '@/lib/justifiedLayout';
import { useVideoCell } from '@/hooks/useVideoPlayback';

interface MediaItemProps {
  item: MediaItemType;
  cell: LayoutCell;
}

export function MediaItem({ item, cell }: MediaItemProps) {
  // The ref attaches only to the <video> branch below; for image items it
  // stays null and useVideoCell's effect early-returns. Calling the hook
  // unconditionally keeps hook ordering stable across image/video items
  // without splitting MediaItem into two components.
  const videoRef = useRef<HTMLVideoElement>(null);
  useVideoCell(videoRef, item.id);

  return (
    <div
      className="item"
      // Stable id surfaced in the DOM so the scroll-anchor verification (and
      // anyone debugging in devtools) can identify a cell without reaching
      // into React internals.
      data-item-id={item.id}
      style={{
        width: cell.width,
        height: cell.height,
        transform: `translateX(${cell.x}px)`,
      }}
    >
      {isImage(item) ? (
        <img src={item.url} alt="" loading="lazy" />
      ) : (
        // Native <video poster> + preload="none" — one DOM node, browser-managed
        // poster timing, video bytes only fetch on play(). See Decisions log
        // 2026-05-23 for the <img>-overlay alternative considered.
        <video
          ref={videoRef}
          poster={item.posterUrl}
          src={item.url}
          preload="none"
          muted
          playsInline
          loop
        />
      )}
    </div>
  );
}
