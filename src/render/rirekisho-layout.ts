/**
 * The 履歴書's two A4 pages (issue #117, review §3.2).
 *
 * The 厚労省 様式例 is two fixed pages: page 1 is the identity block and as
 * many 学歴・職歴 rows as the page holds, and page 2 opens with the rest of
 * 学歴・職歴 under a repeated 年 / 月 header, then 免許・資格, 志望動機 and
 * 本人希望欄. The committed template is one flowing document, so on its own
 * the break lands wherever the row count puts it: across the 免許・資格 table
 * with no header, and with page 2 left mostly white.
 *
 * Two passes make it the form.
 *
 * - {@link prepareTemplateXml}, before the fill: every row `cantSplit`, the
 *   年 / 月 header rows repeated on a new page, and every paragraph an
 *   **exact** line height. Word's natural line height depends on the font it
 *   finds; an exact one does not, and that is what lets the second pass count.
 * - {@link paginateXml}, after the fill: lay the filled document out, then pad
 *   学歴・職歴 with blank rows until it runs {@link CONTINUED_ROWS} rows onto
 *   page 2, and give the 志望動機 cell the rest of page 2. The page break is
 *   then the bottom of page 1 inside 学歴・職歴 for every record, as on the
 *   form.
 *
 * The layout is a model, not Word: it knows MS Mincho is fixed-pitch, how
 * Japanese and Latin wrap, and Word's ¼-em space between them. Its errors are
 * a line or two, and both margins below are sized to absorb that. The checks
 * that it holds in real Word are `docs/11` §3 items 1 and 2.
 *
 * The template is the author's own grid (`scripts/build-rirekisho-template.mjs`)
 * and is never rewritten for this. Both passes are string edits over its XML,
 * in the build script's manner.
 */
import { decode } from "~/pipeline/docx";

/**
 * Line height as a multiple of the font size: what Word gives MS Mincho
 * "single" spacing, measured against a Word-printed PDF of the template
 * (10pt rows sit 13pt apart). Fixing it changes nothing on the page; it makes
 * the height the same in every Word, whatever font it substitutes.
 */
const LINE_FACTOR = 1.3;

/** The fewest 学歴・職歴 rows, entries or blank, that open page 2 under the repeated header. */
export const CONTINUED_ROWS = 3;

/**
 * Space left under 本人希望欄 when the 志望動機 cell is grown to fill page 2:
 * a row and a half, so that page 1 holding one row fewer than the model says
 * still leaves room for the paragraph Word requires after the last table.
 */
const PAGE_TWO_SLACK_TWIPS = 600;

/**
 * What a row's borders add to its height in Word: measured at 0.2pt a row
 * against the Word-printed PDF, and rounded up. Forty rows of it is a row.
 */
export const ROW_BORDER_TWIPS = 5;

/** `w:pPr` children that follow `w:spacing` (CT_PPrBase), so the new one goes before the first. */
const AFTER_SPACING = ["w:ind", "w:contextualSpacing", "w:mirrorIndents", "w:suppressOverlap", "w:jc",
  "w:textDirection", "w:textAlignment", "w:textboxTightWrap", "w:outlineLvl", "w:divId", "w:cnfStyle",
  "w:rPr", "w:sectPr", "w:pPrChange"];

const PARAGRAPH = /<w:p(?:\s[^>]*)?\/>|<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g;
const ROW = /<w:tr(?:\s[^>]*)?>[\s\S]*?<\/w:tr>/g;
const CELL = /<w:tc>[\s\S]*?<\/w:tc>/g;
const TABLE = /<w:tbl>[\s\S]*?<\/w:tbl>/g;
const BODY_BLOCK = /<w:tbl>[\s\S]*?<\/w:tbl>|<w:p(?:\s[^>]*)?\/>|<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g;

const attr = (xml: string, element: string, name: string): string | undefined =>
  new RegExp(`<${element}\\b[^>]*\\bw:${name}="([^"]*)"`).exec(xml)?.[1];

/** The run size a paragraph prints at, in half-points: its largest run, else its mark, else the document default. */
function halfPointsOf(paragraph: string, fallback: number): number {
  const properties = /<w:pPr>[\s\S]*?<\/w:pPr>/.exec(paragraph)?.[0] ?? "";
  const runs = paragraph.replace(properties, "");
  const sizes = [...runs.matchAll(/<w:sz w:val="(\d+)"/g)].map((m) => Number(m[1]));
  if (sizes.length) return Math.max(...sizes);
  const mark = /<w:sz w:val="(\d+)"/.exec(properties);
  return mark ? Number(mark[1]) : fallback;
}

