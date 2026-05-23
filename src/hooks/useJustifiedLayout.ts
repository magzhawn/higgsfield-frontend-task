import { useMemo } from 'react';
import { justifiedLayout } from '@/lib/justifiedLayout';
import type { LayoutResult } from '@/lib/justifiedLayout';
import type { MediaItem } from '@/lib/mediaItem';

/**
 * Memoized React wrapper around the pure layout function. The layout is the
 * single most expensive computation in this app (O(n) over ~2k items every
 * time any of the four inputs changes), so this hook is one of the few places
 * where useMemo earns its keep — see CLAUDE.md §4 React rules.
 *
 * Memoization deps cover every input. `items` must be a stable reference
 * across renders for the cache to actually hit — typically the dataset
 * imported from `src/data/items.json` (a module-singleton array).
 */
export function useJustifiedLayout(
  items: ReadonlyArray<MediaItem>,
  containerWidth: number,
  targetRowHeight: number,
  gap: number,
): LayoutResult {
  return useMemo(
    () => justifiedLayout({ items, containerWidth, targetRowHeight, gap }),
    [items, containerWidth, targetRowHeight, gap],
  );
}
