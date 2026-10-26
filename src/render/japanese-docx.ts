/**
 * The 職務経歴書's and the Japanese career story's `.docx` (issue #117,
 * review §4.1 S1–S3, S6), from the document in `./japanese.ts`.
 *
 * - **One family for both scripts.** Every run names BIZ UDPGothic for its
 *   Latin, East Asian and complex-script text alike, and every run is marked
 *   `ja-JP`, so Word sets `Java（Spring Batch）` in one typeface and breaks a
 *   line as Japanese breaks. Before, no run named a font: Latin fell to Times
 *   New Roman and Japanese to whatever Word chose, and the file named Times
 *   New Roman nowhere and still printed it. Now no part of the file names it.
 *   The PDF embeds the same face (`./japanese-pdf.ts`), so the two print alike.
 * - **BIZ UDPGothic is Morisawa's**, released under the SIL Open Font License,
 *   and ships with Windows 10 and later; a Word without it substitutes a
 *   Japanese gothic by the `w:font` entry this file carries for it (its
 *   Japanese name, its character set and its PANOSE class).
 * - **Headings are black, bold and ruled**, not the library's blue Heading 2,
 *   and each employer opens on a header line of its own: 会社名 in bold with its
 *   雇用形態 beside it, and the period set to the right margin.
 *
 * Line heights are exact, in points, rather than Word's "single" for the font:
 * a height that does not depend on the font Word finds is the same height the
 * PDF draws, so the two break pages in the same places.
 */
import {
  AlignmentType,
  BorderStyle,
  Document,
  LevelFormat,
  LineRuleType,
  Packer,
  Paragraph,
  Tab,
  TabStopType,
  TextRun,
  type IParagraphOptions,
  type IRunOptions,
} from "docx";
import PizZip from "pizzip";
import { documentAuthor, type RenderIdentity } from "./identity";
import type { JapaneseBlock, JapaneseDocument } from "./japanese";

/** A4, in twips, with 20 mm margins: the page doda's samples print on. */
export const JA_PAGE = { width: 11906, height: 16838 };
export const JA_MARGIN = 1134;
export const JA_TEXT_WIDTH = JA_PAGE.width - 2 * JA_MARGIN;

/** The face, as Word names it and as Japanese Word lists it. */
export const JA_FONT = "BIZ UDPGothic";
const JA_FONT_LOCAL = "BIZ UDPゴシック";

/** Run sizes, in half-points: 10.5 pt body, the size of a Japanese business document. */
export const JA_SIZE = { title: 32, stamp: 21, name: 24, heading: 24, employer: 22, body: 21 };

/** Line pitch as a multiple of the type size: Japanese body text sets at about one and a half. */
export const JA_LINE_FACTOR = 1.5;
/** The exact line height for a size in half-points, in twips. */
export const jaLine = (halfPoints: number) => Math.round(halfPoints * 10 * JA_LINE_FACTOR);

/** Space before and after each kind of paragraph, in twips. */
export const JA_SPACE = {
  title: { before: 0, after: 240 },
  stamp: { before: 0, after: 0 },
  name: { before: 0, after: 120 },
  contact: { before: 0, after: 0 },
  heading: { before: 360, after: 120 },
  employer: { before: 240, after: 40 },
  roles: { before: 0, after: 80 },
  row: { before: 0, after: 40 },
  bullet: { before: 0, after: 40 },
  paragraph: { before: 0, after: 120 },
};

/** The heading's rule: a single line of 0.75 pt (`w:sz` is eighths), one point under the text. */
export const JA_RULE = { size: 6, space: 1 };

/** The list mark and its indent, in twips: a ・ hanging one character. */
export const JA_BULLET = { mark: "・", left: 420, hanging: 210 };

/** A row's label, bolded: 「事業内容：」, 「技術スタック：」. Up to the first full-width colon, and short. */
export function rowLabel(text: string): { label: string; rest: string } | null {
  const at = text.indexOf("：");
  if (at <= 0 || at > 8) return null;
  return { label: text.slice(0, at + 1), rest: text.slice(at + 1) };
}

const FONT = { ascii: JA_FONT, hAnsi: JA_FONT, eastAsia: JA_FONT, cs: JA_FONT };
const LANGUAGE = { value: "ja-JP", eastAsia: "ja-JP" };

const run = (text: string, size: number, options: Omit<IRunOptions, "text" | "size"> = {}) =>
  new TextRun({ text, size, ...options });

const spacing = (halfPoints: number, space: { before: number; after: number }) => ({
  ...space,
  line: jaLine(halfPoints),
  lineRule: LineRuleType.EXACT,
});

