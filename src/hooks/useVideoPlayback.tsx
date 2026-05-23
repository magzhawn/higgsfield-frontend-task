import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import type { ReactNode, RefObject } from 'react';

// Concurrency cap: at most this many videos play at once. The number is a
// rough decode-cost budget for a mid-tier laptop — playing every visible
// muted MP4 in a wide feed will eat CPU and battery for no perceived benefit.
// See CLAUDE.md §5 pillar 4.
const MAX_CONCURRENT_VIDEOS = 3;

// Velocity gate: above this scroll speed we treat the user as "in transit"
// and pause every video. Conservative so it kicks in well before the user
// can perceive thumbnail churn but not so low that gentle scrolling kills
// playback. Informal — the proper fast-scroll handling is stretch S2.
const FAST_SCROLL_THRESHOLD_PX_PER_SEC = 1000;

// After this much idle time post-fast-scroll we re-evaluate playback. Short
// enough that "stop, look" feels responsive; long enough that two adjacent
// jumps coalesce into one quiet period instead of thrashing play/pause.
const VELOCITY_RESUME_TIMEOUT_MS = 150;

interface VideoEntry {
  itemId: string;
  // Monotonic counter at registration time. Used to break ties when two
  // videos are equidistant from the viewport center, so the ordering is
  // stable across refreshes.
  registeredAt: number;
}

interface VideoPlaybackContextValue {
  register: (el: HTMLVideoElement, itemId: string) => void;
  unregister: (el: HTMLVideoElement) => void;
}

const VideoPlaybackContext = createContext<VideoPlaybackContextValue | null>(null);

interface VideoPlaybackProviderProps {
  scrollRef: RefObject<HTMLElement | null>;
  children: ReactNode;
}

/**
 * Owns the concurrency policy for video playback. Each video cell registers
 * itself via useVideoCell; the provider listens to a shared
 * IntersectionObserver and the scroll element, then on every rAF after a
 * relevant event:
 *
 *   1. If scroll velocity > threshold, pause everything (and schedule a
 *      follow-up refresh once velocity decays).
 *   2. Otherwise, rank intersecting videos by distance from viewport center,
 *      play the top MAX_CONCURRENT_VIDEOS, pause the rest.
 *
 * Lifecycle:
 *   - Provider mounts → useEffect attaches the observer + scroll listener.
 *   - Video cell mounts → useEffect calls register(el, itemId). The provider
 *     inserts into the registry and observer.observe(el). A refresh is
 *     scheduled so newly-mounted videos enter play candidacy on the next frame.
 *   - User scrolls → scroll handler records the new scrollTop+time, recomputes
 *     velocity, schedules a refresh.
 *   - IntersectionObserver fires → callback marks intersecting/not, schedules
 *     a refresh.
 *   - Refresh runs in rAF → reads scroll element rect, ranks intersecting
 *     videos, issues play()/pause() to bring the world into the policy.
 *   - Video cell unmounts → cleanup calls unregister, observer.unobserve,
 *     registry delete. No refresh needed: a removed-from-DOM video is no
 *     longer playable regardless.
 */
