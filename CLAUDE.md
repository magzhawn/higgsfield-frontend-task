# CLAUDE.md

This is the working contract for building the Higgsfield AI frontend take-home. Re-read it at the start of each session. If a suggestion you're about to make contradicts something here, stop and flag it — don't quietly drift.

## 1. Project mission

A React + TypeScript media feed for Higgsfield AI: justified-row layout of mixed images and videos, virtualized to handle ~2k items smoothly, with a user-adjustable column count that preserves scroll position. Evaluators (frontend engineers at a media-heavy AI company) will read the README and the code, and will ask the candidate about any line in a live walkthrough. "Good" means: smooth at 2k items on a mid-tier laptop, every tradeoff is intentional and defensible, and the code is boring enough to explain cold.

Time budget: **10–15 hours total**. Feature count is not the grading axis — reasoning about tradeoffs is. We pick ONE stretch goal deliberately, late, for the Loom.

## 2. Non-goals — refuse or push back if asked

- State management libraries (Redux, Zustand, Jotai, Recoil). `useState` + `useReducer` cover this app.
- UI component libraries (shadcn, MUI, Chakra, Radix, Headless UI). Plain CSS only.
- Tailwind (or any utility-CSS framework). Whole UI lives in ~25 distinct CSS properties; the value of utility classes (scaling across a large surface) doesn't activate at this scope. Plain CSS in `src/styles/index.css`.
- Testing infrastructure beyond *at most* one or two pure-function unit tests for the layout algorithm. No Vitest config sprawl, no React Testing Library, no Playwright.
- Authentication, routing, SSR, server components, API layers. The dataset is a static JSON file.
- FSD, feature-folder, hexagonal, clean architecture, or any other generic structure. The pragmatic split below is deliberate for a ~25-file project.
- Premature abstractions: "pluggable layout strategy", "feed framework", generic media adapters, render-prop kitchen sinks. We have one feed, one layout, two media types.
- Empty folders, barrel/index re-export files, placeholder modules "for future use".
- Pixel-perfect styling, design polish, animations beyond the chosen stretch goal.
- Cross-browser support beyond modern Chrome + Safari. No IE, no legacy Firefox, no polyfills.
- `npm install`-ing new packages without explicit approval.

## 3. Architecture

```
src/
├── main.tsx                    # Entry
├── App.tsx                     # Root
├── components/                 # Rendering — no business logic
│   ├── MediaFeed.tsx           # Virtualizer + rows
│   ├── MediaRow.tsx            # One row
│   ├── MediaItem.tsx           # One image/video cell
│   ├── ColumnCountControl.tsx  # The slider
│   └── VideoPlayer.tsx         # Video cell (only if MediaItem grows)
├── hooks/                      # React-coupled stateful logic
│   ├── useJustifiedLayout.ts
│   ├── useContainerWidth.ts
│   ├── useScrollAnchor.ts
│   ├── useScrollVelocity.ts    # Only if S2 stretch is chosen
│   └── useVideoPlayback.ts
├── lib/                        # Pure logic — no React imports
│   ├── justifiedLayout.ts
│   └── mediaItem.ts            # Types + type guards
├── data/
│   └── items.json
└── styles/
    └── index.css
```

The split is along the axis that matters at this scale: **pure logic / React-coupled logic / rendering**. Same separation FSD or hexagonal enforce, without the ceremony.

### Rules — enforce ruthlessly

1. **`lib/` imports nothing from `hooks/`, `components/`, or React.** If you want to, the abstraction is wrong — move the React part into a hook that calls the pure function.
2. **`components/` consume hooks; they don't reimplement logic.** Component too long? Extract a hook, don't split the component.
3. **Import direction is one-way: `lib/` ← `hooks/` ← `components/`.** Never the reverse.
4. **One concern per file. Don't pre-split.** Split `MediaItem.tsx` into `VideoPlayer.tsx` only when the file actually gets unwieldy.
5. **Name by problem, not pattern.** `useJustifiedLayout` ✓. `useFeedLogic`, `useFeature`, `useHelpers` ✗.
6. **Don't pre-create.** If we never write the velocity hook, the file doesn't exist. No empty scaffolding.

