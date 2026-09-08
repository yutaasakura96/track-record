/**
 * `docxtemplater` on the Workers runtime — spike #5 (`docs/03` §11 row 2,
 * §12 row 5; `docs/06`, 2026-09-08).
 *
 * The 履歴書 is form-filled rather than built (`docs/03` §30: "Documents are
 * built; forms are filled"), and no code fills a form yet. So this file has no
 * consumer: it is a runtime-compatibility guard, standing in for the render
 * until the render exists. `docx` needs no equivalent — `smoke.test.ts`
 * downloads a real `.docx` and exercises it end to end.
 *
 * What it guards is that a compatibility-date or `nodejs_compat` change does
 * not quietly take the library away again between now and M3. Delete it once
 * the 履歴書 render exercises the same path for real.
 *
 * The suite runs inside workerd (`vitest.config.ts`), which is what makes this
 * a runtime answer rather than a Node one.
 */
import { describe, expect, it } from "vitest";
import { Document, Packer, Paragraph, TextRun } from "docx";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";

/**
 * The template is built here rather than committed as a fixture. A real
 * `rirekisho.blank.docx` takes its structure from the author's own 履歴書 and
 * does not exist yet; this needs no binary file to answer its question.
 */
async function templateBytes(): Promise<Buffer> {
  return Packer.toBuffer(
    new Document({
      sections: [
        {
          children: [
            new Paragraph({ children: [new TextRun("氏名 {name}")] }),
            new Paragraph({ children: [new TextRun("生年月日 {birth}")] }),
          ],
        },
      ],
    }),
  );
}

function documentXml(zipped: Uint8Array): string {
  return new PizZip(zipped).file("word/document.xml")!.asText();
}

describe("docxtemplater on the Workers runtime", () => {
  it("fills placeholders and returns a zip", async () => {
    const zip = new PizZip(await templateBytes());
    const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });
    doc.render({ name: "SPIKE NAME", birth: "1900年1月" });

    const out: Uint8Array = doc.getZip().generate({ type: "uint8array", compression: "DEFLATE" });

    // A zip, by its local file header rather than by its length.
    expect([out[0], out[1], out[2], out[3]]).toEqual([0x50, 0x4b, 0x03, 0x04]);

    const xml = documentXml(out);
    expect(xml).toContain("SPIKE NAME");
    expect(xml).toContain("1900年1月");
    expect(xml).not.toContain("{name}");
    expect(xml).not.toContain("{birth}");
  });

  /**
   * PizZip's `generate` STOREs by default. On the spike's two-line template
   * that was 25,930 bytes against 8,513 compressed — a `.docx` three times the
   * size it needs to be, which opens perfectly well and so fails silently.
   * The 履歴書 render must pass `compression: "DEFLATE"`.
   */
  it("stores uncompressed unless DEFLATE is asked for", async () => {
    const build = async (compression?: "DEFLATE") => {
      const doc = new Docxtemplater(new PizZip(await templateBytes()), {
        paragraphLoop: true,
        linebreaks: true,
      });
      doc.render({ name: "SPIKE NAME", birth: "1900年1月" });
      const out: Uint8Array = doc.getZip().generate(
        compression ? { type: "uint8array", compression } : { type: "uint8array" },
      );
      return out.length;
    };

    expect(await build()).toBeGreaterThan((await build("DEFLATE")) * 2);
  });
});