/** Exact line height for a size in half-points, in twips. */
export const lineTwips = (halfPoints: number) => Math.round(halfPoints * 10 * LINE_FACTOR);

function withExactLine(paragraph: string, fallback: number): string {
  const line = `w:line="${lineTwips(halfPointsOf(paragraph, fallback))}" w:lineRule="exact"`;
  if (paragraph.endsWith("/>") && !paragraph.includes("</w:p>")) {
    return `${paragraph.slice(0, -2)}><w:pPr><w:spacing ${line}/></w:pPr></w:p>`;
  }
  const open = /^<w:p(?:\s[^>]*)?>/.exec(paragraph)![0];
  const rest = paragraph.slice(open.length);
  if (rest.startsWith("<w:pPr/>")) return `${open}<w:pPr><w:spacing ${line}/></w:pPr>${rest.slice(8)}`;
  if (!rest.startsWith("<w:pPr>")) return `${open}<w:pPr><w:spacing ${line}/></w:pPr>${rest}`;
  const end = rest.indexOf("</w:pPr>");
  let properties = rest.slice(0, end);
  const spacing = /<w:spacing\b([^>]*?)\/>/.exec(properties);
  if (spacing) {
    const kept = spacing[1]!.replace(/\s+w:(line|lineRule)="[^"]*"/g, "");
    properties = properties.replace(spacing[0], `<w:spacing${kept} ${line}/>`);
  } else {
    const at = AFTER_SPACING.map((tag) => properties.search(new RegExp(`<${tag}\\b`)))
      .filter((i) => i >= 0)
      .reduce((a, b) => Math.min(a, b), properties.length);
    properties = `${properties.slice(0, at)}<w:spacing ${line}/>${properties.slice(at)}`;
  }
  return `${open}${properties}${rest.slice(end)}`;
}

/** The text a row or paragraph prints, ignoring placeholders' braces. */
const textOf = (xml: string) =>
  [...xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => decode(m[1]!)).join("");

/** The 年 / 月 column-header row of 学歴・職歴 and 免許・資格. */
const isColumnHeader = (row: string) => {
  const cells = [...row.matchAll(CELL)].map((m) => textOf(m[0]).trim());
  return cells[0] === "年" && cells[1] === "月";
};

/** CT_TrPr fixes the order: cantSplit, trHeight, tblHeader. */
function withRowProperties(row: string, { header, minTwips }: { header?: boolean; minTwips?: number }): string {
  const open = /^<w:tr(?:\s[^>]*)?>/.exec(row)![0];
  let rest = row.slice(open.length);
  const existing = /^<w:trPr>([\s\S]*?)<\/w:trPr>/.exec(rest);
  let inner = existing?.[1] ?? "";
  if (existing) rest = rest.slice(existing[0].length);
  const has = (tag: string) => new RegExp(`<w:${tag}\\b`).test(inner);
  const height = minTwips === undefined ? "" : `<w:trHeight w:val="${minTwips}" w:hRule="atLeast"/>`;
  if (height) inner = inner.replace(/<w:trHeight\b[^>]*\/>/, "");
  const lead = `${has("cantSplit") ? "" : "<w:cantSplit/>"}${height}`;
  const at = inner.search(/<w:(trHeight|tblHeader|tblCellSpacing|jc|hidden|ins|del|trPrChange)\b/);
  inner = at < 0 ? inner + lead : inner.slice(0, at) + lead + inner.slice(at);
  if (header && !has("tblHeader")) {
    const after = inner.search(/<w:(tblCellSpacing|jc|hidden|ins|del|trPrChange)\b/);
    inner = after < 0 ? `${inner}<w:tblHeader/>` : `${inner.slice(0, after)}<w:tblHeader/>${inner.slice(after)}`;
  }
  return `${open}<w:trPr>${inner}</w:trPr>${rest}`;
}

/** The document-default run size, in half-points, from `word/styles.xml`. */
export function defaultHalfPoints(stylesXml: string): number {
  const defaults = /<w:rPrDefault>[\s\S]*?<\/w:rPrDefault>/.exec(stylesXml)?.[0] ?? "";
  return Number(/<w:sz w:val="(\d+)"/.exec(defaults)?.[1] ?? 20);
}

/**
 * The template's `word/document.xml`, ready to fill: every paragraph at an
 * exact line height, every row unsplittable, and the two 年 / 月 header rows
 * repeated at the top of a page their table continues onto.
 */
