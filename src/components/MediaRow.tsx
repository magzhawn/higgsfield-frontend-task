import { MediaItem } from './MediaItem';
import type { MediaItem as MediaItemType } from '@/lib/mediaItem';
import type { LayoutRow } from '@/lib/justifiedLayout';

interface MediaRowProps {
  row: LayoutRow;
  items: ReadonlyArray<MediaItemType>;
}

export function MediaRow({ row, items }: MediaRowProps) {
  return (
    <div
      className="row"
      style={{
        height: row.height,
        transform: `translateY(${row.y}px)`,
      }}
    >
      {row.items.map((cell, k) => (
        <MediaItem key={items[k].id} item={items[k]} cell={cell} />
      ))}
    </div>
  );
}
