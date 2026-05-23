import { isImage } from '@/lib/mediaItem';
import type { MediaItem as MediaItemType } from '@/lib/mediaItem';
import type { LayoutCell } from '@/lib/justifiedLayout';

interface MediaItemProps {
  item: MediaItemType;
  cell: LayoutCell;
}

export function MediaItem({ item, cell }: MediaItemProps) {
  // TODO(Step 6): videos render their poster as a static <img> here. The
  // <video> element and autoplay-when-stationary manager (CLAUDE.md §5
  // pillar 4) land in Step 6 — this is a placeholder, not a finished cell.
  const src = isImage(item) ? item.url : item.posterUrl;

  return (
    <div
      className="item"
      style={{
        width: cell.width,
        height: cell.height,
        transform: `translateX(${cell.x}px)`,
      }}
    >
      <img src={src} alt="" loading="lazy" />
    </div>
  );
}
