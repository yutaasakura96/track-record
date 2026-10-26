/**
 * The 履歴書's PDF (issue #117, review S7), drawn from the very `.docx` its
 * download hands over.
 *
 * The 履歴書 is a form filled cell by cell (`./rirekisho-template.ts`) and laid
 * out on two fixed pages (`./rirekisho-layout.ts`), so its PDF is not built
 * from the content the way the 職務経歴書's is: it is the filled file, drawn.
 * Each top-level paragraph and table is read out of `word/document.xml` — the
 * grid, each row's height rule, each cell's span, vertical merge, borders,
 * fill and vertical alignment, each paragraph's alignment, spacing and exact
 * line height, each run's size, weight and face, and a picture where the 写真
 * cell holds one — and put on the page as Word puts it: a row that does not
 * fit starts the next page, and a table continuing onto it repeats its 年 / 月
 * header row first. What the in-app view shows is read out of the same file
 * (`./sheet.ts`), so the screen, the Word file and the PDF are one form.
 *
 * The faces are the ones the template names, as their free counterparts:
 * BIZ UDMincho for MS Mincho and BIZ UDPGothic for MS Gothic. BIZ UDMincho is
 * fixed-pitch as MS Mincho is — a full-width character one em, a half-width
 * one half — so a cell wraps where the layout model counts it wrapping. The
 * template sets the name in bold Mincho, which has no bold face here; it is
 * drawn bold by stroking the outline too, as Word emboldens a face that has
 * no bold.
 *
 * It is not a general `.docx` renderer, and reads only what the template uses.
 * Like every PDF here it is tagged — a table of rows of cells, in reading
 * order — and assembled on request and never stored.
 */
import fontkit from "@pdf-lib/fontkit";
import PizZip from "pizzip";
import {
  PDFDocument,
  TextRenderingMode,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setLineWidth,
  setStrokingRgbColor,
  setTextRenderingMode,
  type PDFFont,
  type PDFImage,
  type PDFPage,
  type PDFRef,
  type RGB,
} from "pdf-lib";
import minchoFace from "../../templates/fonts/BIZUDMincho-Regular.ttf";
import gothicFace from "../../templates/fonts/BIZUDPGothic-Regular.ttf";
import gothicBoldFace from "../../templates/fonts/BIZUDPGothic-Bold.ttf";
import { decode } from "~/pipeline/docx";
import { defaultHalfPoints, ROW_BORDER_TWIPS } from "./rirekisho-layout";
import { Tags } from "./pdf-tags";
import { breakLines, embedFace, refuseMissing, widthOf, type PdfRun } from "./pdf-text";

/** Each face's vertical metrics (2048 units a square): 1802 above the baseline, 246 below, in all three. */
const ASCENT = 1802 / 2048;
const DESCENT = 246 / 2048;

/** A single line, as Word sets one with no exact height: the layout model's factor (`./rirekisho-layout.ts`). */
const SINGLE_LINE = 1.3;

/** The thinnest rule Word draws: a `w:sz` below 2 eighths of a point is drawn at 2. */
const THINNEST_RULE = 2 / 8;

/** The stroke that emboldens a face with no bold, as a share of the type size. */
const EMBOLDEN = 0.03;

/** One EMU in points: DrawingML sizes in English Metric Units, 12,700 to the point. */
const EMU = 1 / 12_700;

const BLACK = rgb(0, 0, 0);
const twips = (value: number) => value / 20;

/* ------------------------------------------------------------- reading */

type Face = "mincho" | "gothic" | "gothicBold";

interface FormRun {
  text: string;
  /** Half-points. */
  size: number;
  face: Face;
  emboldened: boolean;
}

interface Picture {
  bytes: Uint8Array;
  png: boolean;
  width: number;
  height: number;
}

interface FormParagraph {
  align: "start" | "center" | "end";
  before: number;
  after: number;
  /** The line height in twips, and whether it is exact or the least a line takes. */
  line: number;
  exact: boolean;
  runs: FormRun[];
  picture: Picture | null;
}

interface Border {
  width: number;
  color: RGB;
}

interface FormCell {
  gridStart: number;
  span: number;
  merge: "restart" | "continue" | null;
  borders: Partial<Record<"top" | "left" | "bottom" | "right", Border | null>>;
  fill: RGB | null;
  middle: boolean;
  paragraphs: FormParagraph[];
}

interface FormRow {
  cells: FormCell[];
  header: boolean;
  /** `w:trHeight`, in twips, and its rule. */
  height: { value: number; exact: boolean } | null;
}

