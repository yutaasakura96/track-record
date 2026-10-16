/**
 * Word and PDF as text (`docs/03-technical-design.md` §5.1, #94).
 *
 * These run inside workerd, as every server test does (`vitest.config.ts`), so
 * a PDF read here is `unpdf` proved on the runtime it is deployed to. What is
 * pinned is each extractor's paragraph rule, because line numbers and quote
 * offsets are built on it and a rule that moved would move them silently.
 */
import { describe, expect, it } from "vitest";
import PizZip from "pizzip";
import { extractUpload } from "~/pipeline/text";
import { paragraphsOf } from "~/pipeline/docx";
import { anchorQuote } from "~/pipeline/quote";
import { ApiError } from "~/server/http/errors";
import { docxFile, laidOut, pdfFile } from "./helpers/documents";

const refusalOf = async (file: File) => {
  try {
    await extractUpload(file);
  } catch (err) {
    if (err instanceof ApiError) return err.message;
    throw err;
  }
  throw new Error("the file was not refused");
};

/** A `.docx` holding exactly the `word/document.xml` body given. */
function rawDocx(body: string, filename = "orchard-log.docx") {
  const zip = new PizZip();
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="w" xmlns:mc="mc"><w:body>${body}</w:body></w:document>`,
  );
  return new File([zip.generate({ type: "arraybuffer" })], filename);
}

describe("a Word document", () => {
  it("becomes one line per paragraph, stamped docx-1, with Word's own type", async () => {
    const upload = await extractUpload(
      await docxFile(["Harbor ledger rebuild", "", "Nightly batch runtime fell from 6 hours to 90 minutes."]),
    );
    expect(upload.text).toBe("Harbor ledger rebuild\n\nNightly batch runtime fell from 6 hours to 90 minutes.");
    expect(upload.extractorVersion).toBe("docx-1");
    expect(upload.mimeType).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(upload.wordCount).toBe(13);
  });

  it("reads runs, tabs, breaks and table cells, and leaves out what is not the text", () => {
    const xml = [
      // Tab stops are properties, not tabs; two runs are one paragraph.
      `<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr><w:r><w:t>Owner</w:t></w:r><w:r><w:tab/><w:t xml:space="preserve">Data &amp; platform </w:t></w:r></w:p>`,
      `<w:p><w:r><w:t>First line</w:t><w:br/><w:t>second line</w:t><w:br w:type="page"/></w:r></w:p>`,
      // Tracked deletions and field codes are not read; insertions are.
      `<w:p><w:del><w:r><w:delText>removed </w:delText></w:r></w:del><w:ins><w:r><w:t>kept</w:t></w:r></w:ins><w:r><w:instrText> PAGE </w:instrText></w:r></w:p>`,
      `<w:tbl><w:tr><w:tc><w:p><w:r><w:t>2024</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Cut costs 30%</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`,
      // A text box is held twice, once for older readers: read once.
      `<w:p><w:r><mc:AlternateContent><mc:Choice><w:txbxContent><w:p><w:r><w:t>Boxed</w:t></w:r></w:p></w:txbxContent></mc:Choice><mc:Fallback><w:txbxContent><w:p><w:r><w:t>Boxed</w:t></w:r></w:p></w:txbxContent></mc:Fallback></mc:AlternateContent><w:t>Around</w:t></w:r></w:p>`,
      `<w:p/>`,
      `<w:p><w:r><w:t>&#x6771;&#20140; &lt;east&gt;</w:t></w:r></w:p>`,
    ].join("");
    expect(paragraphsOf(xml)).toEqual([
      "Owner\tData & platform ",
      "First line\nsecond line",
      "kept",
      "2024",
      "Cut costs 30%",
      "Boxed",
      "Around",
      "",
      "東京 <east>",
    ]);
  });

  it("is refused, with the reason, when it is damaged", async () => {
    expect(await refusalOf(new File(["PK\u0003\u0004 not really a zip"], "brief.docx"))).toBe(
      "That Word file could not be read. It may be damaged, or not a .docx.",
    );
    // A zip, but not a Word document.
    const zip = new PizZip();
    zip.file("notes.txt", "hello");
    expect(await refusalOf(new File([zip.generate({ type: "arraybuffer" })], "brief.docx"))).toBe(
      "That Word file could not be read. It may be damaged, or not a .docx.",
    );
  });

  it("refuses a Word file with an invalid numeric entity", async () => {
    expect(await refusalOf(rawDocx("<w:p><w:r><w:t>&#x110000;</w:t></w:r></w:p>"))).toBe(
      "That Word file could not be read. It may be damaged, or not a .docx.",
    );
  });

  it("omits text and controls inside tracked deletions", async () => {
    const upload = await extractUpload(rawDocx(
      "<w:p><w:r><w:t>Before</w:t></w:r><w:del><w:r><w:delText>gone</w:delText><w:tab/><w:br/><w:cr/><w:noBreakHyphen/></w:r></w:del><w:r><w:t>After</w:t></w:r></w:p>",
    ));
    expect(upload.text).toBe("BeforeAfter");
  });

  it("is refused as empty when no paragraph holds text", async () => {
    expect(await refusalOf(rawDocx("<w:p/><w:p><w:r><w:t> </w:t></w:r></w:p>"))).toBe("That file is empty.");
  });
});