export function VideoPlaybackProvider({
  scrollRef,
  children,
}: VideoPlaybackProviderProps) {
  // Two parallel data structures, keyed by the video element:
  //   registry  — metadata we control (itemId, registration order)
  //   intersecting — whether the observer last reported it as visible
  // Both live in refs so updates don't churn React state.
  const registryRef = useRef<Map<HTMLVideoElement, VideoEntry>>(new Map());
  const intersectingRef = useRef<Set<HTMLVideoElement>>(new Set());
  const registrationCounterRef = useRef(0);

  const observerRef = useRef<IntersectionObserver | null>(null);

  // Scroll velocity tracking (px/sec).
  const lastScrollTopRef = useRef(0);
  const lastScrollTimeRef = useRef(0);
  const velocityRef = useRef(0);
  const pausedForVelocityRef = useRef(false);
  const resumeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // rAF coalescing.
  const rafIdRef = useRef<number | null>(null);

  // refreshRef is mutated below; we keep it in a ref so the
  // (effect-bound) observer/scroll callbacks always invoke the latest version
  // without re-binding when constants close over fresh values.
  const refreshRef = useRef<() => void>(() => {});

  // Schedule a refresh on the next animation frame. Coalesces multiple
  // events (observer + scroll within one frame) into a single playback pass.
  const scheduleRefresh = () => {
    if (rafIdRef.current !== null) return;
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null;
      refreshRef.current();
    });
  };

  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;

    // Refresh: the core playback decision. Closes over `root`, but reads
    // everything else from refs so it doesn't go stale across renders.
    refreshRef.current = () => {
      const registry = registryRef.current;
      const intersecting = intersectingRef.current;
      if (registry.size === 0) return; // No videos in play — common during image-heavy regions.

      // Velocity gate: pause everything if the user is mid-flight, regardless
      // of intersection state. Scheduled timeout will refresh again once
      // the page is quiet long enough.
      if (pausedForVelocityRef.current) {
        for (const [el] of registry) {
          if (!el.paused) el.pause();
        }
        return;
      }

      // Compute viewport center in viewport (client) coordinates. The video
      // cells' getBoundingClientRect is also in client coords, so distances
      // line up without any extra scrollTop arithmetic.
      const rootRect = root.getBoundingClientRect();
      const viewportCenter = rootRect.top + rootRect.height / 2;

      // Rank intersecting, layout-measured videos by |cellCenter - viewportCenter|.
      // Two stability properties:
      //   - We skip videos whose rect.height is 0: a cell registered before
      //     layout measured its size would otherwise look "at the very top"
      //     and grab a play slot it doesn't deserve.
      //   - Ties (identical distance, possible at exact symmetric positions)
      //     fall back to registration order via the secondary sort key.
      const candidates: { el: HTMLVideoElement; dist: number; order: number }[] = [];
      for (const el of intersecting) {
        const entry = registry.get(el);
        if (!entry) continue; // intersection event raced with unregister; drop it.
        const r = el.getBoundingClientRect();
        if (r.height === 0) continue; // not yet laid out
        const cellCenter = r.top + r.height / 2;
        candidates.push({
          el,
          dist: Math.abs(cellCenter - viewportCenter),
          order: entry.registeredAt,
        });
      }
      candidates.sort((a, b) => a.dist - b.dist || a.order - b.order);

      const playSet = new Set<HTMLVideoElement>();
      for (let i = 0; i < Math.min(MAX_CONCURRENT_VIDEOS, candidates.length); i++) {
        playSet.add(candidates[i].el);
      }

      // Reconcile: every registered video should be in the desired state.
      // Walking the registry (not just candidates) catches videos that left
      // the viewport since the last refresh and need a pause.
      for (const [el] of registry) {
        if (playSet.has(el)) {
          if (el.paused) {
            // Muted + playsInline videos should satisfy browser autoplay policy,
            // but play() returns a promise that rejects in obscure cases (tab
            // backgrounded right as we call). Swallow — next refresh tries again.
            el.play().catch(() => {});
          }
        } else if (!el.paused) {
          el.pause();
        }
      }
    };

    // IntersectionObserver: one observer for all videos, rooted at the scroll
    // element so it ignores the rest of the page chrome. Threshold 0 is
    // enough — we only need the binary enter/leave signal; precise visibility
    // ratios don't enter the ranking.
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const el = entry.target as HTMLVideoElement;
          if (entry.isIntersecting) intersectingRef.current.add(el);
          else intersectingRef.current.delete(el);
        }
        scheduleRefresh();
      },
      { root, threshold: 0 },
    );
    observerRef.current = observer;

    // Pick up videos that registered before the observer existed (any cell
    // that mounted in the same commit as the provider).
    for (const [el] of registryRef.current) observer.observe(el);

    // Seed velocity tracking so the first scroll delta isn't computed against
    // time=0 (which would yield an infinite px/sec spike on the first scroll).
    lastScrollTopRef.current = root.scrollTop;
    lastScrollTimeRef.current = performance.now();

    const onScroll = () => {
      const now = performance.now();
      const dt = now - lastScrollTimeRef.current;
      if (dt > 0) {
        const ds = Math.abs(root.scrollTop - lastScrollTopRef.current);
        velocityRef.current = (ds / dt) * 1000; // px/sec
      }
      lastScrollTopRef.current = root.scrollTop;
      lastScrollTimeRef.current = now;

      if (velocityRef.current > FAST_SCROLL_THRESHOLD_PX_PER_SEC) {
        pausedForVelocityRef.current = true;
        if (resumeTimeoutRef.current !== null) {
          clearTimeout(resumeTimeoutRef.current);
        }
        // Once the user has been quiet for VELOCITY_RESUME_TIMEOUT_MS, drop
        // the gate and re-evaluate. Two adjacent fast scrolls reset the
        // timeout (above clearTimeout), so a sustained drag stays paused.
        resumeTimeoutRef.current = setTimeout(() => {
          resumeTimeoutRef.current = null;
          pausedForVelocityRef.current = false;
          scheduleRefresh();
        }, VELOCITY_RESUME_TIMEOUT_MS);
      }
      scheduleRefresh();
    };
    root.addEventListener('scroll', onScroll, { passive: true });

    // Initial pass: in case any videos already registered (e.g., on the same
    // commit as the provider).
    scheduleRefresh();

    return () => {
      observer.disconnect();
      observerRef.current = null;
      root.removeEventListener('scroll', onScroll);
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      if (resumeTimeoutRef.current !== null) {
        clearTimeout(resumeTimeoutRef.current);
        resumeTimeoutRef.current = null;
      }
    };
  }, [scrollRef]);

  // Context value: stable for the provider's lifetime. The closures read
  // refs so they don't need to be re-created when state changes.
  const value = useMemo<VideoPlaybackContextValue>(
    () => ({
      register: (el, itemId) => {
        if (registryRef.current.has(el)) return;
        registryRef.current.set(el, {
          itemId,
          registeredAt: registrationCounterRef.current++,
        });
        observerRef.current?.observe(el);
        scheduleRefresh();
      },
      unregister: (el) => {
        if (!registryRef.current.has(el)) return;
        observerRef.current?.unobserve(el);
        registryRef.current.delete(el);
        intersectingRef.current.delete(el);
        // No scheduleRefresh — the removed element is leaving the DOM and
        // can't enter the play set. If it was playing, removal pauses it
        // implicitly. The remaining videos' ranking isn't affected.
      },
    }),
    [],
  );

  return (
    <VideoPlaybackContext.Provider value={value}>
      {children}
    </VideoPlaybackContext.Provider>
  );
}

/**
 * Register a video element with the playback manager. Call once per video
 * cell, passing a ref pointing at the <video> element and the item id (used
 * only for diagnostics — the registry key is the element identity).
 *
 * No-op if there's no enclosing VideoPlaybackProvider, so the hook is safe
 * to call unconditionally and image-only feeds don't need to set up a manager.
 */
export function useVideoCell(
  ref: RefObject<HTMLVideoElement | null>,
  itemId: string,
) {
  const ctx = useContext(VideoPlaybackContext);
  // Dev-only: silent failure here looks like "videos never play" and is hard
  // to diagnose. Surface the missing provider loudly while developing; the
  // import.meta.env.DEV branch is dead-code-eliminated in prod builds.
  if (import.meta.env.DEV && !ctx) {
    console.warn('useVideoCell called outside VideoPlaybackProvider. Videos will not play.');
  }
  useEffect(() => {
    const el = ref.current;
    if (!el || !ctx) return;
    ctx.register(el, itemId);
    return () => ctx.unregister(el);
    // ref identity is stable across renders; itemId only changes if the
    // cell is reused for a different item (won't happen with stable keys),
    // and ctx is memoized in the provider.
  }, [ctx, itemId, ref]);
}
