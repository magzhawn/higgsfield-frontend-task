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
  posterUrl: string;
  aspectRatio: number;
};

export const isImage = (item: MediaItem): item is ImageItem => item.kind === 'image';
export const isVideo = (item: MediaItem): item is VideoItem => item.kind === 'video';
