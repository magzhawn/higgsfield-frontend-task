import { MediaFeed } from '@/components/MediaFeed';
import itemsData from '@/data/items.json';
import type { MediaItem } from '@/lib/mediaItem';

// Cast: the JSON's inferred type is a tuple of 2000 specific object literals,
// which is correct but slow to typecheck. Cast once to the runtime type the
// dataset generator wrote.
const items = itemsData as ReadonlyArray<MediaItem>;

export default function App() {
  return <MediaFeed items={items} targetRowHeight={240} gap={8} />;
}
