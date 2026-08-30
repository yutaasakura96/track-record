/**
 * Steps 3 and 4 of the import pipeline (`docs/03-technical-design.md` §5).
 *
 * Chunks are sized for PROGRESS REPORTING, not for context limits — the model's
 * window is not the constraint here; a visible progress bar is.
 *
 * On a re-import, unchanged passages are never re-sent to the model. That one
 * pass answers all three clauses of the re-import requirement at once: accepted
 * facts are not duplicated, only genuinely new content is extracted, and
 * rejected facts stay rejected — without the application ever reasoning about
 * fact identity.
 */
import { diffLines } from "diff";

/** Aim for chunks around this size; paragraph boundaries win over the target. */
const TARGET_CHUNK_CHARS = 2400;

export interface Region {
  start: number;
  /** Exclusive. */
  end: number;
}

export interface ChunkPlan {
  chunks: Region[];
  /** `null` on a first import — there is nothing to have changed from. */
  changedRegionShare: number | null;
}

/**
 * The regions of `text` that are new or changed relative to `previousText`.
 * Whole-document on a first import.
 */
export function changedRegions(text: string, previousText: string | null): Region[] {
  if (previousText === null) return text.length > 0 ? [{ start: 0, end: text.length }] : [];

  const regions: Region[] = [];
  let offset = 0;
  for (const part of diffLines(previousText, text)) {
    if (part.removed) continue; // removed text is not in `text` and has no offset here
    const end = offset + part.value.length;
    if (part.added) regions.push({ start: offset, end });
    offset = end;
  }
  return merge(regions);
}

/**
 * Split changed regions into chunks on paragraph boundaries, falling back to
 * line boundaries and finally to a hard cut, so a single enormous paragraph
 * still makes progress rather than becoming one opaque chunk.
 */
export function planChunks(text: string, previousText: string | null): ChunkPlan {
  const regions = changedRegions(text, previousText);
  const chunks: Region[] = [];

  for (const region of regions) {
    let cursor = region.start;
    while (cursor < region.end) {
      const limit = Math.min(cursor + TARGET_CHUNK_CHARS, region.end);
      const cut = limit === region.end ? region.end : boundaryBefore(text, cursor, limit);
      chunks.push({ start: cursor, end: cut });
      cursor = cut;
    }
  }

  const changedChars = regions.reduce((sum, r) => sum + (r.end - r.start), 0);
  return {
    chunks: chunks.filter((c) => text.slice(c.start, c.end).trim() !== ""),
    changedRegionShare:
      previousText === null ? null : text.length === 0 ? 0 : changedChars / text.length,
  };
}

function boundaryBefore(text: string, from: number, limit: number): number {
  const window = text.slice(from, limit);
  const paragraph = window.lastIndexOf("\n\n");
  if (paragraph > 0) return from + paragraph + 2;
  const line = window.lastIndexOf("\n");
  if (line > 0) return from + line + 1;
  return limit;
}

function merge(regions: Region[]): Region[] {
  const sorted = [...regions].sort((a, b) => a.start - b.start);
  const out: Region[] = [];
  for (const region of sorted) {
    const last = out[out.length - 1];
    if (last && region.start <= last.end) last.end = Math.max(last.end, region.end);
    else out.push({ ...region });
  }
  return out;
}
