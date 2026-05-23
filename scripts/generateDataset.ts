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

// gtv-videos-bucket sample MP4s — all public, all 16:9. We reuse URLs across
// items; the playback manager cares about media element behavior, not file diversity.
const VIDEO_URLS = [
  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4',
  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4',
  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4',
  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4',
  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerMeltdowns.mp4',
  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4',
  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/SubaruOutbackOnStreetAndDirt.mp4',
  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4',
  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/VolkswagenGTIReview.mp4',
  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/WeAreGoingOnBullrun.mp4',
  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/WhatCarCanYouGetForAGrand.mp4',
];

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
        url: VIDEO_URLS[randInt(VIDEO_URLS.length)],
        posterUrl: picsumUrl(`${id}-poster`, aspectRatio),
        aspectRatio,
      });
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
