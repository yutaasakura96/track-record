/**
 * Recordings on an interview entry.
 *
 * A recording is a link to one kept somewhere else (issue #74), of which only
 * the link is held and which is opened only when the author clicks it, or an
 * audio file uploaded here (#76), stored privately and played only by its
 * owner. These rules are read by the routes that save one and by the forms
 * that send one, so the browser refuses what the server would.
 *
 * A recording is the one thing the author can remove. What is left of one is a
 * line saying so and the day, which is the last shape below.
 */

export const LINK_MAX = 2_000;
export const LABEL_MAX = 200;

/** What a link reads as when the author gave it no label. */
export const UNLABELLED_LINK = "Recording kept elsewhere";

export const NOT_A_LINK = "That does not look like a link. It should start with https://";

/** A recording as it is read back, oldest first on its entry. */
export type Recording =
  | { id: string; kind: "link"; url: string; label: string }
  /**
   * `durationSeconds` is null when the browser could not read it before
   * uploading. `uploadedOn` is `YYYY-MM-DD`, the day in Japan.
   */
  | { id: string; kind: "upload"; fileName: string; byteSize: number; durationSeconds: number | null; uploadedOn: string }
  /** `removedOn` is `YYYY-MM-DD`, the day in Japan it was removed. */
  | { id: string; kind: "removed"; removedOn: string };

/**
 * Whether a piece of text is a link this app will keep and open: `http` or
 * `https`, with a host, and nothing else. `javascript:`, `data:`, `file:` and a
 * bare `example.com` are all refused, since the link becomes an `href`.
 */
export function isWebLink(text: string): boolean {
  if (!/^https?:\/\/\S+$/i.test(text)) return false;
  try {
    const { protocol, hostname } = new URL(text);
    return (protocol === "http:" || protocol === "https:") && hostname !== "";
  } catch {
    return false;
  }
}

/**
 * The largest file an upload takes: 90 MB, sent as the raw body of one request.
 * A request body over 100 MB is refused at Cloudflare's edge before the Worker
 * runs, on this account's plan; the margin is for however the edge counts a
 * megabyte (decision log, 2026-10-15).
 */
export const RECORDING_MAX_MB = 90;
export const RECORDING_MAX_BYTES = RECORDING_MAX_MB * 1024 * 1024;

export const FILE_NAME_MAX = 200;

/** The kinds an upload takes, as the sentence under `Upload audio` names them. */
export const AUDIO_KINDS = "MP3, M4A, AAC, WAV, FLAC or Ogg";

/** The file chooser's filter. The first bytes decide; this only narrows the list. */
export const AUDIO_ACCEPT =
  ".mp3,.m4a,.aac,.wav,.flac,.ogg,.oga,.opus,audio/mpeg,audio/mp4,audio/x-m4a,audio/aac,audio/wav,audio/x-wav,audio/flac,audio/ogg";

/** How many first bytes {@link audioTypeOf} reads. */
export const AUDIO_HEAD_BYTES = 12;

/** What the first bytes of an MP4 file may name it as, when it is audio. Not `M4V `, not `qt  `. */
const MP4_AUDIO_BRANDS = new Set(["M4A ", "M4B ", "mp41", "mp42", "isom", "iso2"]);

const ascii = (head: Uint8Array, from: number, to: number) => String.fromCharCode(...head.subarray(from, to));

/**
 * The type a file is stored and played as, read from its first bytes, or null
 * when it is not one of {@link AUDIO_KINDS}. The browser's claim is never
 * used: it is whatever the file's name says.
 *
 * It reads the container and not every track in it, so an M4A or Ogg file
 * holding a picture track as well passes (decision log, 2026-10-15).
 */
export function audioTypeOf(head: Uint8Array): string | null {
  if (head.length < AUDIO_HEAD_BYTES) return null;
  if (ascii(head, 0, 3) === "ID3") return "audio/mpeg";
  if (head[0] === 0xff) {
    // ADTS, the frame AAC is sent in, has a layer of 00; an MPEG audio frame never does.
    if ((head[1]! & 0xf6) === 0xf0) return "audio/aac";
    if ((head[1]! & 0xe0) === 0xe0 && (head[1]! & 0x06) !== 0) return "audio/mpeg";
    return null;
  }
  if (ascii(head, 4, 8) === "ftyp") return MP4_AUDIO_BRANDS.has(ascii(head, 8, 12)) ? "audio/mp4" : null;
  if (ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 12) === "WAVE") return "audio/wav";
  if (ascii(head, 0, 4) === "fLaC") return "audio/flac";
  if (ascii(head, 0, 4) === "OggS") return "audio/ogg";
  return null;
}

/** A size as a row and a refusal read it: `46 MB`, `3.2 MB`, `0.4 MB`. */
export function megabytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb < 10 ? mb.toFixed(1).replace(/\.0$/, "") : Math.round(mb)} MB`;
}

/** How long a recording plays, as its row reads it: `52 min`, `1 h 05 min`. Under a minute is `1 min`. */
export function playingTime(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`;
}

export const tooLarge = (name: string, bytes: number) =>
  `${name} is ${(bytes / (1024 * 1024)).toFixed(1)} MB. A recording can be at most ${RECORDING_MAX_MB} MB.`;

export const notAudio = (name: string, type?: string) =>
  `${name}${type ? `, ${type},` : ""} is not audio this app keeps. It takes ${AUDIO_KINDS}, up to ${RECORDING_MAX_MB} MB.`;

export const emptyFile = (name: string) => `${name} is empty. Choose the recording itself.`;

/**
 * A file's name as it is kept: the last part of any path, without control
 * characters, trimmed and cut to {@link FILE_NAME_MAX}. Empty when nothing is
 * left, which the route refuses.
 */
export function keptFileName(name: string): string {
  const last = name.split(/[\\/]/).pop() ?? "";
  // eslint-disable-next-line no-control-regex
  return last.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, FILE_NAME_MAX);
}
