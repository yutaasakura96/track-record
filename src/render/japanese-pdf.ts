/**
 * The 職務経歴書's PDF (issue #117, review S7), from the same document and the
 * same numbers as its `.docx` (`./japanese-docx.ts`).
 *
 * doda and Recruit both recommend sending a Japanese application as a PDF
 * unless the employer asks for Word, so the PDF is the default download and
 * Word sits beside it, as for the English résumé (`./resume-pdf.ts`), whose
 * runtime and rules this follows: `pdf-lib` inside workerd, assembled on
 * request and never stored, every word drawn in reading order, and the file
 * tagged so a reader that copies by position takes the period after its
 * company rather than as a column of its own.
 *
 * BIZ UDPGothic is embedded, regular and bold: the face the `.docx` names, so
 * a line breaks where Word breaks it on a machine that has the face. Only the
 * outlines the page draws are embedded (`./font-subset.ts`).
 */
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFPage, type PDFRef } from "pdf-lib";
import regularFace from "../../templates/fonts/BIZUDPGothic-Regular.ttf";
import boldFace from "../../templates/fonts/BIZUDPGothic-Bold.ttf";
import type { JapaneseBlock, JapaneseDocument } from "./japanese";
import {
  JA_BULLET,
  JA_MARGIN,
  JA_PAGE,
  JA_RULE,
  JA_SIZE,
  JA_SPACE,
  JA_TEXT_WIDTH,
  jaLine,
  rowLabel,
} from "./japanese-docx";
import { Tags } from "./pdf-tags";
import { breakLines, embedFace, refuseMissing, widthOf, type PdfRun } from "./pdf-text";

/** BIZ UDPGothic's vertical metrics (2048 units a square): 1802 above the baseline, 246 below. */
const ASCENT = 1802 / 2048;
const DESCENT = 246 / 2048;

const BLACK = rgb(0, 0, 0);
const twips = (value: number) => value / 20;
const points = (halfPoints: number) => halfPoints / 2;

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
}

/** A paragraph, ready to be broken into lines and placed. */
interface Block {
  role: "H1" | "H2" | "H3" | "P" | "LI";
  where: string;
  runs: PdfRun[];
  align: "start" | "center" | "end";
  before: number;
  after: number;
  /** The exact line height, in points. */
  pitch: number;
  indent: number;
  bullet: PdfRun | null;
  /** Right-aligned on the first line, after everything else on it. */
  dates: PdfRun | null;
  rule: boolean;
  keepNext: boolean;
}

interface Laid extends Block {
  lines: PdfRun[][];
}

/** What a block holds before the faces exist: the text, and which face each part is set in. */
type Draft = Omit<Block, "runs" | "bullet" | "dates"> & {
  runs: { text: string; bold: boolean; size: number }[];
  bullet: string | null;
  dates: { text: string; size: number } | null;
};

export async function japanesePdf(doc: JapaneseDocument, metadata: { title: string; author: string }): Promise<Uint8Array> {
  const drafts = draftsFor(doc);
  // Every character is checked against the face it is set in before anything
  // is drawn, and the faces are then cut to exactly those characters.
  const text = { regular: "", bold: "" };
  for (const draft of drafts) {
    for (const run of draft.runs) {
      refuseMissing(run.bold ? boldFace : regularFace, run.text, draft.where);
      text[run.bold ? "bold" : "regular"] += run.text;
    }
    for (const extra of [draft.bullet, draft.dates?.text]) {
      if (!extra) continue;
      refuseMissing(regularFace, extra, draft.where);
      text.regular += extra;
    }
  }

  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const fonts: Fonts = {
    regular: await embedFace(pdf, regularFace, text.regular),
    bold: await embedFace(pdf, boldFace, text.bold || " "),
  };
  pdf.setTitle(metadata.title, { showInWindowTitleBar: true });
  if (metadata.author) pdf.setAuthor(metadata.author);
  pdf.setLanguage("ja-JP");
  pdf.setCreator("Track Record");
  pdf.setProducer("Track Record");

  const blocks: Block[] = drafts.map((draft) => {
    const run = (text: string, bold: boolean, size: number): PdfRun => ({ text, font: bold ? fonts.bold : fonts.regular, size, color: BLACK });
    return {
      ...draft,
      runs: draft.runs.map((r) => run(r.text, r.bold, r.size)),
      bullet: draft.bullet ? run(draft.bullet, false, points(JA_SIZE.body)) : null,
      dates: draft.dates ? run(draft.dates.text, false, draft.dates.size) : null,
    };
  });
  const textWidth = twips(JA_TEXT_WIDTH);
  const laid = blocks.map((block): Laid => {
    const width = textWidth - block.indent;
    // The date takes its width and a gap of one character off the first line.
    const reserved = block.dates ? widthOf(block.dates) + block.dates.size : 0;
    return { ...block, lines: breakLines(block.runs, width, width - reserved) };
  });

  const tags = new Tags(pdf);
  place(pdf, tags, laid);
  tags.finish();
  return pdf.save();
}

