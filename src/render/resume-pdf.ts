/**
 * The English résumé's PDF (issue #109), from the same assembled document and
 * the same numbers as its `.docx` (`./resume-docx.ts`).
 *
 * PDF is the default download because it is what employers and ATS guidance
 * expect (§4.1 of the 2026-10-17 evaluation); the `.docx` stays the second
 * option for a posting that asks for Word. Built with `pdf-lib`, which is pure
 * JavaScript and runs inside workerd with no filesystem, canvas or browser:
 * the suite assembles and reads back every PDF in the Workers runtime itself
 * (`docs/06`, 2026-10-22).
 *
 * The text must survive being selected and copied, and in reading order:
 *
 * - **Carlito is embedded**, not a standard PDF font. It is Calibri's
 *   metric-compatible substitute, so a line breaks where the `.docx`'s does in
 *   Word, and it carries every Latin letter a name can hold, which the
 *   standard fonts' WinAnsi encoding does not. `pdf-lib` writes a `ToUnicode`
 *   map, which is what makes copied text come back as letters. The faces are
 *   embedded whole: `pdf-lib`'s subsets drew most letters as nothing in
 *   Preview and Quick Look, though they copied correctly.
 * - **Ligatures are off**, as Word leaves them for Calibri. Carlito would set
 *   "efficient" with one `ffi` glyph; `pdf-lib`'s map does copy that back as
 *   three letters, but a parser that reads glyph by glyph may not, and the
 *   `.docx` prints three.
 * - **Everything is drawn in reading order**, top to bottom and left to right,
 *   and a job's dates after its company, for a reader that takes the text in
 *   the order it was written.
 * - **And the PDF is tagged**, for a reader that goes by position instead.
 *   Preview's copy took the right-aligned dates for a second column and gave
 *   them back after the job's bullets. A structure tree — the name, each
 *   heading, each paragraph and each list item in order, the rules marked as
 *   decoration — states the order outright, as Word's own PDF export does.
 *
 * Like the `.docx`, it is assembled on request and never stored (`docs/03` §6).
 */
import fontkit from "@pdf-lib/fontkit";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFOperator,
  PDFOperatorNames,
  rgb,
  type PDFFont,
  type PDFPage,
  type PDFRef,
  type RGB,
} from "pdf-lib";
import regularFont from "../../templates/fonts/Carlito-Regular.ttf";
import boldFont from "../../templates/fonts/Carlito-Bold.ttf";
import italicFont from "../../templates/fonts/Carlito-Italic.ttf";
import { ResumeAssemblyError, type ResumeBlock, type ResumeDocument } from "./resume";
import { ACCENT, BULLET_INDENT, LINE, MARGIN, MUTED, PAGE, RULE, SIZE, SPACE, type PaperSize } from "./resume-docx";

export const PDF_MIME = "application/pdf";

/** Carlito's vertical metrics (2048 units a square): 1950 above the baseline, 550 below. */
const ASCENT = 1950 / 2048;
const DESCENT = 550 / 2048;

/** One line's pitch per point of type: Word's single spacing for this font, at 1.05 lines. */
const PITCH = (ASCENT + DESCENT) * (LINE / 240);

/** Word sets a small capital at four fifths of the capital's size. */
const SMALL_CAP = 0.8;

const BLACK = rgb(0, 0, 0);

/** Twips, half-points and eighths to points. */
const twips = (value: number) => value / 20;
const halfPoints = (value: number) => value / 2;

const hex = (value: string): RGB =>
  rgb(
    Number.parseInt(value.slice(0, 2), 16) / 255,
    Number.parseInt(value.slice(2, 4), 16) / 255,
    Number.parseInt(value.slice(4, 6), 16) / 255,
  );

/** No ligatures and no contextual alternates: one glyph for every letter, as in the `.docx`. */
const FEATURES = { liga: false, clig: false, dlig: false, calt: false };

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
}

/** A stretch of text in one style. */
interface Run {
  text: string;
  font: PDFFont;
  size: number;
  color: RGB;
}