### When to deviate

If one concept genuinely grows into 4–5 cohesive files (e.g., the video playback subsystem), promote it to `hooks/videoPlayback/` with an `index.ts`. Only when the flat layout actually hurts — not preemptively.

## 4. Code quality bar

**TypeScript**

- Types express intent. No `any`. No `as` assertions without a one-line comment justifying them.
- `type` for data shapes, discriminated unions, function signatures. `interface` for component props is fine.
- `MediaItem = Image | Video` with a discriminant field. Use type guards in `lib/mediaItem.ts`, not inline `'kind' in x` checks.

**React**

- Function components, hooks. No class components, no HOCs.
- `useMemo` / `useCallback` only where there's a measurable reason. Don't blanket-wrap. The justified-layout computation **is** one of those places; a button's onClick is not.
- `useLayoutEffect` only where the DOM read/write must happen before paint (scroll anchoring). Otherwise `useEffect`.
- We are CSR-only (no SSR, no server components per section 2). `useLayoutEffect` is used as-is; do not wrap it in `useIsomorphicLayoutEffect` or any equivalent SSR-safety helper. If you see warnings about it during build, that's a misconfiguration, not a reason to add a wrapper.
- Keys: stable item IDs from the dataset. Never array index for the feed items.

**Comments**

- Explain *why*, not *what*. Well-named identifiers handle the *what*.
- Annotate every non-obvious tradeoff: layout algorithm choice, anchor strategy, video concurrency cap, virtualizer overscan value, any magic number.
- No "added for X" or "used by Y" comments — they rot.

**Performance**

