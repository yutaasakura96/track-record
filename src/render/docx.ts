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
import { documentAuthor, identityLines, type RenderIdentity } from "./identity";

export const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export async function toDocx(
  content: RenderContent,
  title: string,
  kind: RenderKind,
  identity: RenderIdentity,
): Promise<Uint8Array> {
  const children: Paragraph[] = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: title, bold: true, size: 32 })],
      spacing: { after: 120 },
    }),
  ];

  // The identity block — the only content not written from facts. See
  // `./identity.ts` for why the renderer writes it and the model does not.
  const [name, ...contact] = identityLines(kind, identity);
  if (name) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: name, bold: true, size: 26 })],
        spacing: { after: contact.length > 0 ? 40 : 240 },
      }),
    );
  }
  if (contact.length > 0) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: contact.join(" · "), size: 20 })],
        spacing: { after: 240 },
      }),
    );
  }

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

/** `resume-2026-08-12.docx` — dated, so a downloaded file names its own vintage. */
export function downloadFilename(kind: string, extension: string, date: Date): string {
  const stem = kind === "english_resume" ? "resume" : kind.replace(/_/g, "-");
  return `${stem}-${date.toISOString().slice(0, 10)}.${extension}`;
}
