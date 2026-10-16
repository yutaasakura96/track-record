/**
 * Importing Word and PDF documents, through the API (#94, `docs/07` §5).
 *
 * A `.docx` and a text PDF import as Markdown does: their paragraphs are the
 * lines, quotes anchor by exact match, and facts land in the record. A scan, a
 * `.doc` and a damaged `.docx` are refused with the reason before anything is
 * stored and before the model is called. And no version is ever extracted a
 * second time, whatever its type.
 *
 * Every document here is INVENTED (`tests/helpers/documents.ts`).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { asc, eq } from "drizzle-orm";
import { harness, settle, stubModel, type Client, type StubModel } from "./helpers/harness";
import { seedAllowedUser } from "./helpers/seed";
import { docxFile, laidOut, pdfFile } from "./helpers/documents";
import PizZip from "pizzip";
import { createDb } from "~/server/db/client";
import { sourceDocuments, sourceDocumentVersions } from "~/server/db/schema";
import { MAX_BATCH_BYTES, MAX_IMPORT_WRITE_BYTES } from "~/shared/import-file";
import type { Bindings } from "~/server/env";

const db = createDb((env as unknown as Bindings).DATABASE_URL);

interface Fact {
  claim: string;
  evidence: { lineNumber: number; quoteStart: number; quoteEnd: number } | null;
}

const QUOTE = "Nightly batch runtime fell from 6 hours to 90 minutes.";

let model: StubModel;
let client: Client;
let userId: string;

beforeEach(async () => {
  model = stubModel();
  const user = await seedAllowedUser();
  userId = user.id;
  client = harness(model).as(user);
});

async function send(file: File, extra: Record<string, string> = {}) {
  const form = new FormData();
  form.set("file", file);
  for (const [key, value] of Object.entries(extra)) form.set(key, value);
  const response = await client.request("/api/imports", { method: "POST", body: form });
  await settle();
  return response;
}

const versionsOf = (sourceDocumentId: string) =>
  db
    .select()
    .from(sourceDocumentVersions)
    .where(eq(sourceDocumentVersions.sourceDocumentId, sourceDocumentId))
    .orderBy(asc(sourceDocumentVersions.versionNo));

async function imported(file: File) {
  const response = await send(file);
  expect(response.status).toBe(202);
  const { importId, sourceDocumentId } = (await response.json()) as { importId: string; sourceDocumentId: string };
  const { items } = await client.json<{ items: Fact[] }>(`/api/facts?importId=${importId}`);
  const { text } = await client.json<{ text: string }>(`/api/source-documents/${sourceDocumentId}/versions/1/text`);
  const status = await client.json<{ status: string; candidatesDiscarded: number }>(`/api/imports/${importId}`);
  return { importId, sourceDocumentId, facts: items, text, status };
}

describe("a Word document", () => {
  it("imports as Markdown does: its paragraphs are the lines, and a quote anchors on its line", async () => {
    model.extractions = [[{ claim: "Cut the nightly batch to 90 minutes", quote: QUOTE, technologies: [] }]];
    const file = await docxFile(["Harbor ledger rebuild", "", QUOTE, "The cache stayed."]);
    const { sourceDocumentId, facts, text, status } = await imported(file);

    expect(status.status).toBe("ready");
    expect(text).toBe(`Harbor ledger rebuild\n\n${QUOTE}\nThe cache stayed.`);
    expect(facts).toHaveLength(1);
    expect(facts[0]!.evidence!.lineNumber).toBe(3);
    expect(text.slice(facts[0]!.evidence!.quoteStart, facts[0]!.evidence!.quoteEnd)).toBe(QUOTE);
    // The model read the extracted text, not the zip.
    expect(model.extractCalls[0]).toContain(QUOTE);

    const [document] = await db.select().from(sourceDocuments).where(eq(sourceDocuments.id, sourceDocumentId));
    expect(document!.mimeType).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    const [version] = await versionsOf(sourceDocumentId);
    expect(version!.extractorVersion).toBe("docx-1");
    // The file is kept as it was uploaded.
    expect(new Uint8Array(version!.originalBytes)).toEqual(new Uint8Array(await file.arrayBuffer()));
  });
});

describe("a PDF", () => {
  it("imports with its wrapped lines joined, and a quote across the wrap anchors as the sentence reads", async () => {
    model.extractions = [
      [
        { claim: "Cut the nightly batch to 90 minutes", quote: "fell from 6 hours to 90 minutes", technologies: [] },
        // The same words with the printed break kept: not verbatim, so discarded.
        { claim: "Cut the nightly batch", quote: "fell from 6 hours\nto 90 minutes", technologies: [] },
      ],
    ];
    const file = pdfFile([
      laidOut([["Harbor ledger rebuild"], ["Nightly batch runtime fell from 6 hours", "to 90 minutes after the rewrite."]]),
    ]);
    const { sourceDocumentId, facts, text, status } = await imported(file);

    expect(text).toBe("Harbor ledger rebuild\nNightly batch runtime fell from 6 hours to 90 minutes after the rewrite.");
    expect(facts).toHaveLength(1);
    expect(facts[0]!.evidence!.lineNumber).toBe(2);
    expect(status.candidatesDiscarded).toBe(1);

    const [document] = await db.select().from(sourceDocuments).where(eq(sourceDocuments.id, sourceDocumentId));
    expect(document!.mimeType).toBe("application/pdf");
    const [version] = await versionsOf(sourceDocumentId);
    expect(version!.extractorVersion).toBe("pdf-1");
    expect(new Uint8Array(version!.originalBytes)).toEqual(new Uint8Array(await file.arrayBuffer()));
  });
});

describe("refused before storage and before the model", () => {
  const storedForUser = () => db.select().from(sourceDocuments).where(eq(sourceDocuments.userId, userId));

  it.each([
    [
      "a scanned PDF",
      () => pdfFile([[]], "scan.pdf"),
      "That PDF has no text to read. It looks like a scan, and a scan cannot be imported without its text.",
    ],
    [
      "a .doc",
      () => new File(["ÐÏ\u0011à an old Word file"], "resume.doc"),
      "A .doc file cannot be imported. Save it as .docx first. Markdown, plain text, Word and PDF files are supported.",
    ],
    [
      "a damaged .docx",
      () => new File(["PK\u0003\u0004 cut off"], "resume.docx"),
      "That Word file could not be read. It may be damaged, or not a .docx.",
    ],
  ])("refuses %s, naming the reason", async (_, file, reason) => {
    const response = await send(file());
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error).toMatchObject({ code: "validation_failed", message: reason });
    expect(await storedForUser()).toEqual([]);
    expect(model.extractCalls).toHaveLength(0);
  });

  it("refuses the same files on their own rows of a set, and imports the rest", async () => {
    model.extractions = [[{ claim: "Cut the nightly batch to 90 minutes", quote: QUOTE, technologies: [] }]];
    const form = new FormData();
    for (const file of [pdfFile([[]], "scan.pdf"), await docxFile([QUOTE]), new File(["x"], "resume.doc")]) {
      form.append("file", file);
      form.append("filing", "{}");
    }
    const response = await client.request("/api/imports/batch", { method: "POST", body: form });
    await settle();
    const { results } = (await response.json()) as { results: { importId?: string; reason?: string }[] };
    expect(results.map((row) => row.reason ?? "imported")).toEqual([
      "That PDF has no text to read. It looks like a scan, and a scan cannot be imported without its text.",
      "imported",
      "A .doc file cannot be imported. Save it as .docx first. Markdown, plain text, Word and PDF files are supported.",
    ]);
    const stored = await storedForUser();
    expect(stored.map((document) => document.filename)).toEqual(["harbor-notes.docx"]);
    expect(model.extractCalls).toHaveLength(1);
  });

  it("refuses a batch over 20 MiB before storing any file", async () => {
    const form = new FormData();
    const bytes = new Uint8Array(MAX_BATCH_BYTES / 2);
    for (const file of [
      new File([bytes], "first.docx"),
      new File([bytes], "second.docx"),
      new File(["x"], "third.txt"),
    ]) {
      form.append("file", file);
      form.append("filing", "{}");
    }
    const response = await client.request("/api/imports/batch", { method: "POST", body: form });
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error).toMatchObject({
      code: "validation_failed",
      message: "The files together exceed 20 MB, more than one import can store at once. Choose a smaller set and import the rest after.",
    });
    expect(await storedForUser()).toEqual([]);
    expect(model.extractCalls).toHaveLength(0);
  });

  it("refuses a compressed Word file whose extracted text exceeds the write budget", async () => {
    const zip = new PizZip();
    zip.file("word/document.xml", `<w:document><w:body><w:p><w:r><w:t>${"\\".repeat(MAX_IMPORT_WRITE_BYTES / 2 + 1)}</w:t></w:r></w:p></w:body></w:document>`);
    const response = await send(new File([zip.generate({ type: "arraybuffer", compression: "DEFLATE" })], "large.docx"));
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error).toMatchObject({
      code: "validation_failed",
      message: "That file is too large to store after text extraction. Choose a smaller document.",
    });
    expect(await storedForUser()).toEqual([]);
    expect(model.extractCalls).toHaveLength(0);
  });
});

describe("a version is never re-extracted", () => {
  it("keeps an existing version's text, extractor and file when its document is imported again as Word", async () => {
    const markdown = `# Harbor ledger rebuild\n\n${QUOTE}\n`;
    const first = await send(new File([markdown], "harbor-notes.md"));
    const { sourceDocumentId } = (await first.json()) as { sourceDocumentId: string };
    const [before] = await versionsOf(sourceDocumentId);

    const again = await send(await docxFile(["Harbor ledger rebuild", QUOTE, "A later pass added a cache."]), {
      sourceDocumentId,
    });
    expect(again.status).toBe(202);

    const [v1, v2] = await versionsOf(sourceDocumentId);
    expect(v1).toMatchObject({
      extractedText: markdown,
      extractorVersion: "plaintext-1",
      updatedAt: before!.updatedAt,
    });
    expect(new Uint8Array(v1!.originalBytes)).toEqual(new Uint8Array(before!.originalBytes));
    expect(v2).toMatchObject({ versionNo: 2, extractorVersion: "docx-1" });
  });
});
