# Higgsfield Media Feed

A React + TypeScript justified-row media feed: ~2000 mixed images and videos, virtualized for smooth scrolling on a mid-tier laptop, with a user-adjustable column count that preserves the user's vertical position across layout changes.

## Running it

```bash
npm install
npm run dev   # Vite, http://localhost:5173
```

The dataset (`src/data/items.json`) is checked into the repo — no generation step needed. To regenerate deterministically (fixed seed `0xc0ffee`): `npm run generate-data`. A small layout test harness is also available: `npm run test-layout`.

## Architecture at a glance

```
src/
├── lib/         # Pure logic — no React imports
├── hooks/       # React-coupled stateful logic
├── components/  # Rendering — consumes hooks
└── styles/      # Plain CSS, one file
```

The split is along the axis that matters at this scale: **pure logic / React-coupled logic / rendering**. Same boundaries that FSD or hexagonal architecture enforce, without the ceremony. The rules are simple and one-way: `lib/` imports nothing from `hooks/` or `components/`; components consume hooks rather than reimplementing logic. About a dozen source files in total — small enough that a heavier structure would obscure rather than clarify.

`CLAUDE.md` in this repo is the working contract I built against (non-goals, rules, and a decisions log that captures every tradeoff in one place). The decisions log is the primary artifact for the live walkthrough — every load-bearing line of code has a corresponding entry there.

## The five pillars

**1. Justified-row layout.** Greedy with a target row height (Flickr-style). I considered global DP (Knuth-Plass) for optimal line breaking but rejected it: optimality is irrelevant when we virtualize and only ~20 rows are visible at a time, and it wouldn't compose with progressive data. The column-count control maps to a *target row height*, not a strict per-row item count — justified layout is intrinsically fuzzy on counts, and pretending otherwise would lie to the user. The pure algorithm lives in `lib/justifiedLayout.ts`; the memoized React wrapper in `hooks/useJustifiedLayout.ts`.

**2. Virtualization.** `@tanstack/react-virtual` headless — we own the row layout math. Rejected `react-window` (fights variable-height rows that depend on our own layout output) and hand-rolling (reinvents scroll edge cases for no payoff). Row heights are *derivable* from the layout output, not measured from the rendered DOM, so I pass exact heights to the virtualizer via `estimateSize` rather than using its dynamic measurement API. Dynamic measurement would produce a one-frame layout shift on every newly-revealed row — exactly the jank I wanted to avoid. MediaItems are rendered as a flat list under `.feed-inner` (keyed by `item.id`, not by row) so a layout reshuffle that moves an item between rows doesn't unmount the underlying `<img>`.

**3. Scroll anchoring.** Anchor on the topmost row by item id, captured pre-layout, restored in `useLayoutEffect` (synchronous, before paint). The anchor row is the topmost row with `y >= scrollTop` — durable across cell shrinkage in a way that simpler rules (first row intersecting `scrollTop`) aren't. Restoration dispatches a synthetic `scroll` event after setting `scrollTop` so the virtualizer's cached offset updates inside the same commit cycle (without this, the next paint renders empty). Identity-based anchoring (not index-based) means the same hook would handle live-prepended items for free, if we ever add that.

**4. Media loading.** Native `loading="lazy"` is gone — the virtualizer already gates which items mount, and double-gating only adds a one-frame intersection delay before cached images paint. Videos use a Pexels-served thumbnail poster (so the paused cell looks like what the video will play), `preload="none"`, and a **3-concurrent playback cap** to bound CPU + decode pressure on mid-tier laptops. The playback manager picks the videos nearest viewport center and pauses everything else.

**5. Resize handling.** `ResizeObserver` + `useSyncExternalStore`. I went through a few less-correct iterations first: rAF-throttled `setState` (one-frame lag during drag — visible white band on the right edge), `flushSync` inside the observer (works but emits dev warnings when a layout change re-fires the observer mid-commit). `useSyncExternalStore` is the React-blessed primitive for this case: the observer is the change signal, `getSnapshot` reads `getBoundingClientRect().width` fresh on every render, and React handles consistency without entanglement.

## Stretch goals — S4 + S5 + S3

I shipped three from the brief: **S4 (right-sized media)**, **S5 (robust resize)**, and **S3 (animation-friendly cache)**. S4 and S5 are active implementations sharing a ~75-LOC surface in `lib/mediaUrl.ts`; S3 is a passive consequence of the first two combined with Picsum and Pexels' response headers, and is verified rather than implemented. Together they form one coherent theme: **the image loading pipeline is right-sized per cell (S4), stable under continuous resize (S5), and cache-respecting on virtualization remount (S3). All three contribute to the same user-visible property: smooth loading behavior under realistic interaction.**

