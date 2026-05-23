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
        // preload="metadata" + no `poster` attribute: the static (paused)
        // state of the cell IS the video's actual first frame, so the cell
        // looks like what it will play. A separate Picsum `poster` URL ran
        // afoul of content mismatch — a paused cell would show a random
        // raspberry-bowl image, then suddenly become jellyfish on play. The
        // metadata fetch is small (a few KB per element); the heavy bytes
        // still wait for useVideoPlayback to call .play(). With #t={N}
        // hashes in the URL, the displayed first frame is the frame AT t=N,
        // so 10 different cells of the same underlying clip show 10
        // different stills. See Decisions log 2026-05-23.
        <video
          ref={videoRef}
          src={item.url}
          preload="metadata"
          muted
          playsInline
          loop
        />
      )}
    </div>
  );
}