describe("a PDF", () => {
  const PARAGRAPHS = [
    ["Harbor ledger rebuild"],
    ["Nightly batch runtime fell from 6 hours", "to 90 minutes after the rewrite."],
    ["The well-", "known cache stayed."],
  ];

  it("joins a paragraph's printed lines with a space, one paragraph a line, stamped pdf-1", async () => {
    const upload = await extractUpload(pdfFile([laidOut(PARAGRAPHS)]));
    expect(upload.text).toBe(
      [
        "Harbor ledger rebuild",
        "Nightly batch runtime fell from 6 hours to 90 minutes after the rewrite.",
        "The well-known cache stayed.",
      ].join("\n"),
    );
    expect(upload.extractorVersion).toBe("pdf-1");
    expect(upload.mimeType).toBe("application/pdf");
  });

  it("anchors a quote across a wrapped line as it reads, and not as it was printed", async () => {
    const { text } = await extractUpload(pdfFile([laidOut(PARAGRAPHS)]));
    const across = anchorQuote(text, "fell from 6 hours to 90 minutes");
    expect(across).toMatchObject({ lineNumber: 2 });
    expect(text.slice(across!.quoteStart, across!.quoteEnd)).toBe("fell from 6 hours to 90 minutes");
    // The printed break is not in the text, so a quote that keeps it is not verbatim.
    expect(anchorQuote(text, "fell from 6 hours\nto 90 minutes")).toBeNull();
  });

  it("starts a new paragraph on a new page, and does not join across one", async () => {
    const { text } = await extractUpload(
      pdfFile([laidOut([["Page one ends mid"]]), laidOut([["sentence on page two."]])]),
    );
    expect(text).toBe("Page one ends mid\nsentence on page two.");
  });

  it("is refused before storage when it has no text, as a scan has none", async () => {
    expect(await refusalOf(pdfFile([[], []], "scan.pdf"))).toBe(
      "That PDF has no text to read. It looks like a scan, and a scan cannot be imported without its text.",
    );
  });

  it("is refused when it is not a PDF at all", async () => {
    expect(await refusalOf(new File(["%PDF-1.4 and then nothing"], "brief.pdf"))).toBe(
      "That PDF could not be read. It may be damaged or password-protected.",
    );
  });
});

describe("types that do not import", () => {
  it.each(["resume.doc", "resume.rtf", "resume.odt", "resume.pages", "resume.html", "photo.png"])(
    "refuses %s, naming the types that do",
    async (name) => {
      expect(await refusalOf(new File(["anything"], name))).toMatch(
        /Markdown, plain text, Word and PDF files are supported\.$/,
      );
    },
  );

  it("tells a .doc to be saved as .docx", async () => {
    expect(await refusalOf(new File(["anything"], "resume.doc"))).toBe(
      "A .doc file cannot be imported. Save it as .docx first. Markdown, plain text, Word and PDF files are supported.",
    );
  });

  it("keeps plain text and Markdown at plaintext-1, unchanged", async () => {
    const upload = await extractUpload(new File(["One line.\r\nTwo lines."], "notes.txt"));
    expect(upload).toMatchObject({ text: "One line.\nTwo lines.", extractorVersion: "plaintext-1", mimeType: "text/plain" });
  });
});