/** A paragraph, ready to be broken into lines and placed. */
interface Block {
  /** Its structure role: the name, a heading, a paragraph or a list item. */
  role: "H1" | "H2" | "P" | "LI";
  /** Where it sits, in the author's words, for a refusal that names it. */
  where: string;
  runs: Run[];
  before: number;
  after: number;
  /** Where its lines start, and where the bullet sits if it has one. */
  indent: number;
  bullet: Run | null;
  /** Right-aligned on the first line, after everything else on it. */
  dates: Run | null;
  rule: boolean;
  keepNext: boolean;
}

interface Laid extends Block {
  lines: Run[][];
  /** The pitch of each line, set by its largest type. */
  pitches: number[];
}

export async function resumePdf(
  doc: ResumeDocument,
  paper: PaperSize,
  metadata: { title: string; author: string },
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const embed = (bytes: ArrayBuffer) => pdf.embedFont(bytes, { subset: false, features: FEATURES });
  const fonts: Fonts = {
    regular: await embed(regularFont),
    bold: await embed(boldFont),
    italic: await embed(italicFont),
  };

  pdf.setTitle(metadata.title, { showInWindowTitleBar: true });
  if (metadata.author) pdf.setAuthor(metadata.author);
  pdf.setLanguage("en");
  pdf.setCreator("Track Record");
  pdf.setProducer("Track Record");

  const size = { width: twips(PAGE[paper].width), height: twips(PAGE[paper].height) };
  const margin = twips(MARGIN);
  const textWidth = size.width - 2 * margin;

  const blocks = blocksFor(doc, fonts);
  refuseMissingGlyphs(blocks, fonts);
  const laid = blocks.map((block) => lay(block, textWidth));
  const tags = new Tags(pdf);
  place(pdf, tags, laid, size, margin, textWidth);
  tags.finish();
  return pdf.save();
}

/* ------------------------------------------------------------ the blocks */

function blocksFor(doc: ResumeDocument, fonts: Fonts): Block[] {
  const body = halfPoints(SIZE.body);
  const run = (text: string, font: PDFFont, size = body, color = BLACK): Run => ({ text, font, size, color });
  const plain = (runs: Run[], spacing: { before?: number; after?: number }, keepNext = false): Block => ({
    role: "P",
    where: "",
    runs,
    before: twips(spacing.before ?? 0),
    after: twips(spacing.after ?? 0),
    indent: 0,
    bullet: null,
    dates: null,
    rule: false,
    keepNext,
  });

  // No document title above the name, as in the `.docx`.
  const blocks: Block[] = [
    { ...plain([run(doc.name, fonts.bold, halfPoints(SIZE.name))], SPACE.name), role: "H1", where: "the name" },
  ];
  if (doc.headline !== null) {
    blocks.push({
      ...plain([run(doc.headline, fonts.regular, halfPoints(SIZE.headline), hex(ACCENT))], SPACE.headline),
      where: "the headline",
    });
  }
  if (doc.contact.length > 0) {
    blocks.push({
      ...plain([run(doc.contact.join(" · "), fonts.regular, halfPoints(SIZE.contact), hex(MUTED))], SPACE.contact),
      where: "the contact line",
    });
  }

  for (const section of doc.sections) {
    blocks.push({
      ...plain(smallCaps(section.heading, fonts.bold, halfPoints(SIZE.heading), hex(ACCENT)), SPACE.heading, true),
      role: "H2",
      where: `the ${section.heading} heading`,
      rule: true,
    });
    section.blocks.forEach((block, index) => {
      blocks.push({ ...blockFor(block, section.blocks[index + 1], fonts, run, plain), where: `the ${section.heading} section` });
    });
  }
  return blocks;
}

