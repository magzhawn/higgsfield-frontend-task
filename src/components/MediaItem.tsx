import { useRef } from 'react';
import { isImage } from '@/lib/mediaItem';
import type { MediaItem as MediaItemType } from '@/lib/mediaItem';
import type { LayoutCell } from '@/lib/justifiedLayout';
import { useVideoCell } from '@/hooks/useVideoPlayback';

interface MediaItemProps {
  item: MediaItemType;
  cell: LayoutCell;
  // Vertical offset of the containing row, in feed-inner coordinates.
  // Combined with `cell.x` into a single 2D translate so MediaItem carries
  // its full position. Rows aren't DOM elements — see Decisions log
  // 2026-05-23 (flat keying) for why.
  rowY: number;
}

export function MediaItem({ item, cell, rowY }: MediaItemProps) {
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
        transform: `translate(${cell.x}px, ${rowY}px)`,
      }}
    >
      {isImage(item) ? (
        // No loading="lazy": the virtualizer already gates which items mount.
        // Double-gating saves no work and adds a ~1-frame intersection-check delay
        // before cached images paint on remount.
        <img src={item.url} alt="" />
      ) : (
        // preload="none" + Pexels thumbnail poster. preload="metadata" looks
        // tempting (browser shows the actual first frame at #t=N as the static
        // state), but it triggers a metadata fetch on every <video> mount —
        // with virtualization mounting 10–25 video elements at a time and the
        // browser's 6-per-origin connection pool, fast scrolling saturated
        // the pipeline and pinned INP at ~3.5s. Using the matching Pexels
        // thumbnail URL as the poster preserves the content-coherence win
        // (poster is the same scene the video plays) without any metadata
        // fetches; only the 3 videos useVideoPlayback chooses to play
        // actually pull bytes. See Decisions log 2026-05-23.
        <video
          ref={videoRef}
          src={item.url}
          poster={item.posterUrl}
          preload="none"
          muted
          playsInline
          loop
        />
      )}
    </div>
  );
}