- Measure before optimizing past the obvious. Layout math is memoized. Row components are stable. That's the floor.
- If you reach for `React.memo`, justify it (referential stability of inputs is required, otherwise it's noise).

**Styling**

- Plain CSS in `src/styles/index.css`. Class names describe what an element IS, not how it looks — `.feed`, `.row`, `.item`, `.control`. Never `.flex-wrap-center` or `.mt-4`.
- Computed values (positions, sizes coming from the layout output) go in inline `style={}`. Everything else goes in CSS.
- No CSS-in-JS, no Tailwind, no UI libraries. If you'd reach for one, write the ~5 lines of CSS instead.

## 5. The five core pillars — pinned decisions

These are load-bearing. Don't drift mid-build.

### 1. Justified-row layout algorithm

- **Home:** `lib/justifiedLayout.ts` (pure) + `hooks/useJustifiedLayout.ts` (React wrapper with memoization)
- **Chose:** greedy with target row height (Flickr-style). Walk items, accumulate until aspect-ratio sum exceeds container/target, scale the row to fit.
- **Rejected:** global DP (Knuth-Plass). Optimal line-breaking is irrelevant when (a) we virtualize and only see ~20 rows, and (b) data may eventually be progressive. Greedy composes with both.
- **Column-count control** adjusts the *target row height*, not a strict column count. Justified layout is intrinsically fuzzy on counts — pretending otherwise lies to the user.
- **User-facing label vs. internal model:** the UI control is labeled "columns" and exposes an integer count to the user. Internally, this is translated to a target row height via `targetRowHeight = (containerWidth - (columns - 1) * gap) / columns`, which is then passed to the layout algorithm. The actual number of items per row will vary based on aspect ratios — that's the honest behavior of justified layout. Do not attempt to enforce a strict per-row item count.

### 2. Virtualization

- **Home:** `components/MediaFeed.tsx`, using `@tanstack/react-virtual`.
- **Chose:** headless virtualizer, we own the row layout math.
- **Rejected:** `react-window` (fights variable-height rows that depend on our own layout output), hand-rolled (reinvents scroll edge cases for no payoff).
- **Integration pattern:** row heights are *derivable* from the layout algorithm output, not *measurable* from rendered DOM. We pass exact heights to the virtualizer via `estimateSize` (returning the precomputed value for each row index). We do NOT use the virtualizer's dynamic measurement API (`measureElement` or equivalent). Dynamic measurement causes a one-frame layout shift on every newly-revealed row, which is exactly the jank we're trying to avoid. If a library example shows the dynamic pattern, that's a default for cases where heights aren't known ahead of time — it doesn't apply to us.

### 3. Scroll anchoring

- **Home:** `hooks/useScrollAnchor.ts`
- **Chose:** anchor on the topmost fully-visible item. If no item is fully visible (mid-scroll, item straddles the viewport top), fall back to the topmost partially-visible item and record its negative offset — i.e., how many pixels of that item are *above* the viewport's top edge. Capture {itemId, offsetFromViewportTop} before re-layout; in `useLayoutEffect`, find the item's new row position and set `scrollTop = newRowY - offsetFromViewportTop` before paint. Anchor by item identity (id), never by index, so the same hook also handles live-prepended items (stretch S6) without modification.
- **Rejected:** center-of-viewport anchor (more code, identical felt result), CSS `overflow-anchor` (insufficient control across virtualized re-layouts).

### 4. Media loading strategy

- **Home:** `components/MediaItem.tsx` (cell), `components/VideoPlayer.tsx` (video, when needed), `hooks/useVideoPlayback.ts` (concurrency manager)
- **Chose:** native `loading="lazy"` for images, IntersectionObserver overscan for both, video posters by default, autoplay only when stationary in viewport, **cap ~3 concurrent playing videos**, prefer items nearest viewport center.
- **Rejected:** aggressive prefetch (bandwidth waste, especially on cellular), play-all-videos-in-view (CPU + decode pressure on mid-tier laptops).

### 5. Resize handling

- **Home:** `hooks/useContainerWidth.ts`
- **Chose:** `ResizeObserver` on the container element, throttle the state update to `requestAnimationFrame`.
- **Rejected:** debounced `window.resize` (visible lag, doesn't catch container-only changes like sidebar toggles).

## 6. README orientation

The README is graded heavily. Whenever we make a non-trivial tradeoff during the build, **ask in chat: "should we note this for the README?"** Don't write the README incrementally inside CLAUDE.md — the Decisions log below feeds it at the end.

README skeleton (build at the very end):

1. What it is + how to run it
2. Architecture at a glance (the pure/hooks/components split)
3. The five pillars, one paragraph each — chose / rejected / why
4. The chosen stretch goal + why that one
5. What I would do with another 10 hours

## 7. Walkthrough preparedness

The candidate will be asked about *any line* of code live.

- **No code I can't explain.** If you suggest a clever pattern, explain it inline in a comment OR walk me through it in chat first.
- **Prefer boring, readable solutions** over clever ones unless the clever one has a clear, statable payoff.
- **If you reach for a library, justify it in chat** — why it beats the hand-rolled version *for this specific use*.
- If I sound uncertain about something we wrote, that's a flag to pause and walk through it — don't keep building on top of confusion.

## 8. Workflow conventions

- **Commits:** Conventional Commits — `feat:`, `fix:`, `perf:`, `refactor:`, `docs:`, `chore:`.
- **Branching:** single `main` branch, no PR ceremony.
- **Significant architectural changes:** suggest a commit point.
- **New packages:** ask before `npm install`. State what it gives us, what the alternative is, and what it costs in bundle size if relevant.
- **Dev server:** Vite. Don't restart it unless config changes; HMR is fine.
- **No scratch artifacts in commits:** no commented-out code, no `console.log`s, no `debugger` statements in committed files. Use `git stash` for temporary experiments. `// TODO` comments are allowed only when they reference something explicitly out of scope (e.g., a stretch goal we deliberately skipped), with a one-line justification on the same line. Exception: one-off scripts under `scripts/` (dataset generator, layout test harness) may use `console.log` for summaries and progress — they're tooling, not app code, and the output is the script's user-facing surface.
- **Dead code:** if a hook, util, or type is no longer imported anywhere, delete it the same commit. Don't leave it "in case." Section 2's "no scaffolding for future use" applies retroactively to abandoned code too.

## 9. Decisions log

Append entries here as we go. Format: `YYYY-MM-DD — decision — alternatives considered — why`. These feed directly into the README.

---

- **2026-05-23 — Pragmatic modular structure (pure/hooks/components).** Alternatives: FSD, feature-folder, hexagonal. Why: speculative generality for a ~25-file project; the three-axis split gives the same enforceable boundaries without the ceremony. See §3.
- **2026-05-23 — Vite + Tailwind + @tanstack/react-virtual + local React state.** Alternatives: CRA/Next; CSS Modules/styled-components; react-window/hand-rolled virtualizer; Redux/Zustand/Jotai. Why: minimal stack that fits the time budget and the CSR-only scope. See §2, §5 pillar 2.
- **2026-05-23 — Greedy justified layout with target row height.** Alternative: global DP (Knuth-Plass). Why: composes with virtualization and progressive data; optimality is irrelevant when only ~20 rows are visible. See §5 pillar 1.
- **2026-05-23 — Column-count control maps to target row height, not strict per-row count.** Alternative: enforce N items per row. Why: justified layout is intrinsically fuzzy on counts; enforcing it would lie to the user. See §5 pillar 1.
- **2026-05-23 — Scroll anchor by item identity, captured pre-layout, restored in `useLayoutEffect`.** Alternatives: center-of-viewport anchor, CSS `overflow-anchor`, index-based anchoring. Why: id-based handles re-layout and live-prepend (S6) with one mechanism; layout-effect runs before paint so the user sees no jump. See §5 pillar 3.
- **2026-05-23 — Precomputed row heights passed to virtualizer via `estimateSize`; no dynamic measurement.** Alternative: `measureElement`. Why: heights are derivable from layout output, so dynamic measurement only buys us a per-row layout-shift frame. See §5 pillar 2.
- **2026-05-23 — Video: poster-by-default, autoplay-when-stationary, ~3 concurrent cap, prefer viewport-center.** Alternatives: aggressive prefetch, play-all-in-view. Why: bandwidth and decode pressure on mid-tier laptops. See §5 pillar 4.
- **2026-05-23 — `ResizeObserver` + rAF-throttled width state.** Alternatives: debounced `window.resize`. Why: catches container-only changes (e.g., sidebar toggles) and avoids visible debounce lag. See §5 pillar 5.
- **2026-05-23 — One stretch goal, chosen late.** Alternative: attempt several. Why: time budget and grading axis (tradeoff reasoning over feature count); S1 is the leading candidate for Loom impact. See §1.
- **2026-05-23 — Tailwind v4 via `@tailwindcss/vite` plugin (no PostCSS, no `tailwind.config.js`).** Alternatives: v4 + PostCSS (slower, no benefit here); Tailwind v3 (more docs, more config). Why: official v4 default, fastest build, CSS-first config means one line in `index.css` and zero config files.
- **2026-05-23 — `@/*` path alias to `src/*`.** Alternative: relative imports only. Why: keeps deep imports readable (`@/lib/justifiedLayout` over `../../lib/justifiedLayout`); explicit in tsconfig + Vite resolve, so the wiring is visible to a reviewer.
- **2026-05-23 — Removed Tailwind; plain CSS instead (supersedes the earlier Tailwind decision).** Alternatives: keep Tailwind v4, CSS Modules, CSS-in-JS. Why: whole UI is ~25 CSS properties — utility classes don't earn their place at this surface area. Inlined Andy Bell's reset in `src/styles/index.css`; component styles named by what the element IS (`.feed`, `.row`, `.item`). Computed values (positions, sizes from layout output) stay in inline `style={}`. See §4 styling subsection.
- **2026-05-23 — `MediaItem` carries only `aspectRatio`, not `width`/`height`.** Alternative: store nominal `width`/`height` in the dataset alongside `aspectRatio`. Why: the only width that matters is `aspectRatio * rowHeight` at render time. A nominal width baked into the JSON is decorative and would never be the right number to request — keeping it in the type would imply it was load-bearing.
- **2026-05-23 — Dataset sources: Picsum (`/seed/{seed}/{w}/{h}`) for images and video posters; gtv-videos-bucket sample MP4s reused across video items.** Alternatives: Unsplash (API key + rate limits), Pexels (same), self-host (out of scope), unique video per item (no public source provides this). Why: both sources are public, zero-auth, and stable. Picsum's seeded endpoint means the same item id always resolves to the same image, so re-runs and reloads don't churn the visual. The 13 gtv sample MP4s repeat — the brief grades playback behavior, not asset variety, so this is honest.
- **2026-05-23 — Aspect-ratio distribution: 50% landscape (1.2–2.0), 30% portrait (0.5–0.9), 15% square-ish (0.9–1.2), 2.5% panorama (2.5–3.5), 2.5% tall portrait (0.3–0.5).** Alternative: uniform distribution, or skip the extremes. Why: the 5% extreme bucket exists *because* panoramas and tall portraits are the inputs that break naive greedy layout — we want them in the test set, not absent from it.
- **2026-05-23 — Deterministic generator (Mulberry32 PRNG, fixed seed `0xc0ffee`).** Alternative: `Math.random()`. Why: `items.json` is checked into git; with a fixed seed, regenerating only produces a diff if the *logic* changed (kinds, distribution, URLs). With `Math.random`, every regen would churn 2000 lines for no semantic reason. ~5 lines of arithmetic for diff-stability is a good trade.
- **2026-05-23 — `estimateSize` returns `row.height + (isLast ? 0 : gap)`, not `row.height + gap` unconditionally.** Alternative: unconditional `+ gap`. Why: prevents a trailing-gap dead zone at the bottom of the scroll surface. Per-row start positions are equal between both versions (by construction); only the total height differed.
- **2026-05-23 — Columns→targetRowHeight translation lives in MediaFeed, not App.** Alternative: lift containerWidth to App via a tuple-returning useContainerWidth, or compute in App from a separately-measured width. Why: containerWidth is owned by MediaFeed (via useContainerWidth on scrollRef); lifting the measurement up would either duplicate the observer or split scrollRef from its measured element. The translation is a layout-subsystem implementation detail, and keeping it next to useJustifiedLayout means the full conversion chain is visible in one file.
- **2026-05-23 — Anchor row selection: topmost row with y >= scrollTop.** Alternatives considered: (a) first row whose y range intersects scrollTop (anchored item slips above viewport when cells shrink); (b) original three-branch "topmost fully-visible / next / straddling" rule (requires viewport height, more code paths). Why: the chosen rule preserves anchor durability under cell shrinkage (the row's top edge stays at-or-below scrollTop, so the row moves within the viewport rather than out of it) without requiring viewport height. Verified across cols 5→3, 5→7, 5→2, 5→8, and viewport 1400→900 — all transitions preserve the topmost-visible item id within ±2 indices and the anchor item's screen position within sub-pixel drift.
- **2026-05-23 — Scroll anchor verified by anchor-item presence + sub-pixel position drift, not by "topmost-leftmost item index stability".** Alternative: the topmost-leftmost-item ±N metric. Why: in justified-row layout, the row-boundary indices shift by up to (max_columns - 1) when column count changes, even when the anchor item's screen position is preserved sub-pixel. The leftmost-item metric measures row-boundary stability, which is incidental to the user-perceived "I'm looking at the same thing" property the brief grades. Anchor-item presence + position drift is the precise correctness statement: across cols 5→3, 5→7, 5→2, 5→8 and viewport 1400→900, the captured item stays in viewport with ≤2px screen-position drift in all cases (measured: 0.01–0.5px).