**S4 — right-sized media.** The dataset bakes Picsum URLs at `/394/320`, which is fine at cols=6+ but produces visible upscaling blur at cols=2 where cells render at ~700px CSS (1400px raster on retina). `sizedMediaUrl(url, cellW, cellH, dpr)` rewrites the URL at render time: Picsum gets `/{w}/{h}` path rewrite, Pexels posters get `?w={w}` query param. Quantized to 100px buckets so small cell-size variations hit the same cache entry. Scope is images and video posters; video files themselves pass through (the playback cap bounds their bandwidth without URL-level sizing — see `CLAUDE.md` for the scope boundary). Verified at cols=2: every visible cell has `naturalSize / (cssSize × DPR) ≥ 1.00`, vs the < 0.5 ratio before the change.

**S5 — robust resize.** S4's verification surfaced a regression: a continuous resize drag walked each visible cell across 1–3 bucket boundaries, firing a fresh `<img src>` per crossing, each cancelling the previous in-flight fetch and producing a ~600ms loading flash per cell. Sticky-max-per-URL solves the dominant case: a module-level `Map<url, {w, h}>` records the highest bucket ever requested for each item; subsequent calls return at-or-above that bucket, never below. Verified at `/tmp/verify-stretch-s5.mjs`: window-resize drag in the shrink direction fires **zero** src changes; rapid bidirectional drag (1400⇄800 × 4 in ~1s) sustains 60fps with per-gap rAF ticks matching the budget. The boundary is honest: shrink is fully protected; grow still fetches when the cell legitimately needs more pixels.

**S3 — animation-friendly cache.** Not an explicit implementation but an engineered consequence. Picsum returns `Cache-Control: max-age=2592000, immutable` and Pexels' image CDN uses long-lived public caching. Combined with URL stability from sticky-max (S5 — same URL across resize cycles for items the user has already viewed) and URL stability from stable item IDs in the dataset (same Picsum seed → same URL forever), every cell that's been loaded once and scrolled away serves from disk cache on return — zero network bytes. Verified by hand: scroll to `scrollTop=15000`, scroll back, watch the Network panel; every entry shows `(disk cache)`. The boundary: the guarantee is "no network refetch," not "decoded pixels preserved." React unmount on virtualization releases the decoded pixels; remount re-decodes from cached bytes (~30–100ms). Eliminating *that* would require an off-DOM image cache or canvas-based rendering — same architectural class as the unmade grow-direction fix.

**Why these three, not S1.** I started planning S1 (smooth column-count transitions) for Loom impact, but testing at cols=2 exposed the upscale blur, and S4 became the higher-value pick — it addresses a visible correctness problem the brief explicitly grades, not a cosmetic transition. S5 emerged because the empirical evidence from S4's verification made it obvious that "right-sized media" without "right-sized media that doesn't churn on resize" was an incomplete answer. S3 came along once S4 + S5 + the dataset's URL stability were in place — the work was the verification, not the implementation, but the engineering decisions that produced it were deliberate (without sticky-max, S5's shrink-direction churn would fight the disk cache).

## What I'd do with 10 more hours

- **Close the grow-direction flash.** Documented in detail in `CLAUDE.md`'s decisions log. The flash hits when a cell legitimately needs more pixels (cell got bigger → new larger source needed → `<img>` clears its rasterization while the new source decodes). Two fixes attempted and rejected on empirical evidence: (1) CSS `background-image` on a `<div>` — Chrome does NOT atomic-swap the previously-decoded background when the URL changes and the element's dimensions change in the same frame (controlled same-node test: pre-grow image visible, t=20/50/200ms solid black, t=800ms new image); (2) layered `<img>` with the old at old pixel dims and the new at new pixel dims — mechanism works but the visual is a small image floating in a large black container during the load window (~6% image / 94% black at extreme grows), which reads as broken layout. The architectural path is canvas-based rendering with manual rasterization control.
- **Video right-sizing.** Currently scope-limited: Pexels' video CDN has discrete variants (`sd_640_360`, `hd_1280_720`) rather than on-demand resize, so closing the gap requires storing multiple URL variants per `VideoItem` and picking at render. The 3-concurrent cap bounds the cost — at most 3 HD streams at a time regardless of cell size.
- **S1 — smooth column-count transitions.** FLIP-based intra-row item motion would be the highest-Loom-impact polish. Composes cleanly with the existing scroll anchor (scroll anchor preserves vertical; FLIP adds intra-row motion on top).
- **Mobile + touch testing.** Currently only modern Chrome + Safari on desktop, per the brief's modern-browser scope. The justified layout already adapts on width; touch gestures and viewport-rotation handling are untested.
- **Tests for the layout algorithm.** One or two pure-function unit tests against `lib/justifiedLayout.ts` would cement the algorithm's contract. CLAUDE.md scoped these out within the 10–15h budget; with more time they'd land.