interface FormTable {
  grid: number[];
  margins: { top: number; bottom: number; left: number; right: number };
  borders: Partial<Record<"top" | "left" | "bottom" | "right" | "insideH" | "insideV", Border | null>>;
  rows: FormRow[];
}

type FormBlock = { kind: "paragraph"; paragraph: FormParagraph } | { kind: "table"; table: FormTable };

const BODY_BLOCK = /<w:tbl>[\s\S]*?<\/w:tbl>|<w:p(?:\s[^>]*)?\/>|<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g;
const ROW = /<w:tr(?:\s[^>]*)?>[\s\S]*?<\/w:tr>/g;
const CELL = /<w:tc>[\s\S]*?<\/w:tc>/g;
const PARAGRAPH = /<w:p(?:\s[^>]*)?\/>|<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g;
const RUN = /<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g;

const attr = (xml: string, element: string, name: string): string | undefined =>
  new RegExp(`<${element}\\b[^>]*\\b${name}="([^"]*)"`).exec(xml)?.[1];
const element = (xml: string, name: string) => new RegExp(`<${name}\\b[^>]*?(?:/>|>[\\s\\S]*?</${name}>)`).exec(xml)?.[0] ?? "";

const hex = (value: string): RGB =>
  rgb(Number.parseInt(value.slice(0, 2), 16) / 255, Number.parseInt(value.slice(2, 4), 16) / 255, Number.parseInt(value.slice(4, 6), 16) / 255);

function readBorders(xml: string): FormTable["borders"] {
  const borders: FormTable["borders"] = {};
  for (const side of ["top", "left", "bottom", "right", "insideH", "insideV"] as const) {
    const edge = new RegExp(`<w:${side}\\b[^>]*/>`).exec(xml)?.[0];
    if (!edge) continue;
    const kind = attr(edge, `w:${side}`, "w:val");
    if (kind === "nil" || kind === "none") {
      borders[side] = null;
      continue;
    }
    const color = attr(edge, `w:${side}`, "w:color");
    borders[side] = {
      width: Math.max(Number(attr(edge, `w:${side}`, "w:sz") ?? 4) / 8, THINNEST_RULE),
      color: color && /^[0-9a-f]{6}$/i.test(color) ? hex(color) : BLACK,
    };
  }
  return borders;
}

function readParagraph(xml: string, body: number, pictures: (id: string) => Omit<Picture, "width" | "height"> | null): FormParagraph {
  const properties = element(xml, "w:pPr");
  const jc = attr(properties, "w:jc", "w:val");
  const spacing = element(properties, "w:spacing");
  const rule = attr(spacing, "w:spacing", "w:lineRule");
  const runs: FormRun[] = [];
  let picture: Picture | null = null;

  for (const [run] of xml.replace(properties, "").matchAll(RUN)) {
    const style = element(run, "w:rPr");
    const size = Number(attr(style, "w:sz", "w:val") ?? body);
    const bold = /<w:b\/>|<w:b w:val="(?:1|true|on)"\/>/.test(style);
    const gothic = /Gothic|ゴシック/.test(attr(style, "w:rFonts", "w:eastAsia") ?? attr(style, "w:rFonts", "w:ascii") ?? "");
    const face: Face = gothic ? (bold ? "gothicBold" : "gothic") : "mincho";
    const content = run.replace(style, "");
    let text = "";
    for (const [token, chars] of content.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:br\b[^>]*\/>|<w:cr\/>|<w:tab\/>|<w:drawing>[\s\S]*?<\/w:drawing>/g)) {
      if (chars !== undefined) text += decode(chars);
      else if (token.startsWith("<w:tab")) text += " ";
      else if (token.startsWith("<w:drawing")) {
        const id = attr(token, "a:blip", "r:embed");
        const found = id ? pictures(id) : null;
        if (found) {
          picture = {
            ...found,
            width: Number(attr(token, "wp:extent", "cx") ?? 0) * EMU,
            height: Number(attr(token, "wp:extent", "cy") ?? 0) * EMU,
          };
        }
      } else if (!/w:type="(page|column)"/.test(token)) text += "\n";
    }
    if (text) runs.push({ text, size, face, emboldened: bold && face === "mincho" });
  }

  const largest = runs.length > 0 ? Math.max(...runs.map((r) => r.size)) : body;
  return {
    align: jc === "center" ? "center" : jc === "right" || jc === "end" ? "end" : "start",
    before: Number(attr(spacing, "w:spacing", "w:before") ?? 0),
    after: Number(attr(spacing, "w:spacing", "w:after") ?? 0),
    line: rule === "exact" || rule === "atLeast" ? Number(attr(spacing, "w:spacing", "w:line")) : Math.round(largest * 10 * SINGLE_LINE),
    exact: rule === "exact",
    runs,
    picture,
  };
}

