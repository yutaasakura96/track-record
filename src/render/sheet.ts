/**
 * A filled 履歴書 as its file lays it out (issue #106 follow-up).
 *
 * The screen shows a 履歴書 "as it will print", and the only thing that knows
 * how it prints is the filled template. So the page is read back out of the
 * `.docx` bytes a download hands over: its lines and its tables, cell by cell,
 * with the spans and the merged 写真 cell where the file has them. A field the
 * template gains, a row it splits or a heading it respaces reaches the screen
 * with no change here, and a sent copy stored before any of this is read from
 * its own stored file.
 *
 * Only what the template uses is read: top-level paragraphs and tables of
 * paragraphs, each cell's fill, each paragraph's alignment, and its runs' size
 * and weight. It is
 * not a general `.docx` reader — `src/pipeline/docx.ts` is the one for files
 * the author brings, and this borrows its tokenizer and nothing else.
 */
import PizZip from "pizzip";
import { decode, TOKEN } from "~/pipeline/docx";

export type SheetAlign = "start" | "center" | "end";
/** A run's size, bucketed: the title, the name, the body, and the small ふりがな labels. */
export type SheetSize = "title" | "large" | "body" | "small";

export interface SheetLine {
  /** `\n` where the file breaks a line inside the paragraph. */
  text: string;
  align: SheetAlign;
  size: SheetSize;
  bold: boolean;
}

export interface SheetCell {
  lines: SheetLine[];
  colSpan: number;
  rowSpan: number;
  /** The file fills the cell, as it greys the 年 / 月 headings, 学歴 / 職歴 and the 写真 cell. */
  shaded: boolean;
}

export type SheetBlock =
  | { kind: "line"; line: SheetLine }
  /** `columns` are the grid's widths as fractions of the table, summing to 1. */
  | { kind: "table"; columns: number[]; rows: SheetCell[][] };

export interface Sheet {
  blocks: SheetBlock[];
}

/** Never read: a tracked deletion, the old side of a move, a field code, a text box's fallback copy. */
const SKIPPED = new Set(["mc:Fallback", "w:del", "w:delText", "w:instrText", "w:moveFrom"]);

/** Half-points. The template sets its title at 24pt, the name at 16pt, ふりがな at 9pt and the rest at 10–11pt. */
const sizeOf = (halfPoints: number | null): SheetSize =>
  halfPoints === null ? "body" : halfPoints >= 40 ? "title" : halfPoints >= 28 ? "large" : halfPoints <= 18 ? "small" : "body";

const attribute = (attributes: string, name: string) =>
  new RegExp(`\\bw:${name}\\s*=\\s*["']([^"']*)["']`).exec(attributes)?.[1];

interface OpenCell {
  lines: SheetLine[];
  colSpan: number;
  shaded: boolean;
  /** `restart` begins a vertical merge; `continue` is a cell the one above covers. */
  merge: "restart" | "continue" | null;
}

interface OpenTable {
  widths: number[];
  rows: OpenCell[][];
}

/** The sheet of a `.docx` the 履歴書 template produced. */
export function readSheet(bytes: Uint8Array | ArrayBuffer): Sheet {
  const part = new PizZip(bytes).file("word/document.xml");
  if (!part) throw new Error("no document part");
  return sheetOf(part.asText());
}

