/**
 * Japanese text set into lines for a PDF (issue #117): the 職務経歴書 and the
 * story (`./japanese-pdf.ts`) and the 履歴書's cells (`./rirekisho-pdf.ts`).
 *
 * The résumé's PDF breaks only at spaces, which Japanese has none of. Here a
 * line may break between any two Japanese characters, as Word breaks them,
 * except where 禁則 forbids it: never before 、。」 and the small kana, never
 * after 「（. A run of Latin letters and digits is a word and is kept whole,
 * so `Kubernetes` and `2019年` are never split; a word wider than the line
 * is the one exception, broken where it must be.
 *
 * And the faces the Japanese PDFs embed, cut down to the glyphs each file draws
 * (`./font-subset.ts`). A character the face does not hold refuses the PDF by
 * name, as the résumé's does; the Word file still prints it.
 */
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, type PDFFont, type RGB } from "pdf-lib";
import { subsetFont } from "./font-subset";

/** A stretch of text in one style. */
export interface PdfRun {
  text: string;
  font: PDFFont;
  size: number;
  color: RGB;
  /** Drawn bold by stroking the outline as well as filling it, for a face that has no bold. */
  emboldened?: boolean;
}

/** Characters a line may not start with (行頭禁則), which travel with the one before. */
const NO_LINE_START = new Set(
  "、。，．・：；？！ー－）〕］｝〉》」』】〙〗ゝゞ々〻ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶ‐゠–〜～…‥),.:;?!]}%’”",
);
/** Characters a line may not end with (行末禁則), which travel with the one after. */
const NO_LINE_END = new Set("（〔［｛〈《「『【〘〖([{‘“");

const isSpace = (char: string) => /\s/u.test(char) || char === "　";
/** Japanese, or set in a Japanese face's full width: a line may break on either side of one. */
const isWide = (char: string) => {
  const code = char.codePointAt(0)!;
  return (code >= 0x2e80 && code <= 0x9fff) || (code >= 0xf900 && code <= 0xfaff) || (code >= 0xff00 && code <= 0xffef);
};

/** May a line break between `before` and `after`? */
function breaksBetween(before: string, after: string): boolean {
  if (isSpace(before) || isSpace(after)) return true;
  if (NO_LINE_START.has(after) || NO_LINE_END.has(before)) return false;
  return isWide(before) || isWide(after);
}

export const widthOf = (run: PdfRun) => run.font.widthOfTextAtSize(run.text, run.size);

/** Joins a piece to the line's last run when the style is the same, so a line is drawn in as few pieces as it has styles. */
function append(line: PdfRun[], piece: PdfRun) {
  const last = line[line.length - 1];
  const same = last && last.font === piece.font && last.size === piece.size && last.color === piece.color &&
    !last.emboldened === !piece.emboldened;
  if (same) last.text += piece.text;
  else line.push({ ...piece });
}

/** The text cut where a line may break: each piece is the runs it spans, and whether it is white space. */
function pieces(runs: PdfRun[]): { runs: PdfRun[]; space: boolean }[] {
  const out: { runs: PdfRun[]; space: boolean }[] = [];
  let previous = "";
  for (const run of runs) {
    for (const char of run.text) {
      // White space of any kind is set as one space, as Word shows a tab or a
      // line break inside a run's text.
      const shown = char === "　" ? char : isSpace(char) ? " " : char;
      const last = out[out.length - 1];
      if (last && previous && !breaksBetween(previous, char) && !last.space) append(last.runs, { ...run, text: shown });
      else out.push({ runs: [{ ...run, text: shown }], space: isSpace(char) && char !== "　" });
      previous = char;
    }
  }
  return out;
}

/**
 * Lines no wider than `width`, the first of them `firstWidth` wide where
 * something else (a right-aligned date) shares it. A space that does not fit
 * hangs past the margin and starts no line.
 */
export function breakLines(runs: PdfRun[], width: number, firstWidth = width): PdfRun[][] {
  const lines: PdfRun[][] = [[]];
  let used = 0;
  const room = () => (lines.length === 1 ? firstWidth : width);

  for (const piece of pieces(runs)) {
    const pieceWidth = piece.runs.reduce((sum, r) => sum + widthOf(r), 0);
    const line = lines[lines.length - 1]!;
    if (piece.space) {
      if (used === 0 && lines.length > 1) continue;
      if (used + pieceWidth <= room()) {
        piece.runs.forEach((r) => append(line, r));
        used += pieceWidth;
      }
      continue;
    }
    if (used + pieceWidth <= room()) {
      piece.runs.forEach((r) => append(line, r));
      used += pieceWidth;
      continue;
    }
    if (used > 0) {
      trimEnd(line);
      lines.push([]);
      used = 0;
      if (pieceWidth <= room()) {
        piece.runs.forEach((r) => append(lines[lines.length - 1]!, r));
        used = pieceWidth;
        continue;
      }
    }
    // Wider than a whole line: broken character by character.
    for (const run of piece.runs) {
      for (const char of run.text) {
        const glyph = { ...run, text: char };
        const w = widthOf(glyph);
        if (used + w > room() && used > 0) {
          lines.push([]);
          used = 0;
        }
        append(lines[lines.length - 1]!, glyph);
        used += w;
      }
    }
  }
  for (const line of lines) trimEnd(line);
  while (lines.length > 1 && lines[lines.length - 1]!.length === 0) lines.pop();
  return lines;
}

function trimEnd(line: PdfRun[]) {
  while (line.length > 0) {
    const last = line[line.length - 1]!;
    const trimmed = last.text.replace(/ +$/, "");
    if (trimmed) {
      last.text = trimmed;
      return;
    }
    line.pop();
  }
}

/** A PDF that cannot show one of its characters. The route answers it with the sentence. */
export class PdfGlyphError extends Error {}

/** A parsed face, kept for the life of the isolate: the bytes are a module and never change. */
const parsed = new WeakMap<ArrayBuffer, ReturnType<typeof fontkit.create>>();
const open = (bytes: ArrayBuffer) => {
  let font = parsed.get(bytes);
  if (!font) {
    font = fontkit.create(new Uint8Array(bytes));
    parsed.set(bytes, font);
  }
  return font;
};

/**
 * Refuses text a face cannot draw, naming the character and where it is.
 * White space is set as a space and is not checked.
 */
export function refuseMissing(face: ArrayBuffer, text: string, where: string) {
  const font = open(face);
  for (const char of text) {
    if (isSpace(char)) continue;
    const code = char.codePointAt(0)!;
    if (font.hasGlyphForCodePoint(code)) continue;
    const name = `U+${code.toString(16).toUpperCase().padStart(4, "0")}`;
    throw new PdfGlyphError(
      `The PDF cannot show “${char}” (${name}) in ${where}. Remove it, or download the Word file instead.`,
    );
  }
}

/** Embeds a face holding only the outlines of `text`'s characters. */
export async function embedFace(pdf: PDFDocument, face: ArrayBuffer, text: string): Promise<PDFFont> {
  return pdf.embedFont(subsetFont(face, open(face), text + " "), { subset: false });
}
