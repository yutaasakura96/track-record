/**
 * A PDF as text (`docs/03-technical-design.md` §5.1, #94), through `unpdf`, a
 * serverless build of PDF.js. Proved on workerd before it was built on
 * (`docs/06`, 2026-10-16).
 *
 * A PDF has no paragraphs: its line breaks are where the layout ran out of
 * width. **The rule, `pdf-1`**, turns the printed lines back into paragraphs,
 * and changing any of it is a new extractor version:
 *
 * 1. A page's text is read in content order. A line ends where PDF.js marks
 *    one, or where the next piece of text sits on another baseline. Runs of
 *    spaces and tabs become one space, and each line is trimmed.
 * 2. A paragraph ends at the end of a page, at a blank line, and where the gap
 *    to the next baseline is more than 1.5 times the larger font size of the
 *    two lines — wider than a line of the same paragraph sits.
 * 3. The lines of one paragraph are joined by one space, or by nothing where
 *    either side of the join is Japanese, or where the line ends in a hyphen,
 *    which is kept.
 * 4. Each paragraph is one line of the extracted text.
 *
 * So a sentence that wrapped is one line here, and a quote anchors to it as
 * the sentence reads, with a space where the printed line broke. A quote that
 * keeps the printed break is not verbatim and is discarded (`quote.ts`).
 */
import { extractTextItems, type StructuredTextItem } from "unpdf";
import { UnreadableDocument } from "./unreadable";

export const PDF_EXTRACTOR_VERSION = "pdf-1";

interface Line {
  text: string;
  y: number;
  size: number;
}

const JAPANESE = /[぀-ヿ㐀-䶿一-鿿豈-﫿＀-￯、。]/u;

export async function extractPdf(bytes: ArrayBuffer): Promise<string> {
  let pages: StructuredTextItem[][];
  try {
    pages = (await extractTextItems(new Uint8Array(bytes))).items;
  } catch {
    throw new UnreadableDocument("That PDF could not be read. It may be damaged or password-protected.");
  }

  const text = pages.flatMap((items) => paragraphsOf(linesOf(items))).join("\n");
  if (text.trim() === "") {
    // Checked here, before storage and before a model token is spent.
    throw new UnreadableDocument(
      "That PDF has no text to read. It looks like a scan, and a scan cannot be imported without its text.",
    );
  }
  return text;
}

/** Rule 1: one page's pieces of text as printed lines. */
export function linesOf(items: StructuredTextItem[]): Line[] {
  const lines: Line[] = [];
  let current: Line | null = null;
  for (const item of items) {
    if (current && Math.abs(item.y - current.y) > Math.max(item.fontSize, current.size) / 2) {
      lines.push(current);
      current = null;
    }
    current ??= { text: "", y: item.y, size: 0 };
    current.text += item.str;
    if (item.str.trim()) current.size = Math.max(current.size, item.fontSize);
    if (item.hasEOL) {
      lines.push(current);
      current = null;
    }
  }
  if (current) lines.push(current);
  return lines.map((line) => ({ ...line, text: line.text.replace(/[ \t]+/g, " ").trim() }));
}

/** Rules 2 to 4: one page's printed lines as paragraphs. */
export function paragraphsOf(lines: Line[]): string[] {
  const paragraphs: string[] = [];
  let current: string | null = null;
  let previous: Line | null = null;
  for (const line of lines) {
    if (line.text === "") {
      if (current !== null) paragraphs.push(current);
      current = null;
      previous = null;
      continue;
    }
    // Measured downwards: a line that starts higher up the page, as a second
    // column does, starts a paragraph.
    const gap = previous === null ? 0 : previous.y - line.y;
    const joins = current !== null && gap > 0 && gap <= 1.5 * Math.max(previous!.size, line.size);
    if (!joins) {
      if (current !== null) paragraphs.push(current);
      current = line.text;
    } else {
      current += separator(current!, line.text) + line.text;
    }
    previous = line;
  }
  if (current !== null) paragraphs.push(current);
  return paragraphs;
}

function separator(before: string, after: string) {
  if (before.endsWith("-")) return "";
  return JAPANESE.test(before.slice(-1)) || JAPANESE.test(after[0]!) ? "" : " ";
}