function blockFor(
  block: ResumeBlock,
  next: ResumeBlock | undefined,
  fonts: Fonts,
  run: (text: string, font: PDFFont, size?: number, color?: RGB) => Run,
  plain: (runs: Run[], spacing: { before?: number; after?: number }, keepNext?: boolean) => Block,
): Block {
  switch (block.kind) {
    case "entry":
      return {
        ...plain(
          [run(block.lead, fonts.bold), ...(block.detail ? [run(` · ${block.detail}`, fonts.regular)] : [])],
          SPACE.entry,
          // A job's header never ends a page apart from its first line under it.
          next !== undefined && next.kind !== "entry",
        ),
        dates: block.dates ? run(block.dates, fonts.regular, undefined, hex(MUTED)) : null,
      };
    case "subtitle":
      return plain([run(block.text, fonts.italic)], SPACE.subtitle, true);
    case "bullet":
      return {
        ...plain([run(block.text, fonts.regular)], SPACE.bullet),
        role: "LI",
        indent: twips(BULLET_INDENT.left),
        bullet: run("•", fonts.regular),
      };
    case "labelled":
      return plain([run(`${block.label}: `, fonts.bold), run(block.text, fonts.regular)], SPACE.labelled);
    case "paragraph":
      return plain([run(block.text, fonts.regular)], SPACE.paragraph);
  }
}

/**
 * Word's small capitals: a capital at full size, a lower-case letter drawn as
 * a capital at four fifths. Copied, the heading reads in capitals.
 */
function smallCaps(text: string, font: PDFFont, size: number, color: RGB): Run[] {
  const runs: Run[] = [];
  for (const [part] of text.matchAll(/\p{Ll}+|[^\p{Ll}]+/gu)) {
    const lower = /\p{Ll}/u.test(part);
    runs.push({ text: lower ? part.toUpperCase() : part, font, size: lower ? size * SMALL_CAP : size, color });
  }
  return runs;
}

/**
 * Carlito has no glyph for a ✓, a ★ or an emoji, and the PDF carries no other
 * font: such a character would be drawn as a blank and copied as nothing,
 * where Word's font fallback prints it in the `.docx`. The PDF is refused
 * instead, naming the character, as a name with no Latin letters is.
 * White space is not checked: `lay` sets every run of it as one space, as
 * Word shows a line break or a tab inside a run's text.
 */
function refuseMissingGlyphs(blocks: Block[], fonts: Fonts) {
  const covered = new Map<PDFFont, Set<number>>(
    Object.values(fonts).map((font) => [font, new Set(font.getCharacterSet())]),
  );
  for (const block of blocks) {
    for (const run of [...block.runs, block.bullet, block.dates]) {
      if (!run) continue;
      for (const char of run.text) {
        const code = char.codePointAt(0)!;
        if (/\s/u.test(char) || covered.get(run.font)!.has(code)) continue;
        const name = `U+${code.toString(16).toUpperCase().padStart(4, "0")}`;
        throw new ResumeAssemblyError(
          `The PDF cannot show “${char}” (${name}) in ${block.where}. Remove it, or download the Word file instead.`,
        );
      }
    }
  }
}

/* ------------------------------------------------------------ the lines */

const widthOf = (run: Run) => run.font.widthOfTextAtSize(run.text, run.size);

function lay(block: Block, textWidth: number): Laid {
  // The dates take their width and a gap of two spaces off the first line.
  const reserved = block.dates ? widthOf(block.dates) + block.dates.size : 0;
  const lines: Run[][] = [[]];
  let used = 0;

  for (const run of block.runs) {
    for (const [token] of run.text.matchAll(/\s+|\S+/g)) {
      const isSpace = /^\s+$/.test(token);
      let remaining = isSpace ? " " : token;
      while (remaining) {
        const room = textWidth - block.indent - (lines.length === 1 ? reserved : 0);
        const line = lines[lines.length - 1]!;
        const width = widthOf({ ...run, text: remaining });
        if (isSpace && used === 0 && lines.length > 1) break;
        if (used + width <= room) {
          append(line, { ...run, text: remaining });
          used += width;
          break;
        }
        // A space that does not fit hangs past the margin, as in Word, and starts no line.
        if (isSpace) break;
        if (used > 0) {
          while (line.length > 0 && /^\s+$/.test(line[line.length - 1]!.text)) line.pop();
          lines.push([]);
          used = 0;
          continue;
        }
        let fragment = "";
        for (const char of remaining) {
          if (widthOf({ ...run, text: fragment + char }) > room) break;
          fragment += char;
        }
        if (!fragment && lines.length === 1 && reserved > 0) {
          lines.push([]);
          continue;
        }
        if (!fragment) throw new Error("A résumé character is wider than its PDF column.");
        append(line, { ...run, text: fragment });
        used = widthOf({ ...run, text: fragment });
        remaining = remaining.slice(fragment.length);
      }
    }
  }

  while (lines.length > 1 && lines[lines.length - 1]!.length === 0) lines.pop();
  const pitches = lines.map((line) => Math.max(...line.map((r) => r.size), block.runs[0]?.size ?? 0) * PITCH);
  return { ...block, lines, pitches };
}

