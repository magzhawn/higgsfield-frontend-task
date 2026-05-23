/**
 * One-off generator for the dataset behind the feed.
 *
 * Run via `npm run generate-data`. Output is checked into git as src/data/items.json.
 *
 * Determinism: a fixed-seed Mulberry32 PRNG drives every random choice so that
 * re-running the script with the same constants produces a byte-identical JSON
 * file. This keeps regeneration diffs honest — if items.json changes, *something*
 * about the generation logic changed.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MediaItem } from '../src/lib/mediaItem.ts';

// ---- Constants -------------------------------------------------------------

const TOTAL_ITEMS = 2000;
const IMAGE_FRACTION = 0.8; // 80/20 image/video — realistic feed mix
const SEED = 0xc0ffee;
const NOMINAL_HEIGHT_PX = 320; // baked into image URLs; modest over-fetch for typical row heights, no commitment to S4

// Pexels CDN serves these video-files URLs publicly without auth or a Referer
// header. The IDs were enumerated manually against `videos.pexels.com/video-files/{id}/`
// in May 2026 — they're stable and the responses include `cache-control` for
// CDN re-use. Earlier iterations of this dataset used Google's
// gtv-videos-bucket (now 403 anonymous) and test-videos.co.uk (3 visually-distinct
// Blender clips, which left the feed feeling like 3 looping subjects). Pexels
// gives 23 actually-different visual subjects (landscapes, people, animals,
// etc.); combined with the per-item `#t={N}` Media Fragment hash that seeks
// each <video> to a different second, the user-visible duplication rate drops
// to ~0 within any reasonable viewport.
const VIDEO_CLIPS = [
  'https://videos.pexels.com/video-files/853874/853874-hd_1280_720_25fps.mp4',
  'https://videos.pexels.com/video-files/854174/854174-hd_1280_720_25fps.mp4',
  'https://videos.pexels.com/video-files/854178/854178-hd_1280_720_25fps.mp4',
  'https://videos.pexels.com/video-files/854179/854179-hd_1280_720_25fps.mp4',
  'https://videos.pexels.com/video-files/854181/854181-hd_1280_720_25fps.mp4',
  'https://videos.pexels.com/video-files/855023/855023-hd_1280_720_25fps.mp4',
  'https://videos.pexels.com/video-files/855135/855135-hd_1280_720_24fps.mp4',
  'https://videos.pexels.com/video-files/855137/855137-hd_1280_720_24fps.mp4',
  'https://videos.pexels.com/video-files/855196/855196-hd_1280_720_25fps.mp4',
  'https://videos.pexels.com/video-files/855296/855296-hd_1280_720_25fps.mp4',
  'https://videos.pexels.com/video-files/856930/856930-hd_1280_720_25fps.mp4',
  'https://videos.pexels.com/video-files/856974/856974-hd_1280_720_30fps.mp4',
  'https://videos.pexels.com/video-files/856987/856987-hd_1280_720_24fps.mp4',
  'https://videos.pexels.com/video-files/856993/856993-hd_1280_720_30fps.mp4',
  'https://videos.pexels.com/video-files/856994/856994-hd_1280_720_24fps.mp4',
  'https://videos.pexels.com/video-files/856996/856996-hd_1280_720_24fps.mp4',
  'https://videos.pexels.com/video-files/857130/857130-hd_1280_720_24fps.mp4',
  'https://videos.pexels.com/video-files/1093661/1093661-hd_1280_720_30fps.mp4',
  'https://videos.pexels.com/video-files/1409899/1409899-hd_1280_720_25fps.mp4',
  'https://videos.pexels.com/video-files/1739010/1739010-sd_640_360_30fps.mp4',
  'https://videos.pexels.com/video-files/2098989/2098989-hd_1280_720_30fps.mp4',
  'https://videos.pexels.com/video-files/5752729/5752729-hd_1280_720_30fps.mp4',
  'https://videos.pexels.com/video-files/7565460/7565460-hd_1280_720_25fps.mp4',
];

// 10 starting offsets across each clip. 23 clips × 10 offsets = 230
// visually-distinct variants. The variant array is ordered clip-major
// (transpose the obvious clips.flatMap(starts.map) order) so that consecutive
// round-robin assignments — `VARIANTS[cursor]`, `VARIANTS[cursor+1]`, … —
// step through DIFFERENT clips, not different timestamps of the same clip.
// The naive nesting would put 10 cells of clip[0]#t=0..9 before any clip[1]
// cell, making the first viewport's videos all the same Pexels source.
const VIDEO_VARIANT_STARTS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

const VIDEO_VARIANTS: ReadonlyArray<string> = VIDEO_VARIANT_STARTS.flatMap((t) =>
  VIDEO_CLIPS.map((url) => `${url}#t=${t}`),
);

// Aspect-ratio distribution, per the brief. Weights are probabilities, must sum to 1.
// Extremes (~5%) are included on purpose — panoramas and tall portraits are the
// inputs that break naive layout algorithms; we want them in the test set.
const ASPECT_BUCKETS: ReadonlyArray<{ weight: number; min: number; max: number }> = [
  { weight: 0.5, min: 1.2, max: 2.0 }, // landscape
  { weight: 0.3, min: 0.5, max: 0.9 }, // portrait
  { weight: 0.15, min: 0.9, max: 1.2 }, // square-ish
  { weight: 0.025, min: 2.5, max: 3.5 }, // panorama (half of the 5% extreme bucket)
  { weight: 0.025, min: 0.3, max: 0.5 }, // tall portrait
];

// ---- Deterministic PRNG (Mulberry32) ---------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(SEED);
const randInRange = (min: number, max: number) => min + (max - min) * rand();
const randInt = (maxExclusive: number) => Math.floor(rand() * maxExclusive);

// ---- Aspect ratio sampling -------------------------------------------------

function pickAspectRatio(): number {
  const r = rand();
  let acc = 0;
  for (const bucket of ASPECT_BUCKETS) {
    acc += bucket.weight;
    if (r < acc) return round2(randInRange(bucket.min, bucket.max));
  }
  // Rounding-error fallback: tail bucket
  const last = ASPECT_BUCKETS[ASPECT_BUCKETS.length - 1];
  return round2(randInRange(last.min, last.max));
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// ---- Kind assignment -------------------------------------------------------

// Build a kind array sized to the exact 80/20 split, then shuffle so videos
// interleave naturally instead of clumping at the end of the list. Fisher–Yates
// using our seeded PRNG keeps this deterministic.
function makeKinds(total: number, imageFraction: number): Array<'image' | 'video'> {
  const imageCount = Math.round(total * imageFraction);
  const kinds: Array<'image' | 'video'> = [
    ...Array<'image'>(imageCount).fill('image'),
    ...Array<'video'>(total - imageCount).fill('video'),
  ];
  for (let i = kinds.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [kinds[i], kinds[j]] = [kinds[j], kinds[i]];
  }
  return kinds;
}

// ---- URL helpers -----------------------------------------------------------

// Picsum's /seed/{seed}/{w}/{h} returns a stable image for the same seed — so
// regenerating the dataset with the same SEED yields the same images.
function picsumUrl(seed: string, aspectRatio: number): string {
  const h = NOMINAL_HEIGHT_PX;
  const w = Math.round(aspectRatio * h);
  return `https://picsum.photos/seed/${seed}/${w}/${h}`;
}

// ---- Generation ------------------------------------------------------------

function generate(): MediaItem[] {
  const kinds = makeKinds(TOTAL_ITEMS, IMAGE_FRACTION);
  const items: MediaItem[] = [];
  // Round-robin cursor for video variant assignment. Stepping the cursor
  // only on video items (not all items) spreads the 30 variants evenly
  // across the 400 video items in the dataset, so adjacent video items in
  // the kinds array land on different variants. Combined with the random
  // image/video interleave from makeKinds(), any reasonable viewport shows
  // a different variant per video.
  let videoCursor = 0;

  for (let i = 0; i < TOTAL_ITEMS; i++) {
    const id = `item-${String(i + 1).padStart(4, '0')}`;
    const aspectRatio = pickAspectRatio();
    const kind = kinds[i];

    if (kind === 'image') {
      items.push({ kind: 'image', id, url: picsumUrl(id, aspectRatio), aspectRatio });
    } else {
      items.push({
        kind: 'video',
        id,
        url: VIDEO_VARIANTS[videoCursor % VIDEO_VARIANTS.length],
        aspectRatio,
      });
      videoCursor++;
    }
  }

  return items;
}

// ---- Write -----------------------------------------------------------------

function main(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const outPath = resolve(here, '..', 'src', 'data', 'items.json');

  const items = generate();

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(items, null, 2) + '\n', 'utf8');

  const counts = items.reduce(
    (acc, it) => ({ ...acc, [it.kind]: (acc[it.kind] ?? 0) + 1 }),
    {} as Record<string, number>,
  );

  console.log(`wrote ${items.length} items to ${outPath}`);
  console.log(`  kinds: ${JSON.stringify(counts)}`);
  console.log(`  first: ${items[0].id} (${items[0].kind}, ar=${items[0].aspectRatio})`);
  console.log(`  last:  ${items[items.length - 1].id} (${items[items.length - 1].kind}, ar=${items[items.length - 1].aspectRatio})`);
}

main();
