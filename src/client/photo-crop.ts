/**
 * Cropping the 履歴書's 写真 to 3:4 (issue #117), in the browser.
 *
 * The chosen image fills a 3:4 frame and is moved and zoomed under it; what
 * the frame shows is what is kept. The arithmetic is here, apart from the
 * screen, so it is tested without a canvas: jsdom has none, and the frame is
 * the only part that has to be right for the photo to be.
 *
 * Every position is in frame pixels: `offset` is how far the image's centre
 * sits from the frame's, and `zoom` 1 is the image just covering the frame.
 */
import { PHOTO_OUTPUT } from "~/shared/photo";

export interface Size {
  width: number;
  height: number;
}

export interface Crop {
  zoom: number;
  offset: { x: number; y: number };
}

/** Three times the covering size: past it, a phone photo's face is a few hundred pixels. */
export const MAX_ZOOM = 3;

export const INITIAL_CROP: Crop = { zoom: 1, offset: { x: 0, y: 0 } };

/** The scale at which the image just covers the frame, with nothing of the frame left empty. */
export const coverScale = (image: Size, frame: Size) => Math.max(frame.width / image.width, frame.height / image.height);

/** The image's drawn size in the frame at a zoom. */
export function drawnSize(image: Size, frame: Size, zoom: number): Size {
  const scale = coverScale(image, frame) * zoom;
  return { width: image.width * scale, height: image.height * scale };
}

/**
 * The crop held to what can be kept: a zoom between 1 and {@link MAX_ZOOM},
 * and an offset that leaves no part of the frame outside the image.
 */
export function clampCrop(image: Size, frame: Size, crop: Crop): Crop {
  const zoom = Math.min(MAX_ZOOM, Math.max(1, crop.zoom));
  const drawn = drawnSize(image, frame, zoom);
  const limitX = (drawn.width - frame.width) / 2;
  const limitY = (drawn.height - frame.height) / 2;
  const hold = (value: number, limit: number) => Math.min(limit, Math.max(-limit, value)) || 0;
  return { zoom, offset: { x: hold(crop.offset.x, limitX), y: hold(crop.offset.y, limitY) } };
}

/** The part of the image the frame shows, in the image's own pixels: what `drawImage` copies. */
export function sourceRect(image: Size, frame: Size, crop: Crop) {
  const { zoom, offset } = clampCrop(image, frame, crop);
  const scale = coverScale(image, frame) * zoom;
  const width = frame.width / scale;
  const height = frame.height / scale;
  const x = image.width / 2 - offset.x / scale - width / 2;
  const y = image.height / 2 - offset.y / scale - height / 2;
  return { x, y, width, height };
}

/**
 * The cropped photo, {@link PHOTO_OUTPUT} pixels, as a JPEG. Drawn from the
 * decoded image, so whatever the browser could open — HEIC on Safari, WebP —
 * is sent as a JPEG and nothing of the original file, its metadata included,
 * leaves the browser.
 */
export async function cropToJpeg(source: CanvasImageSource, image: Size, frame: Size, crop: Crop): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = PHOTO_OUTPUT.width;
  canvas.height = PHOTO_OUTPUT.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot draw the photo.");
  const rect = sourceRect(image, frame, crop);
  context.imageSmoothingQuality = "high";
  context.drawImage(source, rect.x, rect.y, rect.width, rect.height, 0, 0, canvas.width, canvas.height);
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("This browser cannot draw the photo."))), "image/jpeg", 0.92),
  );
}