/* ------------------------------------------------------------ the blocks */

function draftsFor(doc: JapaneseDocument): Draft[] {
  const plain = (
    runs: Draft["runs"],
    size: number,
    space: { before: number; after: number },
    where: string,
    extra: Partial<Draft> = {},
  ): Draft => ({
    role: "P",
    where,
    runs,
    align: "start",
    before: twips(space.before),
    after: twips(space.after),
    pitch: twips(jaLine(size)),
    indent: 0,
    bullet: null,
    dates: null,
    rule: false,
    keepNext: false,
    ...extra,
  });
  const text = (value: string, size: number, bold = false) => ({ text: value, size: points(size), bold });

  const drafts: Draft[] = [
    plain([text(doc.title, JA_SIZE.title, true)], JA_SIZE.title, JA_SPACE.title, "the title", { role: "H1", align: "center" }),
  ];
  const align = doc.stamp ? "end" : "center";
  if (doc.stamp) drafts.push(plain([text(doc.stamp, JA_SIZE.stamp)], JA_SIZE.stamp, JA_SPACE.stamp, "the date", { align }));
  if (doc.name) drafts.push(plain([text(doc.name, JA_SIZE.name, true)], JA_SIZE.name, JA_SPACE.name, "the name", { align }));
  for (const line of doc.contact) {
    drafts.push(plain([text(line, JA_SIZE.stamp)], JA_SIZE.stamp, JA_SPACE.contact, "the contact line", { align }));
  }

  for (const section of doc.sections) {
    const where = `the ${section.heading} section`;
    drafts.push(
      plain([text(section.heading, JA_SIZE.heading, true)], JA_SIZE.heading, JA_SPACE.heading, `the ${section.heading} heading`, {
        role: "H2",
        rule: true,
        keepNext: true,
      }),
    );
    section.blocks.forEach((block, index) => drafts.push(...draftFor(block, section.blocks[index + 1], where, plain, text)));
  }
  return drafts;
}

function draftFor(
  block: JapaneseBlock,
  next: JapaneseBlock | undefined,
  where: string,
  plain: (runs: Draft["runs"], size: number, space: { before: number; after: number }, where: string, extra?: Partial<Draft>) => Draft,
  text: (value: string, size: number, bold?: boolean) => Draft["runs"][number],
): Draft[] {
  const body = JA_SIZE.body;
  if (block.kind === "employer") {
    const header = plain(
      [text(block.name, JA_SIZE.employer, true), text(`　${block.employment}`, JA_SIZE.employer)],
      JA_SIZE.employer,
      JA_SPACE.employer,
      `${block.name}'s header`,
      { role: "H3", keepNext: true, dates: { text: block.period, size: points(JA_SIZE.employer) } },
    );
    if (!block.roles) return [header];
    return [header, plain([text(block.roles, body)], body, JA_SPACE.roles, `${block.name}'s header`, { keepNext: true })];
  }
  if (block.kind === "bullet") {
    return [
      plain([text(block.text, body)], body, JA_SPACE.bullet, where, {
        role: "LI",
        indent: twips(JA_BULLET.left),
        bullet: JA_BULLET.mark,
      }),
    ];
  }
  const label = block.kind === "row" ? rowLabel(block.text) : null;
  return [
    plain(label ? [text(label.label, body, true), text(label.rest, body)] : [text(block.text, body)], body, JA_SPACE[block.kind], where, {
      keepNext: block.kind === "row" && next !== undefined && next.kind !== "employer" && block.text.endsWith("："),
    }),
  ];
}