export async function japaneseDocx(doc: JapaneseDocument, identity: RenderIdentity): Promise<Uint8Array> {
  const children: Paragraph[] = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: spacing(JA_SIZE.title, JA_SPACE.title),
      children: [run(doc.title, JA_SIZE.title, { bold: true })],
    }),
  ];

  // A dated document puts the date and the name together at the top right;
  // an undated one, the story, centres its name under the title.
  const align = doc.stamp ? AlignmentType.RIGHT : AlignmentType.CENTER;
  if (doc.stamp) {
    children.push(new Paragraph({ alignment: align, spacing: spacing(JA_SIZE.stamp, JA_SPACE.stamp), children: [run(doc.stamp, JA_SIZE.stamp)] }));
  }
  if (doc.name) {
    children.push(new Paragraph({ alignment: align, spacing: spacing(JA_SIZE.name, JA_SPACE.name), children: [run(doc.name, JA_SIZE.name, { bold: true })] }));
  }
  for (const line of doc.contact) {
    children.push(new Paragraph({ alignment: align, spacing: spacing(JA_SIZE.stamp, JA_SPACE.contact), children: [run(line, JA_SIZE.stamp)] }));
  }

  for (const section of doc.sections) {
    children.push(
      new Paragraph({
        keepNext: true,
        spacing: spacing(JA_SIZE.heading, JA_SPACE.heading),
        border: { bottom: { style: BorderStyle.SINGLE, size: JA_RULE.size, space: JA_RULE.space, color: "000000" } },
        children: [run(section.heading, JA_SIZE.heading, { bold: true })],
      }),
    );
    section.blocks.forEach((block, index) => children.push(...paragraphsFor(block, section.blocks[index + 1])));
  }

  const author = documentAuthor(doc.kind, identity);
  const document = new Document({
    title: doc.title,
    ...(author ? { creator: author, lastModifiedBy: author } : {}),
    styles: {
      default: {
        document: { run: { font: FONT, size: JA_SIZE.body, language: LANGUAGE } },
        // Word's built-in heading and title styles name their own fonts and
        // colours; nothing here uses them, and the defaults are restated so a
        // style the library writes cannot carry another typeface in.
        heading1: { run: { font: FONT, color: "000000" } },
        heading2: { run: { font: FONT, color: "000000" } },
        title: { run: { font: FONT, color: "000000" } },
      },
    },
    numbering: {
      config: [
        {
          reference: "ja-bullet",
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: JA_BULLET.mark,
              alignment: AlignmentType.LEFT,
              style: {
                paragraph: { indent: { left: JA_BULLET.left, hanging: JA_BULLET.hanging } },
                run: { font: FONT },
              },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: JA_PAGE.width, height: JA_PAGE.height },
            margin: { top: JA_MARGIN, bottom: JA_MARGIN, left: JA_MARGIN, right: JA_MARGIN, header: 567, footer: 567 },
          },
        },
        children,
      },
    ],
  });
  return withJapaneseFontTable(new Uint8Array(await Packer.toBuffer(document)));
}

function paragraphsFor(block: JapaneseBlock, next: JapaneseBlock | undefined): Paragraph[] {
  const body = JA_SIZE.body;
  if (block.kind === "employer") {
    const header = new Paragraph({
      keepNext: true,
      spacing: spacing(JA_SIZE.employer, JA_SPACE.employer),
      tabStops: [{ type: TabStopType.RIGHT, position: JA_TEXT_WIDTH }],
      children: [
        run(block.name, JA_SIZE.employer, { bold: true }),
        run(`　${block.employment}`, JA_SIZE.employer),
        new TextRun({ children: [new Tab(), block.period], size: JA_SIZE.employer }),
      ],
    });
    if (!block.roles) return [header];
    return [header, new Paragraph({ keepNext: true, spacing: spacing(body, JA_SPACE.roles), children: [run(block.roles, body)] })];
  }

  const options: IParagraphOptions = {
    spacing: spacing(body, JA_SPACE[block.kind]),
    // A row that introduces what follows (技術的成果：, 主な実績：) stays with it.
    keepNext: block.kind === "row" && next !== undefined && next.kind !== "employer" && block.text.endsWith("："),
  };
  if (block.kind === "bullet") {
    return [new Paragraph({ ...options, numbering: { reference: "ja-bullet", level: 0 }, children: [run(block.text, body)] })];
  }
  const label = block.kind === "row" ? rowLabel(block.text) : null;
  return [
    new Paragraph({
      ...options,
      children: label
        ? [run(label.label, body, { bold: true }), ...(label.rest ? [run(label.rest, body)] : [])]
        : [run(block.text, body)],
    }),
  ];
}

/**
 * The library writes no `w:font` entry for a font a run names, so a Word that
 * lacks BIZ UDPGothic would have nothing to substitute by. One is added: its
 * Japanese name, the Shift-JIS character set (80) and a sans-serif PANOSE,
 * which is what a Word without the face matches a Japanese gothic on.
 */
function withJapaneseFontTable(bytes: Uint8Array): Uint8Array {
  return rewritePart(bytes, "word/fontTable.xml", (xml) => {
    const entry =
      `<w:font w:name="${JA_FONT}"><w:altName w:val="${JA_FONT_LOCAL}"/><w:panose1 w:val="020B0400000000000000"/>` +
      `<w:charset w:val="80"/><w:family w:val="swiss"/><w:pitch w:val="variable"/></w:font>`;
    // The library writes the table empty, as `<w:fonts …/>`.
    return /<\/w:fonts>\s*$/.test(xml)
      ? xml.replace(/<\/w:fonts>\s*$/, `${entry}</w:fonts>`)
      : xml.replace(/<w:fonts\b([^>]*?)\/>\s*$/, `<w:fonts$1>${entry}</w:fonts>`);
  });
}

function rewritePart(bytes: Uint8Array, part: string, edit: (xml: string) => string): Uint8Array {
  const zip = new PizZip(bytes);
  const file = zip.file(part);
  if (!file) return bytes;
  zip.file(part, edit(file.asText()));
  return zip.generate({ type: "uint8array", compression: "DEFLATE" });
}
