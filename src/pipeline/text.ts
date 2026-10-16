/**
 * Turning an uploaded file into text (`docs/03-technical-design.md` §5.1).
 *
 * M1 needs `.md` and `.txt` only — the author's case studies are Markdown.
 * `.docx` is M2 and is parsed directly rather than through a library, because
 * paragraph boundaries are what line numbering is built on.
 */
import { ApiError, validationFailed } from "~/server/http/errors";
import { MAX_UPLOAD_BYTES, importMimeType, importRefusal } from "~/shared/import-file";

/**
 * Stamped onto every version alongside the text it produced.
 *
 * **A version is never re-extracted in place.** Fact quote offsets index into
 * `extracted_text`; a parser change that moved a boundary would point every
 * stored offset somewhere subtly wrong, and nothing would surface it because
 * the offsets still resolve to *some* text. A parser upgrade bumps this and
 * creates a NEW version.
 */
export const EXTRACTOR_VERSION = "plaintext-1";

export interface ExtractedUpload {
  mimeType: string;
  text: string;
  byteSize: number;
  wordCount: number;
}

export async function extractUpload(file: File): Promise<ExtractedUpload> {
  // Rejected before storage and before a single model token is spent. The
  // rule is shared with the import picker, which refuses the same file first.
  const refusal = importRefusal(file);
  if (refusal) throw validationFailed(refusal, ["file"]);
  const mimeType = importMimeType(file.name)!;

  const raw = await file.text();
  // Line endings are normalised ONCE, here, before anything indexes into the
  // text. Every offset and line number in the record is relative to this form.
  const text = raw.replace(/\r\n?/g, "\n");
  if (text.trim() === "") {
    throw validationFailed("That file is empty.", ["file"]);
  }

  return {
    mimeType,
    text,
    byteSize: file.size,
    wordCount: countWords(text),
  };
}

/**
 * Words for the label strip. Latin runs count as words; CJK counts by
 * character, because Japanese has no inter-word spaces and a space count would
 * report a 6,000-character 職務経歴書 as a handful of words.
 */
export function countWords(text: string): number {
  const cjk = text.match(/[぀-ヿ㐀-䶿一-鿿豈-﫿]/gu)?.length ?? 0;
  const latin = text.match(/[A-Za-z0-9][A-Za-z0-9'’\-]*/gu)?.length ?? 0;
  return cjk + latin;
}

export function assertNotOversized(size: number) {
  if (size > MAX_UPLOAD_BYTES) {
    throw new ApiError("validation_failed", "That file is larger than the 2 MB limit.", {
      fields: ["file"],
    });
  }
}