export function prepareTemplateXml(xml: string, bodyHalfPoints: number): string {
  return xml
    .replace(PARAGRAPH, (paragraph) => withExactLine(paragraph, bodyHalfPoints))
    .replace(ROW, (row) => withRowProperties(row, { header: isColumnHeader(row) }));
}

/** The prepared template's 学歴 loop row with its placeholders gone: what a blank row is. */
export function blankRowOf(preparedXml: string): string {
  const row = [...preparedXml.matchAll(ROW)].map((m) => m[0]).find((r) => r.includes("{#gakureki}"));
  if (!row) throw new Error("the template has no 学歴 loop row");
  return row.replace(/<w:r>(?:(?!<\/w:r>)[\s\S])*<\/w:r>/g, "");
}

/* ------------------------------------------------------------- the model */

/** Fixed-pitch MS Mincho: an ASCII or half-width kana character is half an em, the rest a whole one. */
const isHalfWidth = (code: number) =>
  (code < 0x0370 && !FULL_WIDTH_LATIN.has(code)) || (code >= 0xff61 && code <= 0xff9f);
/** Latin-1 signs JIS X 0208 carries, which MS Mincho sets a whole em wide. */
const FULL_WIDTH_LATIN = new Set([..."§¨°±´¶×÷"].map((c) => c.codePointAt(0)!));
const isLatin = (code: number) => (code >= 0x30 && code <= 0x39) || (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
const isJapanese = (code: number) => code >= 0x3000 && !(code >= 0xff61 && code <= 0xff9f);
/** Characters Word will not start a line with (行頭禁則), so they travel with the one before. */
const NO_LINE_START = new Set("、。，．・：；？！ー）」』】〕｝〉》ゝゞ々ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ),.:;?!]}%");
/** Characters Word will not end a line with (行末禁則), so they travel with the one after. */
const NO_LINE_END = new Set("（「『【〔｛〈《([{");

/** Lines a paragraph's text takes in a column `width` twips wide at `em` twips per em. */
export function lineCount(text: string, width: number, em: number): number {
  return text.split("\n").reduce((sum, segment) => sum + segmentLines(segment, width / em), 0);
}

function segmentLines(text: string, columns: number): number {
  // Units Word will not break inside: an ASCII word, or a Japanese character
  // with the punctuation 禁則 binds to it. Spaces stand alone and may hang.
  const units: { width: number; space: boolean }[] = [];
  let previous = 0;
  let glue = false;
  for (const char of text) {
    const code = char.codePointAt(0)!;
    let width = isHalfWidth(code) ? 0.5 : 1;
    // Word's autospace: a quarter em between Japanese and Latin letters or digits.
    if (previous && ((isJapanese(previous) && isLatin(code)) || (isLatin(previous) && isJapanese(code)))) width += 0.25;
    const space = char === " " || char === "　";
    const last = units[units.length - 1];
    const word = isHalfWidth(code) && !space && previous !== 0 && isHalfWidth(previous) && previous !== 0x20;
    if (last && !space && !last.space && (glue || word || NO_LINE_START.has(char))) last.width += width;
    else units.push({ width, space });
    glue = NO_LINE_END.has(char);
    previous = code;
  }

  let lines = 1;
  let x = 0;
  for (const unit of units) {
    if (unit.space) {
      x += unit.width;
      continue;
    }
    if (x + unit.width > columns && x > 0) {
      lines += 1;
      x = 0;
    }
    x += unit.width;
    while (x > columns) {
      lines += 1;
      x -= columns;
    }
  }
  return lines;
}

interface Paragraph {
  before: number;
  after: number;
  line: number;
  halfPoints: number;
  text: string;
  /** The tallest inline picture on its line, in twips: the 写真 (`./rirekisho-photo.ts`). */
  picture: number;
}

/** DrawingML sizes in EMU; a twip is 635 of them. */
const EMU_PER_TWIP = 635;

function readParagraph(xml: string, fallback: number): Paragraph {
  const properties = /<w:pPr>[\s\S]*?<\/w:pPr>/.exec(xml)?.[0] ?? "";
  const halfPoints = halfPointsOf(xml, fallback);
  const text = [...xml.replace(properties, "").matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:br\b([^>]*)\/>|<w:tab\/>/g)]
    .map((m) => (m[1] !== undefined ? decode(m[1]) : m[0].startsWith("<w:tab") ? " " : /w:type="(page|column)"/.test(m[2] ?? "") ? "" : "\n"))
    .join("");
  const exact = attr(properties, "w:spacing", "lineRule") === "exact";
  return {
    before: Number(attr(properties, "w:spacing", "before") ?? 0),
    after: Number(attr(properties, "w:spacing", "after") ?? 0),
    line: exact ? Number(attr(properties, "w:spacing", "line")) : lineTwips(halfPoints),
    halfPoints,
    text,
    picture: Math.max(0, ...[...xml.matchAll(/<wp:extent\b[^>]*\bcy="(\d+)"/g)].map((m) => Math.ceil(Number(m[1]) / EMU_PER_TWIP))),
  };
}

