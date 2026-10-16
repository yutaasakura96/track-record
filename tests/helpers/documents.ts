/**
 * Word and PDF files built for the test that reads them (#94). Every word in
 * them is INVENTED, and none is sampled from a real document.
 */
import { Document, Packer, Paragraph, TextRun } from "docx";

const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** A `.docx` whose paragraphs are the strings given, one each, built by Word's own format. */
export async function docxFile(paragraphs: string[], filename = "harbor-notes.docx"): Promise<File> {
  const document = new Document({
    sections: [{ children: paragraphs.map((text) => new Paragraph({ children: [new TextRun(text)] })) }],
  });
  return new File([await Packer.toArrayBuffer(document)], filename, { type: DOCX_TYPE });
}

/** A line of a PDF page: its text, and its baseline in points from the foot of the page. */
export interface PdfLine {
  text: string;
  y: number;
  size?: number;
  x?: number;
}

const escape = (text: string) => text.replace(/[\\()]/g, (char) => `\\${char}`);

/**
 * A PDF with one page per entry, each line set in Helvetica at the baseline
 * given. A page with no lines carries a filled rectangle and no text, as a
 * scan's page carries an image and no text. ASCII only: the file is written as
 * bytes one character each, which is what lets the cross-reference table count
 * its offsets in characters.
 */
export function pdfBytes(pages: PdfLine[][]): Uint8Array<ArrayBuffer> {
  const objects: string[] = [];
  const pageIds: number[] = [];
  // 1 is the catalogue, 2 the page tree, 3 the font; pages and their contents follow.
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  let next = 4;
  for (const lines of pages) {
    const pageId = next++;
    const contentId = next++;
    pageIds.push(pageId);
    const stream = lines.length
      ? lines
          .map(({ text, y, size = 12, x = 72 }) => `BT /F1 ${size} Tf 1 0 0 1 ${x} ${y} Tm (${escape(text)}) Tj ET`)
          .join("\n")
      : "0.5 g 72 72 468 648 re f";
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  }
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;

  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = body.length;
    body += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = body.length;
  body += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) body += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

export const pdfFile = (pages: PdfLine[][], filename = "harbor-notes.pdf") =>
  new File([pdfBytes(pages)], filename, { type: "application/pdf" });

/**
 * Lines set as a word processor sets them: 14 points apart within a paragraph,
 * and a blank line's worth further between paragraphs. Each paragraph is given
 * as its printed lines.
 */
export function laidOut(paragraphs: string[][], top = 720): PdfLine[] {
  const lines: PdfLine[] = [];
  let y = top;
  for (const paragraph of paragraphs) {
    for (const text of paragraph) {
      lines.push({ text, y });
      y -= 14;
    }
    y -= 14;
  }
  return lines;
}
