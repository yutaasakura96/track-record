/**
 * `.docx` assembly (`docs/03-technical-design.md` §6).
 *
 * Assembled from the stored `RenderContent` on each download and NEVER stored.
 * A failure here fails the download and leaves the stored content untouched —
 * a bad build can never destroy a good document.
 *
 * PRD §8 rates a `.docx` that will not open in Word as as severe as data loss.
 * No automated test can judge that; opening every generated file in real
 * Microsoft Word is release-blocking checklist item 1 (`docs/11` §3).
 */
import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import type { RenderContent, RenderKind } from "~/shared/render-content";
import { documentFilename } from "./filename";
import { documentAuthor, documentDate, identityLines, isDated, type RenderIdentity } from "./identity";

export const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export async function toDocx(
  content: RenderContent,
  title: string,
  kind: RenderKind,
  identity: RenderIdentity,
  today: string,
): Promise<Uint8Array> {
  const children: Paragraph[] = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: title, bold: true, size: 32 })],
      spacing: { after: 120 },
    }),
  ];

  // A dated Japanese application document puts the 作成日 and 氏名 together in
  // the top right corner; an undated one reads as a draft. Which kinds are
  // dated, and therefore right-aligned, is decided in `./identity.ts`.
  const align = isDated(kind) ? AlignmentType.RIGHT : AlignmentType.CENTER;
  const stamp = documentDate(kind, today);
  if (stamp) {
    children.push(
      new Paragraph({
        alignment: align,
        children: [new TextRun({ text: stamp, size: 20 })],
        spacing: { after: 40 },
      }),
    );
  }

  // The identity block — the only content not written from facts. See
  // `./identity.ts` for why the renderer writes it and the model does not.
  const [name, ...contact] = identityLines(kind, identity);
  if (name) {
    children.push(
      new Paragraph({
        alignment: align,
        children: [new TextRun({ text: name, bold: true, size: 26 })],
        spacing: { after: contact.length > 0 ? 40 : 240 },
      }),
    );
  }
  // One paragraph a line: the résumé's headline and its contact line are two
  // lines (`identityLines` joins each line's parts), every other kind has one.
  contact.forEach((line, index) => {
    children.push(
      new Paragraph({
        alignment: align,
        children: [new TextRun({ text: line, size: 20 })],
        spacing: { after: index === contact.length - 1 ? 240 : 40 },
      }),
    );
  });

  for (const section of content.sections) {
    if (section.blocks.length === 0) continue;
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun({ text: section.heading.toUpperCase(), bold: true, size: 22 })],
        spacing: { before: 240, after: 120 },
      }),
    );
    for (const block of section.blocks) {
      children.push(
        new Paragraph({
          ...(block.kind === "bullet" ? { bullet: { level: 0 } } : {}),
          children: [new TextRun({ text: block.text, size: 22 })],
          spacing: { after: 80 },
        }),
      );
    }
  }

  // Without these, `docProps/core.xml` carries the library's `Un-named`
  // placeholder — a file whose properties disown its author (issue #7).
  const author = documentAuthor(kind, identity);
  const document = new Document({
    title,
    ...(author ? { creator: author, lastModifiedBy: author } : {}),
    sections: [{ children }],
  });
  // `toBuffer` returns a Uint8Array-compatible buffer; the Worker hands it
  // straight to the response body without ever writing it anywhere.
  return new Uint8Array(await Packer.toBuffer(document));
}

/**
 * `Kenji-Moriyama-Career-Story-EN-2026-08-12.md` — named for its author and
 * dated, so a downloaded file names its own vintage (`documentFilename`).
 */
export function downloadFilename(kind: string, nameLatin: string, extension: string, date: Date): string {
  const label = kind
    .split("_")
    .map((part) => (part === "en" || part === "ja" ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1)))
    .join("-");
  return documentFilename(label, nameLatin, date.toISOString().slice(0, 10), extension);
}
