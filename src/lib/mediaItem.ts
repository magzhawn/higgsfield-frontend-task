/**
 * The dataset's single source of truth. Two media kinds, discriminated by `kind`.
 *
 * `aspectRatio` is the only field the layout algorithm consumes — actual pixel
 * widths come from `aspectRatio * rowHeight` at render time, never from the dataset.
 */
export type MediaItem = ImageItem | VideoItem;

export type ImageItem = {
  kind: 'image';
  id: string;
  url: string;
  aspectRatio: number;
};

export type VideoItem = {
  kind: 'video';
  id: string;
  url: string;
  // Static poster shown by the <video> element until play(). Matches the
  // video's actual content (Pexels exposes a thumbnail per video at
  // images.pexels.com/videos/{id}/free-video-{id}.jpg), so the paused cell
  // looks like what the video will play. See Decisions log 2026-05-23 for
  // why we don't use preload="metadata" instead — it triggers a metadata
  // fetch per mounted <video>, saturating the per-origin connection pool.
  posterUrl: string;
  aspectRatio: number;
};

export const isImage = (item: MediaItem): item is ImageItem => item.kind === 'image';
export const isVideo = (item: MediaItem): item is VideoItem => item.kind === 'video';
