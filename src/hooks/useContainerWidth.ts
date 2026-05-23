import { useEffect, useState } from 'react';
import type { RefObject } from 'react';
import { flushSync } from 'react-dom';

/**
 * Observe the container element's content-box width and surface it as state.
 *
 * The setState call is wrapped in `flushSync` so the re-render commits
 * inside the ResizeObserver callback, before the next paint. Without it,
 * React's default scheduler can defer the re-render to a later task — for
 * one paint the viewport is at the new width but children are still
 * positioned for the previous width, so cells laid out wider than the new
 * viewport spill past the right edge (visible as a white band during
 * sustained resize drags).
 *
 * Initial value is 0 deliberately: the first paint runs before the observer
 * has fired even once, so anything synchronous here would either be wrong or
 * would force an extra render. Consumers must tolerate width === 0 on the
 * first paint (the layout hook returns an empty result in that case).
 *
 * See CLAUDE.md §5 pillar 5 for why ResizeObserver beats `window.resize`
 * debounced.
 */
export function useContainerWidth(
  ref: RefObject<HTMLElement | null>,
): number {
  // Initial width = 0. The ref is null at first render, so we can't
  // synchronously measure. First paint runs with an empty layout (the
  // algorithm guards against width=0); the observer fires on mount, and the
  // next paint has the real width. The single empty frame is invisible at 60fps.
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      // Single-target observer, so entries[0] is always our element.
      const entry = entries[0];
      if (!entry) return;
      // flushSync forces the resulting re-render + commit before this
      // callback returns. ResizeObserver callbacks run between layout and
      // paint; flushing here means the next paint sees the new layout's
      // cell.x / cell.width, not the previous frame's.
      flushSync(() => setWidth(entry.contentRect.width));
    });

    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ref identity is stable; we attach the observer once on mount and read ref.current inside.
  }, []);

  return width;
}