/** A picture's line is as tall as the picture: the paragraph that holds one is never an exact height. */
const paragraphHeight = (p: Paragraph, width: number) =>
  p.before + p.after + Math.max(p.line * lineCount(p.text, width, p.halfPoints * 10), p.picture);

interface Row {
  height: number;
  header: boolean;
}

interface Table {
  rows: Row[];
  /** The text of the first row, which is how the 学歴・職歴 and 志望動機 tables are found. */
  heading: string;
}

function readTable(xml: string, fallback: number): Table {
  const grid = [...xml.matchAll(/<w:gridCol w:w="(\d+)"/g)].map((m) => Number(m[1]));
  const margins = /<w:tblCellMar>[\s\S]*?<\/w:tblCellMar>/.exec(xml)?.[0] ?? "";
  const margin = (side: string, otherwise: number) => Number(attr(margins, `w:${side}`, "w") ?? otherwise);
  const [top, bottom, left, right] = [margin("top", 0), margin("bottom", 0), margin("left", 108), margin("right", 108)];

  const rowXml = [...xml.matchAll(ROW)].map((m) => m[0]);
  /** Per grid column: the merged cell's height and the first row it covers. */
  const merges = new Map<number, { height: number; from: number }>();
  const heights: number[] = [];
  const settle = (column: number, through: number) => {
    const merge = merges.get(column);
    if (!merge) return;
    const covered = heights.slice(merge.from, through + 1).reduce((a, b) => a + b, 0);
    if (merge.height > covered) heights[through]! += merge.height - covered;
    merges.delete(column);
  };

  const headers = rowXml.map((row, index) => {
    const trPr = /<w:trPr>[\s\S]*?<\/w:trPr>/.exec(row)?.[0] ?? "";
    let height = 0;
    let column = 0;
    const continued = new Set<number>();
    for (const [cell] of row.matchAll(CELL)) {
      const span = Number(attr(cell, "w:gridSpan", "val") ?? 1);
      const width = grid.slice(column, column + span).reduce((a, b) => a + b, 0) - left - right;
      const content = top + bottom + [...cell.matchAll(PARAGRAPH)]
        .reduce((sum, [p]) => sum + paragraphHeight(readParagraph(p, fallback), width), 0);
      const merge = /<w:vMerge\b[^>]*\/>/.exec(cell)?.[0];
      if (merge?.includes('w:val="restart"')) merges.set(column, { height: content, from: index });
      else if (merge) continued.add(column);
      else height = Math.max(height, content);
      column += span;
    }
    const rule = attr(trPr, "w:trHeight", "hRule");
    const set = Number(attr(trPr, "w:trHeight", "val") ?? 0);
    heights[index] = (rule === "exact" ? set : Math.max(height, set)) + ROW_BORDER_TWIPS;
    for (const merged of [...merges.keys()]) {
      if (!continued.has(merged) && merges.get(merged)!.from !== index) settle(merged, index - 1);
    }
    return /<w:tblHeader\b/.test(trPr);
  });
  for (const merged of [...merges.keys()]) settle(merged, rowXml.length - 1);
  const rows: Row[] = headers.map((header, index) => ({ height: heights[index]!, header }));
  return { rows, heading: textOf(rowXml[0] ?? "") };
}

type Block = { kind: "paragraph"; height: number } | { kind: "table"; table: Table };

/** Where each block landed: per row for a table, one entry for a paragraph. */
type Placed = { page: number; top: number; bottom: number }[];

/**
 * Word's flow, as far as this document needs it: a block or a row that does
 * not fit goes to the next page whole (every row is `cantSplit`), and a table
 * continuing onto a new page reprints its header rows first.
 */
function place(blocks: Block[], capacity: number): Placed[] {
  let page = 1;
  let y = 0;
  const put = (height: number, reprint: number) => {
    if (y > 0 && y + height > capacity) {
      page += 1;
      y = reprint;
    }
    const at = { page, top: y, bottom: y + height };
    y += height;
    return at;
  };
  return blocks.map((block) => {
    if (block.kind === "paragraph") return [put(block.height, 0)];
    const rows = block.table.rows;
    const headers = rows.findIndex((row) => !row.header);
    const reprint = rows.slice(0, Math.max(headers, 0)).reduce((sum, row) => sum + row.height, 0);
    return rows.map((row, i) => put(row.height, i >= headers && headers >= 0 ? reprint : 0));
  });
}