function readTable(xml: string, body: number, pictures: Parameters<typeof readParagraph>[2]): FormTable {
  const properties = element(xml, "w:tblPr");
  const margins = element(properties, "w:tblCellMar");
  const margin = (side: string, otherwise: number) => Number(attr(margins, `w:${side}`, "w:w") ?? otherwise);
  const rows = [...xml.matchAll(ROW)].map(([row]): FormRow => {
    const trPr = element(row, "w:trPr");
    const height = attr(trPr, "w:trHeight", "w:val");
    let gridStart = 0;
    const cells = [...row.matchAll(CELL)].map(([cell]): FormCell => {
      const tcPr = element(cell, "w:tcPr");
      const span = Number(attr(tcPr, "w:gridSpan", "w:val") ?? 1);
      const merge = /<w:vMerge\b/.test(tcPr) ? (attr(tcPr, "w:vMerge", "w:val") === "restart" ? "restart" : "continue") : null;
      const fill = attr(tcPr, "w:shd", "w:fill");
      const out: FormCell = {
        gridStart,
        span,
        merge,
        borders: readBorders(element(tcPr, "w:tcBorders")),
        fill: fill && /^[0-9a-f]{6}$/i.test(fill) ? hex(fill) : null,
        middle: attr(tcPr, "w:vAlign", "w:val") === "center",
        paragraphs: [...cell.replace(tcPr, "").matchAll(PARAGRAPH)].map(([p]) => readParagraph(p, body, pictures)),
      };
      gridStart += span;
      return out;
    });
    return {
      cells,
      header: /<w:tblHeader\b/.test(trPr),
      height: height ? { value: Number(height), exact: attr(trPr, "w:trHeight", "w:hRule") === "exact" } : null,
    };
  });
  return {
    grid: [...element(xml, "w:tblGrid").matchAll(/<w:gridCol w:w="(\d+)"/g)].map((m) => Number(m[1])),
    margins: { top: margin("top", 0), bottom: margin("bottom", 0), left: margin("left", 108), right: margin("right", 108) },
    borders: readBorders(element(properties, "w:tblBorders")),
    rows,
  };
}

/* ---------------------------------------------------------- the faces */

interface Fonts {
  mincho: PDFFont;
  gothic: PDFFont;
  gothicBold: PDFFont;
}

const FACES: Record<Face, ArrayBuffer> = { mincho: minchoFace, gothic: gothicFace, gothicBold: gothicBoldFace };

function allParagraphs(blocks: FormBlock[]): FormParagraph[] {
  return blocks.flatMap((block) =>
    block.kind === "paragraph" ? [block.paragraph] : block.table.rows.flatMap((row) => row.cells.flatMap((cell) => cell.paragraphs)),
  );
}

const pdfRun = (run: FormRun, fonts: Fonts): PdfRun => ({
  text: run.text,
  font: fonts[run.face],
  size: run.size / 2,
  color: BLACK,
  emboldened: run.emboldened,
});

/* ------------------------------------------------------------ the page */

/** A paragraph broken into lines inside a column, with its height. */
interface LaidParagraph {
  paragraph: FormParagraph;
  lines: PdfRun[][];
  /** Twips, including the space before and after. */
  height: number;
}

function layParagraph(paragraph: FormParagraph, width: number, fonts: Fonts): LaidParagraph {
  const lines: PdfRun[][] = [];
  const runs = paragraph.runs.map((run) => pdfRun(run, fonts));
  // A line break inside a run starts a new line; each part breaks on its own.
  let part: PdfRun[] = [];
  const flush = () => {
    lines.push(...breakLines(part, twips(width)));
    part = [];
  };
  for (const run of runs) {
    const pieces = run.text.split("\n");
    pieces.forEach((piece, index) => {
      if (index > 0) flush();
      if (piece) part.push({ ...run, text: piece });
    });
  }
  flush();
  const lineHeight = paragraph.picture
    ? Math.max(paragraph.line, paragraph.picture.height * 20)
    : paragraph.line;
  const count = paragraph.picture ? 1 : lines.length;
  return { paragraph, lines, height: paragraph.before + paragraph.after + lineHeight * count };
}

