/**
 * The English résumé's `.docx` (issue #107), from the document `./resume.ts`
 * assembles.
 *
 * Built to be parsed as well as read (§4.3 of the 2026-10-17 evaluation, and
 * Greenhouse's list of what breaks a parse): one column, no tables or text
 * boxes, nothing in a Word header or footer, real list paragraphs for the
 * bullets, and the dates on a right tab stop rather than in a second column.
 * One sans-serif family throughout — Calibri, which Google Docs has and
 * LibreOffice substitutes metric-for-metric with Carlito.
 *
 * Like every download it is assembled on request and never stored
 * (`docs/03` §6), and PRD §8 rates a file Word will not open as severe as data
 * loss: opening it in real Word is `docs/11` §3 checklist item 1.
 */
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  Tab,
  TabStopType,
  TextRun,
} from "docx";
import type { ResumeBlock, ResumeDocument } from "./resume";

export type PaperSize = "a4" | "letter";

/*
 * The layout's numbers, exported because the PDF (`./resume-pdf.ts`) is set
 * from the same ones: two files of one document must not drift apart.
 */

/** Twips. A4 is 210 × 297 mm; Letter 8.5 × 11 in. */
export const PAGE: Record<PaperSize, { width: number; height: number }> = {
  a4: { width: 11906, height: 16838 },
  letter: { width: 12240, height: 15840 },
};

/** 15.5 mm on every side, inside §4.3's 15–16 mm. */
export const MARGIN = 879;

export const FONT = "Calibri";

/** One accent, for the section headings and their rule; grey for the contact line and the dates. */
export const ACCENT = "1F3A5F";
export const MUTED = "4A4F59";

/** Half-points. Body 10pt, name 20pt, headline 11pt, headings 10.5pt, contact 9.5pt. */
export const SIZE = { body: 20, name: 40, headline: 22, heading: 21, contact: 19 };

/** Line pitch in 240ths of single spacing: 1.05 lines. */
export const LINE = 252;

/** Twips of space around each kind of paragraph. */
export const SPACE = {
  name: { after: 40 },
  headline: { after: 40 },
  contact: { after: 80 },
  heading: { before: 200, after: 80 },
  entry: { before: 80 },
  subtitle: { after: 20 },
  bullet: { after: 20 },
  labelled: { after: 20 },
  paragraph: { after: 40 },
};

/** Twips. The bullet hangs 200 left of its text, which starts 284 in. */
export const BULLET_INDENT = { left: 284, hanging: 200 };

/** Eighths of a point: the rule under a heading, and its gap in points. */
export const RULE = { size: 6, space: 1 };

const BULLETS = "resume-bullets";

export async function resumeDocx(
  doc: ResumeDocument,
  paper: PaperSize,
  metadata: { title: string; author: string },
): Promise<Uint8Array> {
  const page = PAGE[paper];
  const textWidth = page.width - 2 * MARGIN;

  const children: Paragraph[] = [
    // No document title above the name: "Résumé (English)" was the app's name
    // for the file, printed at the top of the page an employer reads.
    new Paragraph({
      children: [new TextRun({ text: doc.name, bold: true, size: SIZE.name })],
      spacing: SPACE.name,
    }),
  ];
  if (doc.headline !== null) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: doc.headline, size: SIZE.headline, color: ACCENT })],
        spacing: SPACE.headline,
      }),
    );
  }
  if (doc.contact.length > 0) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: doc.contact.join(" · "), size: SIZE.contact, color: MUTED })],
        spacing: SPACE.contact,
      }),
    );
  }

  for (const section of doc.sections) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun(section.heading)],
        border: { bottom: { style: BorderStyle.SINGLE, size: RULE.size, color: ACCENT, space: RULE.space } },
      }),
    );
    section.blocks.forEach((block, index) => {
      const next = section.blocks[index + 1];
      children.push(paragraphFor(block, textWidth, next));
    });
  }

  const document = new Document({
    title: metadata.title,
    ...(metadata.author ? { creator: metadata.author, lastModifiedBy: metadata.author } : {}),
    styles: {
      default: {
        document: { run: { font: FONT, size: SIZE.body }, paragraph: { spacing: { after: 0, line: LINE } } },
        heading2: {
          run: { font: FONT, size: SIZE.heading, bold: true, smallCaps: true, color: ACCENT },
          paragraph: { spacing: SPACE.heading, keepNext: true },
        },
      },
    },
    numbering: {
      config: [
        {
          reference: BULLETS,
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: "•",
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: BULLET_INDENT } },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: page,
            margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN },
          },
        },
        children,
      },
    ],
  });
  return new Uint8Array(await Packer.toBuffer(document));
}

function paragraphFor(block: ResumeBlock, textWidth: number, next: ResumeBlock | undefined): Paragraph {
  switch (block.kind) {
    case "entry":
      return new Paragraph({
        tabStops: [{ type: TabStopType.RIGHT, position: textWidth }],
        // A job's header never ends a page apart from its first line under it.
        keepNext: next !== undefined && next.kind !== "entry",
        spacing: SPACE.entry,
        children: [
          new TextRun({ text: block.lead, bold: true }),
          ...(block.detail ? [new TextRun(` · ${block.detail}`)] : []),
          ...(block.dates ? [new TextRun({ children: [new Tab(), block.dates], color: MUTED })] : []),
        ],
      });
    case "subtitle":
      return new Paragraph({
        keepNext: true,
        spacing: SPACE.subtitle,
        children: [new TextRun({ text: block.text, italics: true })],
      });
    case "bullet":
      return new Paragraph({
        numbering: { reference: BULLETS, level: 0 },
        spacing: SPACE.bullet,
        children: [new TextRun(block.text)],
      });
    case "labelled":
      return new Paragraph({
        spacing: SPACE.labelled,
        children: [new TextRun({ text: `${block.label}: `, bold: true }), new TextRun(block.text)],
      });
    case "paragraph":
      return new Paragraph({ spacing: SPACE.paragraph, children: [new TextRun(block.text)] });
  }
}
