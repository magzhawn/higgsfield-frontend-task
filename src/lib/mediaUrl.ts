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

export function sizedMediaUrl(
  url: string,
  cellWidthCss: number,
  cellHeightCss: number,
  dpr: number,
): string {
  const w = quantize(cellWidthCss * dpr);
  const h = quantize(cellHeightCss * dpr);

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