export interface RirekishoLayout {
  /** Blank rows added after 以上 so 学歴・職歴 continues onto page 2. */
  blankRows: number;
  /** The page the 志望動機 table starts on, as the model lays it out. */
  motivationPage: number;
  /** Pages in the document, as the model lays it out. */
  pages: number;
}

/**
 * Lay the filled document out and fix its page break: blank rows after 以上
 * until 学歴・職歴 runs {@link CONTINUED_ROWS} rows onto page 2, then the
 * 志望動機 cell grown to take what page 2 has left.
 */
export function paginateXml(xml: string, blankRow: string, bodyHalfPoints: number): { xml: string; layout: RirekishoLayout } {
  const section = /<w:sectPr\b[\s\S]*?<\/w:sectPr>(?![\s\S]*<w:sectPr)/.exec(xml)?.[0] ?? "";
  const capacity = Number(attr(section, "w:pgSz", "h")) - Number(attr(section, "w:pgMar", "top")) - Number(attr(section, "w:pgMar", "bottom"));
  const textWidth = Number(attr(section, "w:pgSz", "w")) - Number(attr(section, "w:pgMar", "left")) - Number(attr(section, "w:pgMar", "right"));

  const body = xml.slice(xml.indexOf("<w:body>") + "<w:body>".length, xml.lastIndexOf("</w:body>"));
  const blocks: Block[] = [...body.matchAll(BODY_BLOCK)].map(([block]) =>
    block.startsWith("<w:tbl>")
      ? { kind: "table", table: readTable(block, bodyHalfPoints) }
      : { kind: "paragraph", height: paragraphHeight(readParagraph(block, bodyHalfPoints), textWidth) });
  const tables = blocks.flatMap((block, index) => (block.kind === "table" ? [{ index, table: block.table }] : []));
  const history = tables.find((t) => t.table.heading.includes("学歴・職歴"));
  const motivation = tables.find((t) => t.table.heading.startsWith("志望動機"));
  if (!history || !motivation) throw new Error("the 履歴書 has no 学歴・職歴 or 志望動機 table");

  const historyXml = [...xml.matchAll(TABLE)][tables.indexOf(history)]![0];
  const blankHeight = readTable(historyXml.replace(/<w:tr\b[\s\S]*<\/w:tr>/, blankRow), bodyHalfPoints).rows[0]!.height;
  const padded = (count: number): Block[] => blocks.map((block, index) =>
    index === history.index && block.kind === "table"
      ? { kind: "table", table: { ...block.table, rows: [...block.table.rows, ...Array.from({ length: count }, () => ({ height: blankHeight, header: false }))] } }
      : block);
  const continued = (placed: Placed[]) => {
    const rows = placed[history.index]!;
    return rows.filter((row, i) => !history.table.rows[i]?.header && row.page > rows[0]!.page).length;
  };

  let blankRows = 0;
  while (continued(place(padded(blankRows), capacity)) < CONTINUED_ROWS && blankRows < 200) blankRows += 1;
  const placed = place(padded(blankRows), capacity);
  const motivationPage = placed[motivation.index]![0]!.page;
  const last = placed[placed.length - 1]!;
  const end = last[last.length - 1]!;
  const spare = end.page === motivationPage ? capacity - end.bottom - PAGE_TWO_SLACK_TWIPS : 0;

  let out = xml;
  const tableSpans = [...xml.matchAll(TABLE)];
  const historyAt = tableSpans[tables.indexOf(history)]!;
  const motivationAt = tableSpans[tables.indexOf(motivation)]!;
  const grown = (table: string) => {
    if (spare <= 0) return table;
    const rows = [...table.matchAll(ROW)];
    const target = rows[1];
    if (!target) return table;
    const height = motivation.table.rows[1]!.height + spare;
    return table.slice(0, target.index) + withRowProperties(target[0], { minTwips: height }) + table.slice(target.index + target[0].length);
  };
  const extended = (table: string) => table.replace(/<\/w:tbl>$/, `${blankRow.repeat(blankRows)}</w:tbl>`);
  // Edit the later table first so the earlier one's offsets still hold.
  out = out.slice(0, motivationAt.index) + grown(motivationAt[0]) + out.slice(motivationAt.index + motivationAt[0].length);
  out = out.slice(0, historyAt.index) + extended(historyAt[0]) + out.slice(historyAt.index + historyAt[0].length);

  return { xml: out, layout: { blankRows, motivationPage, pages: end.page } };
}