/* ------------------------------------------------------------ the pages */

function place(pdf: PDFDocument, tags: Tags, blocks: Laid[]) {
  const size = { width: twips(JA_PAGE.width), height: twips(JA_PAGE.height) };
  const margin = twips(JA_MARGIN);
  const textWidth = twips(JA_TEXT_WIDTH);
  const top = size.height - margin;
  const bottom = margin;
  let page: PDFPage = pdf.addPage([size.width, size.height]);
  let y = top;
  const newPage = () => {
    page = pdf.addPage([size.width, size.height]);
    y = top;
  };

  let list: PDFRef | null = null;
  let after = 0;

  blocks.forEach((block, index) => {
    // Between two paragraphs, the larger of the space after the first and
    // before the second, as the résumé's PDF measured Word to leave; none at
    // the head of a page.
    const before = y === top ? 0 : Math.max(after, block.before);
    const unsplittable = block.keepNext || block.lines.length <= 3;
    if (y - before - roomFor(blocks, index) < bottom && y !== top) newPage();
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
      const remaining = block.lines.length - lineIndex;
      const keepsTwo = !unsplittable && remaining === 2;
      if (y - (keepsTwo ? 2 : 1) * block.pitch < bottom && y !== top) newPage();

      // Exact line height: the text sits in the middle of its line.
      const largest = Math.max(...line.map((r) => r.size), block.runs[0]?.size ?? 0);
      const baseline = y - (block.pitch - largest * (ASCENT + DESCENT)) / 2 - largest * ASCENT;
      const lineWidth = line.reduce((sum, r) => sum + widthOf(r), 0);
      let x = margin + block.indent;
      if (block.align === "center") x = margin + (textWidth - lineWidth) / 2;
      if (block.align === "end") x = margin + textWidth - lineWidth;

      if (lineIndex === 0 && block.bullet && label) {
        const bullet = block.bullet;
        tags.mark(page, label, () => draw(page, bullet, margin + block.indent - twips(JA_BULLET.hanging), baseline));
      }
      tags.mark(page, element, () => {
        for (const run of line) {
          draw(page, run, x, baseline);
          x += widthOf(run);
        }
        if (lineIndex === 0 && block.dates) draw(page, block.dates, margin + textWidth - widthOf(block.dates), baseline);
      });
      y -= block.pitch;
    });

    if (block.rule) {
      const thickness = JA_RULE.size / 8;
      const at = y - JA_RULE.space - thickness / 2;
      tags.artifact(page, () =>
        page.drawLine({ start: { x: margin, y: at }, end: { x: margin + textWidth, y: at }, thickness, color: BLACK }),
      );
      y -= JA_RULE.space + thickness;
    }
    after = block.after;
  });
}

/** The height a block needs on this page: all of a short or kept one, and its followers while it keeps with them. */
function roomFor(blocks: Laid[], index: number): number {
  const block = blocks[index]!;
  const whole = (item: Laid) => item.lines.length * item.pitch + (item.rule ? JA_RULE.space + JA_RULE.size / 8 : 0);
  const least = (item: Laid) => (item.keepNext || item.lines.length <= 3 ? whole(item) : 2 * item.pitch);
  if (!block.keepNext) return least(block);
  let needed = whole(block);
  for (let i = index; blocks[i]!.keepNext && blocks[i + 1]; i++) {
    const next = blocks[i + 1]!;
    needed += Math.max(blocks[i]!.after, next.before) + least(next);
  }
  return needed;
}

function draw(page: PDFPage, run: PdfRun, x: number, y: number) {
  if (run.text === "") return;
  page.drawText(run.text, { x, y, size: run.size, font: run.font, color: run.color });
}