export async function rirekishoPdf(docx: Uint8Array, metadata: { title: string; author: string }): Promise<Uint8Array> {
  const zip = new PizZip(docx);
  const xml = zip.file("word/document.xml")!.asText();
  const body = defaultHalfPoints(zip.file("word/styles.xml")?.asText() ?? "");
  const rels = zip.file("word/_rels/document.xml.rels")?.asText() ?? "";
  const pictures = (id: string) => {
    const target = new RegExp(`<Relationship\\b[^>]*\\bId="${id}"[^>]*\\bTarget="([^"]+)"`).exec(rels)?.[1]
      ?? new RegExp(`<Relationship\\b[^>]*\\bTarget="([^"]+)"[^>]*\\bId="${id}"`).exec(rels)?.[1];
    const file = target ? zip.file(`word/${target.replace(/^\/?word\//, "")}`) : null;
    return file ? { bytes: file.asUint8Array(), png: /\.png$/i.test(target!) } : null;
  };

  const section = /<w:sectPr\b[\s\S]*?<\/w:sectPr>(?![\s\S]*<w:sectPr)/.exec(xml)?.[0] ?? "";
  const page = { width: Number(attr(section, "w:pgSz", "w:w")), height: Number(attr(section, "w:pgSz", "w:h")) };
  const margin = {
    top: Number(attr(section, "w:pgMar", "w:top")),
    bottom: Number(attr(section, "w:pgMar", "w:bottom")),
    left: Number(attr(section, "w:pgMar", "w:left")),
    right: Number(attr(section, "w:pgMar", "w:right")),
  };

  const bodyXml = xml.slice(xml.indexOf("<w:body>") + "<w:body>".length, xml.lastIndexOf("</w:body>"));
  const blocks: FormBlock[] = [...bodyXml.matchAll(BODY_BLOCK)].map(([block]) =>
    block.startsWith("<w:tbl>")
      ? { kind: "table", table: readTable(block, body, pictures) }
      : { kind: "paragraph", paragraph: readParagraph(block, body, pictures) });

  // Every character checked against its face, then each face cut to them.
  const text: Record<Face, string> = { mincho: "", gothic: "", gothicBold: "" };
  for (const paragraph of allParagraphs(blocks)) {
    for (const run of paragraph.runs) {
      refuseMissing(FACES[run.face], run.text, "the 履歴書");
      text[run.face] += run.text;
    }
  }

  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const fonts: Fonts = {
    mincho: await embedFace(pdf, minchoFace, text.mincho),
    gothic: await embedFace(pdf, gothicFace, text.gothic),
    gothicBold: await embedFace(pdf, gothicBoldFace, text.gothicBold),
  };
  pdf.setTitle(metadata.title, { showInWindowTitleBar: true });
  if (metadata.author) pdf.setAuthor(metadata.author);
  pdf.setLanguage("ja-JP");
  pdf.setCreator("Track Record");
  pdf.setProducer("Track Record");

  const drawer = new FormDrawer(pdf, fonts, page, margin);
  for (const block of blocks) {
    if (block.kind === "paragraph") await drawer.paragraph(block.paragraph);
    else await drawer.table(block.table);
  }
  drawer.tags.finish();
  return pdf.save();
}

/* ---------------------------------------------------------- the drawing */

class FormDrawer {
  readonly tags: Tags;
  private page: PDFPage;
  /** Twips from the top of the text area. */
  private y = 0;
  private readonly images = new Map<Uint8Array, PDFImage>();
  private first = true;

  constructor(
    private readonly pdf: PDFDocument,
    private readonly fonts: Fonts,
    private readonly size: { width: number; height: number },
    private readonly margin: { top: number; bottom: number; left: number; right: number },
  ) {
    this.tags = new Tags(pdf);
    this.page = pdf.addPage([twips(size.width), twips(size.height)]);
  }

  private get capacity() {
    return this.size.height - this.margin.top - this.margin.bottom;
  }

  private get textWidth() {
    return this.size.width - this.margin.left - this.margin.right;
  }

  private newPage() {
    this.page = this.pdf.addPage([twips(this.size.width), twips(this.size.height)]);
    this.y = 0;
  }

  /** Points from the page's foot, for a position in twips from the text area's top. */
  private pdfY(twipsFromTop: number) {
    return twips(this.size.height - this.margin.top - twipsFromTop);
  }

