/**
 * Turning an uploaded file into text (`docs/03-technical-design.md` §5.1).
 *
 * Markdown and plain text are read as they are. A Word `.docx` is walked
 * paragraph by paragraph (`docx.ts`) and a PDF has its printed lines joined
 * back into paragraphs (`pdf.ts`), because paragraph boundaries are what line
 * numbering is built on.
 */
import { validationFailed } from "~/server/http/errors";
import { importFormat, importRefusal, type ImportFormat } from "~/shared/import-file";
import { DOCX_EXTRACTOR_VERSION, extractDocx } from "./docx";
import { PDF_EXTRACTOR_VERSION, extractPdf } from "./pdf";
import { UnreadableDocument } from "./unreadable";

/**
 * Stamped onto every version alongside the text it produced, one per format.
 *
 * **A version is never re-extracted in place.** Fact quote offsets index into
 * `extracted_text`; a parser change that moved a boundary would point every
 * stored offset somewhere subtly wrong, and nothing would surface it because
 * the offsets still resolve to *some* text. A parser upgrade bumps its version
 * and creates a NEW version.
 */
export const EXTRACTOR_VERSION = "plaintext-1";

export interface ExtractedUpload {
  mimeType: string;
  text: string;
  extractorVersion: string;
  byteSize: number;
  wordCount: number;
}

/** How each format becomes text, and the version that names the rule. */
const EXTRACTORS: Record<ImportFormat["name"], { version: string; read: (file: File) => Promise<string> }> = {
  Markdown: { version: EXTRACTOR_VERSION, read: (file) => file.text() },
  "plain text": { version: EXTRACTOR_VERSION, read: (file) => file.text() },
  Word: { version: DOCX_EXTRACTOR_VERSION, read: async (file) => extractDocx(await file.arrayBuffer()) },
  PDF: { version: PDF_EXTRACTOR_VERSION, read: async (file) => extractPdf(await file.arrayBuffer()) },
};

export async function extractUpload(file: File): Promise<ExtractedUpload> {
  // Rejected before storage and before a single model token is spent. The
  // rule is shared with the import picker, which refuses the same file first.
  const refusal = importRefusal(file);
  if (refusal) throw validationFailed(refusal, ["file"]);
  const { name, mimeType } = importFormat(file.name)!;
  const extractor = EXTRACTORS[name];

  let raw: string;
  try {
    raw = await extractor.read(file);
  } catch (err) {
    if (err instanceof UnreadableDocument) throw validationFailed(err.message, ["file"]);
    throw err;
  }
  // Line endings are normalised ONCE, here, before anything indexes into the
  // text. Every offset and line number in the record is relative to this form.
  const text = raw.replace(/\r\n?/g, "\n");
  if (text.trim() === "") {
    throw validationFailed("That file is empty.", ["file"]);
  }

  return {
    mimeType,
    text,
    extractorVersion: extractor.version,
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
  const cjk = text.match(/[぀-ヿ㐀-䶿一-鿿豈-﫿]/gu)?.length ?? 0;
  const latin = text.match(/[A-Za-z0-9][A-Za-z0-9'’\-]*/gu)?.length ?? 0;
  return cjk + latin;
}