export function sheetOf(xml: string): Sheet {
  const blocks: SheetBlock[] = [];
  let table: OpenTable | null = null;
  let cell: OpenCell | null = null;
  let paragraph: { text: string; align: SheetAlign; sizes: number[]; bold: boolean } | null = null;
  /** Inside `w:pPr` (paragraph properties) or a run's `w:rPr` (run properties). */
  let inParagraphProperties = false;
  let run: { size: number | null; bold: boolean; written: boolean } | null = null;
  let inRunProperties = false;
  let inText = false;
  const skipped: string[] = [];

  for (const match of xml.matchAll(TOKEN)) {
    const [, closing, prefix = "", name, attributes = "", selfClosing, cdata, chars] = match;
    if (chars !== undefined || cdata !== undefined) {
      if (inText && !skipped.length && paragraph && run) {
        paragraph.text += cdata ?? decode(chars!);
        run.written = true;
      }
      continue;
    }
    if (name === undefined) continue;
    const tag = prefix + name;

    if (SKIPPED.has(tag)) {
      if (selfClosing) continue;
      if (closing) skipped.pop();
      else skipped.push(tag);
      continue;
    }
    if (skipped.length) continue;

    switch (tag) {
      case "w:tbl":
        if (closing) {
          if (table) blocks.push(closedTable(table));
          table = null;
        } else table = { widths: [], rows: [] };
        continue;
      case "w:gridCol":
        table?.widths.push(Number(attribute(attributes, "w") ?? 0));
        continue;
      case "w:tr":
        if (!closing && table) table.rows.push([]);
        continue;
      case "w:tc":
        if (closing) {
          if (cell && table) table.rows[table.rows.length - 1]?.push(cell);
          cell = null;
        } else cell = { lines: [], colSpan: 1, shaded: false, merge: null };
        continue;
      case "w:gridSpan":
        if (cell) cell.colSpan = Math.max(1, Number(attribute(attributes, "val") ?? 1));
        continue;
      case "w:shd": {
        // Only a cell's own fill: a paragraph or a run can be shaded too, and none in the template is.
        const fill = attribute(attributes, "fill")?.toLowerCase();
        if (cell && !paragraph) cell.shaded = fill !== undefined && fill !== "auto" && fill !== "ffffff";
        continue;
      }
      case "w:vMerge":
        if (cell) cell.merge = attribute(attributes, "val") === "restart" ? "restart" : "continue";
        continue;
      case "w:p":
        if (closing || selfClosing) {
          const line: SheetLine = paragraph
            ? {
                text: paragraph.text,
                align: paragraph.align,
                size: sizeOf(paragraph.sizes.length ? Math.max(...paragraph.sizes) : null),
                bold: paragraph.bold,
              }
            : { text: "", align: "start", size: "body", bold: false };
          if (cell) cell.lines.push(line);
          else blocks.push({ kind: "line", line });
          paragraph = null;
        } else paragraph = { text: "", align: "start", sizes: [], bold: false };
        continue;
      case "w:pPr":
        if (!selfClosing) inParagraphProperties = !closing;
        continue;
      case "w:jc":
        if (paragraph && inParagraphProperties && !run) {
          const value = attribute(attributes, "val");
          paragraph.align = value === "center" ? "center" : value === "right" || value === "end" ? "end" : "start";
        }
        continue;
      case "w:r":
        if (closing) {
          // A run's size and weight count only where it put text on the page.
          if (run?.written && paragraph) {
            if (run.size !== null) paragraph.sizes.push(run.size);
            if (run.bold) paragraph.bold = true;
          }
          run = null;
        } else if (!selfClosing) run = { size: null, bold: false, written: false };
        continue;
      case "w:rPr":
        if (!selfClosing) inRunProperties = !closing;
        continue;
      case "w:sz":
        if (run && inRunProperties) run.size = Number(attribute(attributes, "val") ?? 0) || null;
        continue;
      case "w:b": {
        const value = attribute(attributes, "val");
        if (run && inRunProperties) run.bold = value !== "0" && value !== "false";
        continue;
      }
      case "w:t":
        inText = !closing && !selfClosing;
        continue;
      case "w:tab":
        if (run && paragraph && !inParagraphProperties && !closing) paragraph.text += "\t";
        continue;
      case "w:br":
      case "w:cr":
        if (run && paragraph && !closing && !/^(page|column)$/.test(attribute(attributes, "type") ?? "")) {
          paragraph.text += "\n";
        }
        continue;
    }
  }
  return { blocks };
}

/**
 * The table with its vertical merges folded: a `continue` cell is dropped and
 * the cell above it, in the same grid column, spans one row further.
 */
function closedTable(table: OpenTable): SheetBlock {
  const total = table.widths.reduce((sum, width) => sum + width, 0);
  const columns = table.widths.map((width) => (total > 0 ? width / total : 1 / table.widths.length));
  /** The cell that currently owns each grid column, for merges to extend. */
  const owner: (SheetCell | undefined)[] = [];
  const rows = table.rows.map((row) => {
    const out: SheetCell[] = [];
    let column = 0;
    for (const open of row) {
      if (open.merge === "continue" && owner[column]) {
        owner[column]!.rowSpan += 1;
      } else {
        const cell: SheetCell = { lines: open.lines, colSpan: open.colSpan, rowSpan: 1, shaded: open.shaded };
        out.push(cell);
        for (let at = column; at < column + open.colSpan; at++) owner[at] = cell;
      }
      column += open.colSpan;
    }
    return out;
  });
  return { kind: "table", columns, rows };
}