  async paragraph(paragraph: FormParagraph) {
    const laid = layParagraph(paragraph, this.textWidth, this.fonts);
    if (this.y > 0 && this.y + laid.height > this.capacity) this.newPage();
    // The first paragraph of the document is its title.
    const role = this.first ? "H1" : "P";
    this.first = false;
    await this.drawParagraph(laid, this.tags.element(role, this.tags.root), this.margin.left, this.textWidth, this.y);
    this.y += laid.height;
  }

  async table(table: FormTable) {
    const column = (start: number, span: number) => table.grid.slice(start, start + span).reduce((a, b) => a + b, 0);
    const left = (start: number) => this.margin.left + column(0, start);
    const inner = (cell: FormCell) => column(cell.gridStart, cell.span) - table.margins.left - table.margins.right;

    // Each cell's paragraphs laid out in its column, and each row's height.
    const laid = table.rows.map((row) =>
      row.cells.map((cell) => cell.paragraphs.map((p) => layParagraph(p, inner(cell), this.fonts))),
    );
    const contentOf = (r: number, c: number) =>
      table.margins.top + table.margins.bottom + laid[r]![c]!.reduce((sum, p) => sum + p.height, 0);
    const heights = table.rows.map((row, r) => {
      const own = row.cells.reduce((most, cell, c) => (cell.merge ? most : Math.max(most, contentOf(r, c))), 0);
      const set = row.height;
      return (set?.exact ? set.value : Math.max(own, set?.value ?? 0)) + ROW_BORDER_TWIPS;
    });
    // A vertically merged cell taller than the rows it spans grows the last of them.
    const spans = new Map<string, number>();
    table.rows.forEach((row, r) => {
      row.cells.forEach((cell, c) => {
        if (cell.merge !== "restart") return;
        let last = r;
        while (table.rows[last + 1]?.cells.some((next) => next.gridStart === cell.gridStart && next.merge === "continue")) last += 1;
        spans.set(`${r}:${c}`, last);
        const covered = heights.slice(r, last + 1).reduce((a, b) => a + b, 0);
        const needed = contentOf(r, c) + ROW_BORDER_TWIPS;
        if (needed > covered) heights[last]! += needed - covered;
      });
    });

    const element = this.tags.element("Table", this.tags.root);
    const headerRows = table.rows.findIndex((row) => !row.header);
    const repeat = table.rows.slice(0, Math.max(headerRows, 0)).map((_, r) => r);

    for (let r = 0; r < table.rows.length; r++) {
      const merged = [...spans.entries()].filter(([key]) => key.startsWith(`${r}:`)).map(([, last]) => last);
      const height = heights.slice(r, Math.max(r, ...merged) + 1).reduce((a, b) => a + b, 0);
      const rowHeight = merged.length > 0 ? heights[r]! : height;
      if (this.y > 0 && this.y + rowHeight > this.capacity) {
        this.newPage();
        // A table continuing onto a new page repeats its header rows first, as decoration.
        if (r >= headerRows && headerRows > 0) {
          for (const h of repeat) await this.row(table, h, laid[h]!, heights, spans, left, column, null);
        }
      }
      await this.row(table, r, laid[r]!, heights, spans, left, column, this.tags.element("TR", element));
    }
  }

  private async row(
    table: FormTable,
    r: number,
    cells: LaidParagraph[][],
    heights: number[],
    spans: Map<string, number>,
    left: (start: number) => number,
    column: (start: number, span: number) => number,
    element: PDFRef | null,
  ) {
    const row = table.rows[r]!;
    const top = this.y;
    const page = this.page;
    const decoration = (draw: () => void) => this.tags.artifact(page, draw);

    for (let c = 0; c < row.cells.length; c++) {
      const cell = row.cells[c]!;
      if (cell.merge === "continue") continue;
      const last = spans.get(`${r}:${c}`) ?? r;
      const height = heights.slice(r, last + 1).reduce((a, b) => a + b, 0);
      const x = left(cell.gridStart);
      const width = column(cell.gridStart, cell.span);

      if (cell.fill) {
        const fill = cell.fill;
        decoration(() =>
          page.drawRectangle({ x: twips(x), y: this.pdfY(top + height), width: twips(width), height: twips(height), color: fill }),
        );
      }

      const content = cells[c]!.reduce((sum, p) => sum + p.height, 0);
      let y = top + table.margins.top + (cell.middle ? Math.max(0, (height - table.margins.top - table.margins.bottom - content) / 2) : 0);
      const cellElement = element ? this.tags.element(row.header ? "TH" : "TD", element) : null;
      for (const laid of cells[c]!) {
        const paragraph = cellElement ? this.tags.element("P", cellElement) : null;
        await this.drawParagraph(laid, paragraph, x + table.margins.left, width - table.margins.left - table.margins.right, y);
        y += laid.height;
      }

      decoration(() => this.borders(table, cell, r, last, x, width, top, height));
    }
    this.y += heights[r]!;
  }

