/**
 * Right-size a media URL for the cell that will render it.
 *
 * The dataset stores concrete URLs at a baseline size (Picsum images at
 * /394/320, Pexels posters at native ~1280×720). At render time the cell
 * size is known — much larger than baseline at low column counts (cols=2 on
 * a wide viewport renders cells at 700+ CSS px, blurry from upscaling), and
 * smaller than native at high column counts (cols=8 renders cells at ~150px,
 * 8× more bytes than needed). This helper rewrites the URL to request the
 * size the cell actually needs.
 *
 * Provider-aware: Picsum sizes via path segments (/{w}/{h}), Pexels' image
 * CDN sizes via query params (?w=). A generic regex won't work — knowing
 * each provider's shape is the whole job.
 *
 * Width/height are CSS px; multiplied by DPR before quantization so retina
 * displays pull retina pixels. Quantization to BUCKET_PX maximizes HTTP cache
 * hits across small cell-size variations: a 412px cell and a 498px cell both
 * request 500px, hitting the same cache entry. Without bucketing, every
 * resize or column-count tick would churn the cache.
 *
 * Unknown URL shapes pass through unchanged — the helper is conservative
 * rather than mangle a URL it doesn't recognize.
 */

// Trade-off: smaller buckets = closer fit to actual cell size but more cache
// misses on resize. 100px CSS gives 5–6 distinct buckets across the cell-size
// range we produce (cols 2–10 on a 1200–1800px viewport, DPR 1–2). Each
// bucket is reused across the column-count slider's smooth range.
const BUCKET_PX = 100;

function quantize(px: number): number {
  // Round UP — undershooting bucket produces an under-resolution image; the
  // browser would then upscale and we'd have S4 right back. Floor of
  // BUCKET_PX prevents a degenerate /0/0 request when transient layout
  // state hands us a zero-sized cell.
  return Math.max(BUCKET_PX, Math.ceil(px / BUCKET_PX) * BUCKET_PX);
}

// Per-URL high-water mark of the (w, h) bucket ever requested for that URL.
// We never downsize: once an image has been loaded at bucket N, asking for
// a smaller bucket on the same URL is wasted bandwidth (cached source is
// already sufficient) AND puts the <img> into "loading" state for ~3 frames
// while the smaller request completes — the user sees the cell flash blank.
// During a continuous resize drag, cells cross multiple bucket boundaries;
// without the high-water mark a 1400→700 viewport drag fires 1–3 src
// changes per visible cell (verified empirically), so the user sees a
// stream of flicker frames across the feed. With the mark, the same drag
// fires zero src changes on the shrink direction. Grow direction still
// re-fetches when the cell legitimately needs more pixels — one-shot per
// item, not a drag-stream.
//
// Comparison is on width only. Width and height are correlated because the
// item's aspect ratio is fixed (a Picsum URL identifies a specific image at
// a specific AR; cell dimensions are `aspectRatio * rowHeight` × `rowHeight`,
// so as one shrinks the other shrinks proportionally). One axis is enough
// to detect "cell got smaller" — the other axis would always agree.
//
// Module-scope is a deliberate exception to the "lib/ is pure" convention
// (see CLAUDE.md §3). The cache has tab lifetime — same as the browser's
// HTTP cache, which is the right scope for what this is. No React state is
// needed because no one needs to *react* to changes in this map; it's a
// memo, read-on-call. ≤2000 entries (one per dataset item), CSR-only so no
// SSR concern. If the app grew to multiple independent feeds we'd lift to
// a React context; for a single feed the module scope keeps MediaItem's
// call site a one-liner and the caller can't tell sticky-max is in play.
const maxBucketBySrc = new Map<string, { w: number; h: number }>();

export function sizedMediaUrl(
  url: string,
  cellWidthCss: number,
  cellHeightCss: number,
  dpr: number,
): string {
  const wDesired = quantize(cellWidthCss * dpr);
  const hDesired = quantize(cellHeightCss * dpr);

  const prev = maxBucketBySrc.get(url);
  let w: number;
  let h: number;
  if (prev && prev.w >= wDesired) {
    // Sticky: prev source is at least as wide as we'd request now. Keep it.
    w = prev.w;
    h = prev.h;
  } else {
    // Grow direction (or first call): bucket up, record the new max.
    w = wDesired;
    h = hDesired;
    maxBucketBySrc.set(url, { w, h });
  }

  // Picsum: trailing /{w}/{h} on the path, no query string in our dataset.
  // Anchored to end-of-string so the regex never matches a numeric segment
  // earlier in the path (e.g., a hypothetical /v2/.../w/h).
  if (url.startsWith('https://picsum.photos/')) {
    return url.replace(/\/\d+\/\d+$/, `/${w}/${h}`);
  }

  // Pexels image CDN (used for video posters): no path-segment sizing, but
  // their CDN honors ?w= and serves a resized image preserving source aspect
  // ratio. We omit h= because the source's AR is what we render against (the
  // <video> object-fit:covers it into the cell anyway), and specifying both
  // can trigger crop behavior we don't want. auto=compress + cs=tinysrgb are
  // Pexels' standard "give me a small efficient JPEG" knobs.
  if (url.startsWith('https://images.pexels.com/videos/')) {
    return `${url}?auto=compress&cs=tinysrgb&w=${w}`;
  }

  return url;
}
