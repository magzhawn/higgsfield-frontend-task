import { useCallback, useSyncExternalStore } from 'react';
import type { RefObject } from 'react';

/**
 * Observe the container element's content-box width and surface it as state.
 *
 * Implemented via useSyncExternalStore: the ResizeObserver acts as the
 * external store's change signal, and getSnapshot reads the width fresh
 * from the DOM on each render. This gives us same-frame width updates
 * without flushSync (which fires "called from inside a lifecycle method"
 * warnings during concurrent renders when a slider-induced layout change
 * cascades into a scrollbar toggle and re-fires the observer).
 *
 * The earlier rAF-throttled-setState approach introduced a one-frame lag
 * during sustained resize drags — cells were positioned for the previous
 * width and spilled past the new viewport edge as a white band. The earlier
 * flushSync-setState fix landed the width in the same frame but produced
 * dev-mode warnings. useSyncExternalStore gets both: same-frame and warning-free.
 *
 * Initial value (when ref.current is null) is 0. The first paint runs with
 * an empty layout; the observer subscribes on mount and the next paint has
 * the real width. See CLAUDE.md §5 pillar 5.
 */
export function useContainerWidth(
  ref: RefObject<HTMLElement | null>,
): number {
  const subscribe = useCallback(
    (notify: () => void) => {
      const el = ref.current;
      if (!el) return () => {};
      const observer = new ResizeObserver(notify);
      observer.observe(el);
      return () => observer.disconnect();
    },
    [ref],
  );

  const getSnapshot = useCallback(() => {
    return ref.current?.getBoundingClientRect().width ?? 0;
  }, [ref]);

  return useSyncExternalStore(subscribe, getSnapshot, () => 0);
}