/** Joins a token to the line's last run when the style is the same, so a line is drawn in as few pieces as it has styles. */
function append(line: Run[], piece: Run) {
  const last = line[line.length - 1];
  if (last && last.font === piece.font && last.size === piece.size && last.color === piece.color) {
    last.text += piece.text;
  } else {
    line.push(piece);
  }
}

/* ------------------------------------------------------------ the pages */

function place(
  pdf: PDFDocument,
  tags: Tags,
  blocks: Laid[],
  size: { width: number; height: number },
  margin: number,
  textWidth: number,
) {
  const top = size.height - margin;
  const bottom = margin;
  let page: PDFPage = pdf.addPage([size.width, size.height]);
  let y = top;
  const newPage = () => {
    page = pdf.addPage([size.width, size.height]);
    y = top;
  };

  const height = (block: Laid, from = 0, to = block.lines.length) =>
    block.pitches.slice(from, to).reduce((sum, pitch) => sum + pitch, 0);

  // A run of bullets is one list.
  let list: PDFRef | null = null;
  // The space after the block above, owed until the next one is placed.
  let after = 0;

  blocks.forEach((block, index) => {
    // Between two paragraphs Word leaves the larger of the space after the
    // first and the space before the second, not both — measured against its
    // own PDF of the same résumé. None is left at the head of a page.
    const before = y === top ? 0 : Math.max(after, block.before);
    // A paragraph of three lines or fewer is never split, and a longer one
    // leaves at least two lines on each page: Word's widow and orphan control.
    const unsplittable = block.keepNext || block.lines.length <= 3;
    if (y - before - roomFor(blocks, index, height) < bottom && y !== top) newPage();
    else y -= before;

    if (block.role !== "LI") list = null;
    let element: PDFRef;
    let label: PDFRef | null = null;
    if (block.role === "LI") {
      list ??= tags.element("L", tags.root);
      const item = tags.element("LI", list);
      label = tags.element("Lbl", item);
      element = tags.element("LBody", item);
    } else {
      element = tags.element(block.role, tags.root);
    }

    block.lines.forEach((line, lineIndex) => {
      const pitch = block.pitches[lineIndex]!;
      const remaining = block.lines.length - lineIndex;
      const keepsTwo = !unsplittable && remaining === 2;
      if (y - (keepsTwo ? pitch + block.pitches[lineIndex + 1]! : pitch) < bottom && y !== top) newPage();

      const lineSize = pitch / PITCH;
      const baseline = y - lineSize * ASCENT;
      let x = margin + block.indent;
      if (lineIndex === 0 && block.bullet && label) {
        const bullet = block.bullet;
        tags.mark(page, label, () => draw(page, bullet, margin + block.indent - twips(BULLET_INDENT.hanging), baseline));
      }
      tags.mark(page, element, () => {
        for (const run of line) {
          draw(page, run, x, baseline);
          x += widthOf(run);
        }
        if (lineIndex === 0 && block.dates) {
          draw(page, block.dates, margin + textWidth - widthOf(block.dates), baseline);
        }
      });
      y -= pitch;
    });

    if (block.rule) {
      // Word's bottom border: its gap below the text, then the rule, then the space after.
      const thickness = RULE.size / 8;
      const at = y - RULE.space - thickness / 2;
      tags.artifact(page, () =>
        page.drawLine({
          start: { x: margin, y: at },
          end: { x: margin + textWidth, y: at },
          thickness,
          color: hex(ACCENT),
        }),
      );
      y -= RULE.space + thickness;
    }
    after = block.after;
  });
}

