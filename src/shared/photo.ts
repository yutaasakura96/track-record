/**
 * The 履歴書's 写真 (issue #117, review issue 8).
 *
 * One optional photo on the profile, cropped to 3:4 in the browser and placed
 * in the form's 写真 cell at the conventional 30 × 40 mm. These rules are read
 * by the route that stores it and by the form that crops and sends it, so the
 * browser refuses what the server would.
 *
 * The photo is the author's face: it is stored in `profiles.photo`, read only
 * by the 履歴書 and by its owner, never written to a log, and removable.
 */

/** The cell's photo, 30 mm wide and 40 mm tall: 3:4, width to height. */
export const PHOTO_ASPECT = { width: 3, height: 4 } as const;

/**
 * The size the browser crops to. At 30 × 40 mm that is about 500 dpi, past
 * what a print of the form shows, and a JPEG of it is a few hundred kilobytes.
 */
export const PHOTO_OUTPUT = { width: 600, height: 800 } as const;

/** The smallest stored photo: 300 × 400, about 250 dpi at the cell's size. */
export const PHOTO_MIN_WIDTH = 300;

/** The largest file the route takes, as the raw body of one request. */
export const PHOTO_MAX_MB = 2;
export const PHOTO_MAX_BYTES = PHOTO_MAX_MB * 1024 * 1024;

/** The kinds a photo is stored as. The first bytes decide; what the browser claims is never read. */
export type PhotoType = "image/jpeg" | "image/png";

/** The file chooser's filter. Any image the browser can draw is cropped and sent as a JPEG. */
export const PHOTO_ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif";

/**
 * What the review footer and the View screen say when the 写真 cell is empty,
 * in the words the owner chose (review Q1).
 */
export const PHOTO_NOTICE = "写真欄は空欄です。必要な場合はWordで貼付してください";

export interface PhotoInfo {
  type: PhotoType;
  width: number;
  height: number;
}

/**
 * A stored photo's kind and pixel size, read from its bytes, or null when it is
 * not a JPEG or PNG this can read the size of. Nothing past the header is
 * decoded.
 */
export function photoInfo(bytes: Uint8Array): PhotoInfo | null {
  return pngInfo(bytes) ?? jpegInfo(bytes);
}

/** Whether a width and height are 3:4, to within the pixel a crop rounds to. */
export const isPhotoAspect = (width: number, height: number) =>
  Math.abs(width * PHOTO_ASPECT.height - height * PHOTO_ASPECT.width) <= PHOTO_ASPECT.height;

export const NOT_A_PHOTO = "That file is not a JPEG or PNG image, so it was not kept.";
export const PHOTO_TOO_LARGE = `That photo is over ${PHOTO_MAX_MB} MB, so it was not kept.`;
export const PHOTO_NOT_CROPPED = "The photo is not cropped to 3:4, so it was not kept. Crop it and save again.";
export const PHOTO_TOO_SMALL = `The photo is under ${PHOTO_MIN_WIDTH} × ${(PHOTO_MIN_WIDTH / PHOTO_ASPECT.width) * PHOTO_ASPECT.height} pixels, too small to print sharply at 30 × 40 mm.`;

/** Why a photo is refused, or null when it is kept. */
export function photoRefusal(info: PhotoInfo | null): string | null {
  if (!info) return NOT_A_PHOTO;
  if (!isPhotoAspect(info.width, info.height)) return PHOTO_NOT_CROPPED;
  if (info.width < PHOTO_MIN_WIDTH) return PHOTO_TOO_SMALL;
  return null;
}

/* -------------------------------------------------------------- internals */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const u16 = (bytes: Uint8Array, at: number) => (bytes[at]! << 8) | bytes[at + 1]!;
const u32 = (bytes: Uint8Array, at: number) => u16(bytes, at) * 0x10000 + u16(bytes, at + 2);

/** The signature, then the IHDR chunk, which the format puts first. */
function pngInfo(bytes: Uint8Array): PhotoInfo | null {
  if (bytes.length < 24 || PNG_SIGNATURE.some((byte, i) => bytes[i] !== byte)) return null;
  if (String.fromCharCode(...bytes.subarray(12, 16)) !== "IHDR") return null;
  const width = u32(bytes, 16);
  const height = u32(bytes, 20);
  return width > 0 && height > 0 ? { type: "image/png", width, height } : null;
}

/**
 * The size from the first start-of-frame marker. Every SOF (C0–CF) carries it,
 * except C4, C8 and CC, which are tables and not frames.
 */
function jpegInfo(bytes: Uint8Array): PhotoInfo | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let at = 2;
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1]!;
    // Fill bytes, and the markers that carry no length.
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null;
    const length = u16(bytes, at + 2);
    if (length < 2) return null;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (at + 9 > bytes.length) return null;
      const height = u16(bytes, at + 5);
      const width = u16(bytes, at + 7);
      return width > 0 && height > 0 ? { type: "image/jpeg", width, height } : null;
    }
    at += 2 + length;
  }
  return null;
}