  private borders(table: FormTable, cell: FormCell, first: number, last: number, x: number, width: number, top: number, height: number) {
    const columns = table.grid.length;
    const edge = (side: "top" | "left" | "bottom" | "right"): Border | null | undefined => {
      if (cell.borders[side] !== undefined) return cell.borders[side];
      const outer = side === "top" ? first === 0 : side === "bottom" ? last === table.rows.length - 1
        : side === "left" ? cell.gridStart === 0 : cell.gridStart + cell.span === columns;
      return outer ? table.borders[side] : table.borders[side === "top" || side === "bottom" ? "insideH" : "insideV"];
    };
    const line = (border: Border | null | undefined, from: [number, number], to: [number, number]) => {
      if (!border) return;
      this.page.drawLine({
        start: { x: twips(from[0]), y: this.pdfY(from[1]) },
        end: { x: twips(to[0]), y: this.pdfY(to[1]) },
        thickness: border.width,
        color: border.color,
      });
    };
    line(edge("top"), [x, top], [x + width, top]);
    line(edge("bottom"), [x, top + height], [x + width, top + height]);
    line(edge("left"), [x, top], [x, top + height]);
    line(edge("right"), [x + width, top], [x + width, top + height]);
  }

  /** A paragraph's lines from `top` (twips from the text area's top), tagged to `element`, or decoration when it has none. */
  private async drawParagraph(laid: LaidParagraph, element: PDFRef | null, x: number, width: number, top: number) {
    const { paragraph } = laid;
    const page = this.page;
    let y = top + paragraph.before;

    if (paragraph.picture) {
      const picture = paragraph.picture;
      let image = this.images.get(picture.bytes);
      if (!image) {
        image = picture.png ? await this.pdf.embedPng(picture.bytes) : await this.pdf.embedJpg(picture.bytes);
        this.images.set(picture.bytes, image);
      }
      const w = picture.width * 20;
      const left = paragraph.align === "center" ? x + (width - w) / 2 : paragraph.align === "end" ? x + width - w : x;
      const placed = image;
      const draw = () =>
        page.drawImage(placed, { x: twips(left), y: this.pdfY(y + picture.height * 20), width: picture.width, height: picture.height });
      if (element) this.tags.mark(page, this.tags.element("Figure", element, "写真"), draw);
      else this.tags.artifact(page, draw);
      return;
    }

    for (const line of laid.lines) {
      const largest = Math.max(0, ...line.map((r) => r.size));
      const pitch = twips(paragraph.line);
      const baseline = this.pdfY(y) - (pitch - largest * (ASCENT + DESCENT)) / 2 - largest * ASCENT;
      const lineWidth = line.reduce((sum, r) => sum + widthOf(r), 0);
      let at = twips(x);
      if (paragraph.align === "center") at = twips(x) + (twips(width) - lineWidth) / 2;
      if (paragraph.align === "end") at = twips(x + width) - lineWidth;
      const draw = () => {
        for (const run of line) {
          drawRun(page, run, at, baseline);
          at += widthOf(run);
        }
      };
      if (line.length > 0) {
        if (element) this.tags.mark(page, element, draw);
        else this.tags.artifact(page, draw);
      }
      y += paragraph.line;
    }
  }
}

function drawRun(page: PDFPage, run: PdfRun, x: number, y: number) {
  if (run.text === "") return;
  if (!run.emboldened) {
    page.drawText(run.text, { x, y, size: run.size, font: run.font, color: run.color });
    return;
  }
  page.pushOperators(
    pushGraphicsState(),
    setTextRenderingMode(TextRenderingMode.FillAndOutline),
    setLineWidth(run.size * EMBOLDEN),
    setStrokingRgbColor(run.color.red, run.color.green, run.color.blue),
  );
  page.drawText(run.text, { x, y, size: run.size, font: run.font, color: run.color });
  page.pushOperators(popGraphicsState());
}