function roomFor(blocks: Laid[], index: number, height: (block: Laid, from?: number, to?: number) => number): number {
  const block = blocks[index]!;
  const whole = (item: Laid) => height(item) + (item.rule ? RULE.space + RULE.size / 8 : 0);
  if (!block.keepNext) return block.lines.length <= 3 ? whole(block) : height(block, 0, 2);
  let needed = whole(block);
  for (let i = index; blocks[i]!.keepNext && blocks[i + 1]; i++) {
    const next = blocks[i + 1]!;
    needed += Math.max(blocks[i]!.after, next.before) +
      (next.keepNext || next.lines.length <= 3 ? whole(next) : height(next, 0, 2));
  }
  return needed;
}

function draw(page: PDFPage, run: Run, x: number, y: number) {
  if (run.text === "") return;
  page.drawText(run.text, { x, y, size: run.size, font: run.font, color: run.color });
}

/* ------------------------------------------------------------- the tags */

/**
 * A tagged PDF's structure tree (ISO 32000-1 §14.7–14.8): each piece of the
 * page is drawn inside a marked-content sequence with an id, and a tree of
 * elements in reading order names those ids. A paragraph that runs onto the
 * next page holds one id on each.
 */
class Tags {
  readonly root: PDFRef;
  private readonly tree: PDFRef;
  /** For each page, the element each of its ids belongs to, in id order. */
  private readonly pages = new Map<PDFPage, PDFRef[]>();

  constructor(private readonly pdf: PDFDocument) {
    this.tree = pdf.context.nextRef();
    this.root = pdf.context.register(pdf.context.obj({ Type: "StructElem", S: "Document", P: this.tree, K: [] }));
  }

  /** A new element, last among its parent's children. */
  element(role: string, parent: PDFRef): PDFRef {
    const ref = this.pdf.context.register(this.pdf.context.obj({ Type: "StructElem", S: role, P: parent, K: [] }));
    this.kids(parent).push(ref);
    return ref;
  }

  /** Draws content that belongs to `element`. */
  mark(page: PDFPage, element: PDFRef, draw: () => void) {
    const parents = this.pages.get(page) ?? [];
    this.pages.set(page, parents);
    const id = parents.length;
    parents.push(element);
    const role = this.pdf.context.lookup(element, PDFDict).get(PDFName.of("S")) as PDFName;
    page.pushOperators(
      // The property list is written as it stands: an operator takes no dictionary.
      PDFOperator.of(PDFOperatorNames.BeginMarkedContentSequence, [role, `<< /MCID ${id} >>`]),
    );
    draw();
    page.pushOperators(PDFOperator.of(PDFOperatorNames.EndMarkedContent));
    this.kids(element).push(this.pdf.context.obj({ Type: "MCR", Pg: page.ref, MCID: id }));
  }

  /** Draws decoration a reader skips. */
  artifact(page: PDFPage, draw: () => void) {
    page.pushOperators(PDFOperator.of(PDFOperatorNames.BeginMarkedContent, [PDFName.of("Artifact")]));
    draw();
    page.pushOperators(PDFOperator.of(PDFOperatorNames.EndMarkedContent));
  }

  /** Writes the tree, each page's entry in the parent tree, and the flag that says the file is tagged. */
  finish() {
    const { context, catalog } = this.pdf;
    const nums: (number | PDFRef[])[] = [];
    this.pdf.getPages().forEach((page, index) => {
      page.node.set(PDFName.of("StructParents"), PDFNumber.of(index));
      nums.push(index, this.pages.get(page) ?? []);
    });
    context.assign(
      this.tree,
      context.obj({
        Type: "StructTreeRoot",
        K: this.root,
        ParentTree: context.register(context.obj({ Nums: nums })),
        ParentTreeNextKey: this.pdf.getPageCount(),
      }),
    );
    catalog.set(PDFName.of("StructTreeRoot"), this.tree);
    catalog.set(PDFName.of("MarkInfo"), context.obj({ Marked: true }));
  }

  private kids(element: PDFRef): PDFArray {
    return this.pdf.context.lookup(element, PDFDict).get(PDFName.of("K")) as PDFArray;
  }
}
