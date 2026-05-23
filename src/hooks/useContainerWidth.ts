import { useEffect, useState } from 'react';
import type { RefObject } from 'react';

/**
 * Observe the container element's content-box width and surface it as state.
 *
 * Updates are coalesced to one per animation frame — multiple ResizeObserver
 * notifications within the same frame (animated resizes, sibling-driven
 * layout shifts) collapse into a single setState. See CLAUDE.md §5 pillar 5
 * for why ResizeObserver beats `window.resize` debounced.
 *
 * Initial value is 0 deliberately: the first paint runs before the observer
 * has fired even once, so anything synchronous here would either be wrong or
 * would force an extra render. Consumers must tolerate width === 0 on the
 * first paint (the layout hook returns an empty result in that case).
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

    let rafId: number | null = null;
    let pending: number | null = null;

    const observer = new ResizeObserver((entries) => {
      // Single-target observer, so entries[0] is always our element.
      const entry = entries[0];
      if (!entry) return;
      pending = entry.contentRect.width;
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        if (pending !== null) {
          setWidth(pending);
          pending = null;
        }
      });
    });

    observer.observe(el);
    return () => {
      observer.disconnect();
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ref identity is stable; we attach the observer once on mount and read ref.current inside.
  }, []);

  return width;
}
