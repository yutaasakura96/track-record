/**
 * The import path, through the API (`docs/11-testing-plan.md` §2.2, §2.6, §2.7).
 *
 * §2.2 is the mechanism that makes invented facts impossible. If it silently
 * stops working, the facts still *look* right — which is exactly why it is
 * tested here rather than trusted.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { harness, settle, stubModel, type Client, type StubModel } from "./helpers/harness";
import { CASE_STUDY, seedAllowedUser, uploadForm } from "./helpers/seed";
import { ModelUnavailableError } from "~/model/types";

interface ImportStatus {
  importId: string;
  sourceDocumentId: string;
  status: "queued" | "extracting" | "ready" | "failed";
  chunksTotal: number;
  chunksDone: number;
  candidatesExtracted: number;
  candidatesDiscarded: number;
  changedRegionShare: number | null;
  failedAtChunk: number | null;
  error: { code: string; message: string } | null;
}

interface Fact {
  id: string;
  claim: string;
  provenance: string;
  disclosure: string;
  status: string;
  evidence: { lineNumber: number; quoteStart: number; quoteEnd: number } | null;
}

let model: StubModel;
let client: Client;

beforeEach(async () => {
  model = stubModel();
  const app = harness(model);
  client = app.as(await seedAllowedUser());
});

async function importDocument(text = CASE_STUDY, filename?: string, extra?: Record<string, string>) {
  const form = uploadForm(text, filename);
  for (const [key, value] of Object.entries(extra ?? {})) form.set(key, value);
  const response = await client.request("/api/imports", { method: "POST", body: form });
  await settle();
  return response;
}

const statusOf = (importId: string) => client.json<ImportStatus>(`/api/imports/${importId}`);
const factsOf = (importId: string) =>
  client.json<{ items: Fact[] }>(`/api/facts?importId=${importId}`);

describe("quote verification", () => {
  it("anchors a verbatim quote and derives its offsets and line number", async () => {
    const quote = "Nightly batch runtime fell from 6 hours to 90 minutes.";
    model.extractions = [
      [{ claim: "Reduced nightly batch runtime from 6 hours to 90 minutes", quote, technologies: ["Airflow"] }],
    ];

    const created = (await (await importDocument()).json()) as { importId: string };
    const status = await statusOf(created.importId);
    expect(status.status).toBe("ready");
    expect(status.candidatesExtracted).toBe(1);
    expect(status.candidatesDiscarded).toBe(0);

    const { items } = await factsOf(created.importId);
    const fact = items[0]!;
    expect(fact.evidence).not.toBeNull();

    // The stored offsets index into the version's text, exactly.
    const source = await client.json<{ text: string }>(
      `/api/source-documents/${status.sourceDocumentId}/versions/1/text`,
    );
    expect(source.text.slice(fact.evidence!.quoteStart, fact.evidence!.quoteEnd)).toBe(quote);

    // And the derived line number is the line the quote appears on.
    const expectedLine = source.text.slice(0, fact.evidence!.quoteStart).split("\n").length;
    expect(fact.evidence!.lineNumber).toBe(expectedLine);
  });

  it("discards a candidate whose quote is absent, and counts it without surfacing it", async () => {
    model.extractions = [
      [
        {
          claim: "Improved system performance by approximately 30%",
          quote: "Performance improved by 30% across the estate.",
          technologies: [],
        },
      ],
    ];

    const created = (await (await importDocument()).json()) as { importId: string };
    const status = await statusOf(created.importId);

    expect(status.candidatesDiscarded).toBe(1);
    expect(status.candidatesExtracted).toBe(0);
    // The guard is silent: the author sees that it fired, never what it caught.
    expect(JSON.stringify(status)).not.toContain("Performance improved");
  });

  it("discards a quote whose whitespace was altered — verbatim means verbatim", async () => {
    model.extractions = [
      [
        {
          claim: "Reduced nightly batch runtime",
          quote: "Nightly  batch runtime fell from 6 hours to 90 minutes.",
          technologies: [],
        },
      ],
    ];
    const created = (await (await importDocument()).json()) as { importId: string };
    expect((await statusOf(created.importId)).candidatesDiscarded).toBe(1);
  });

  it("discards a full-width digit variant of a half-width source figure", async () => {
    const text = "レイテンシを40%削減しました。\n";
    model.extractions = [
      [{ claim: "Reduced latency by 40%", quote: "レイテンシを４０％削減しました。", technologies: [] }],
    ];
    const created = (await (await importDocument(text, "ja-case.md")).json()) as { importId: string };
    const status = await statusOf(created.importId);
    expect(status.candidatesDiscarded).toBe(1);
    expect(status.candidatesExtracted).toBe(0);
  });

  it("anchors a quote that spans a line break", async () => {
    const text = "We replaced the loop\nwith a set-based rewrite.\n";
    const quote = "the loop\nwith a set-based rewrite";
    model.extractions = [[{ claim: "Rewrote the settlement loop", quote, technologies: [] }]];

    const created = (await (await importDocument(text, "spanning.md")).json()) as { importId: string };
    const { items } = await factsOf(created.importId);
    expect(items).toHaveLength(1);
    // It reports the line it STARTS on, which is where the author's eye goes.
    expect(items[0]!.evidence!.lineNumber).toBe(1);
  });

  it("takes the first occurrence when a quote appears twice, deterministically", async () => {
    const repeated = "The batch was slow.";
    const text = `${repeated}\nSomething else entirely.\n${repeated}\n`;
    model.extractions = [[{ claim: "The batch was slow", quote: repeated, technologies: [] }]];

    const created = (await (await importDocument(text, "repeated.md")).json()) as { importId: string };
    const { items } = await factsOf(created.importId);
    expect(items[0]!.evidence!.quoteStart).toBe(0);
    expect(items[0]!.evidence!.lineNumber).toBe(1);
  });
});

describe("what a candidate arrives as", () => {
  it("arrives Generated, so promotion is always a deliberate act", async () => {
    model.extractions = [
      [
        {
          claim: "Reduced nightly batch runtime from 6 hours to 90 minutes",
          quote: "Nightly batch runtime fell from 6 hours to 90 minutes.",
          technologies: [],
        },
      ],
    ];
    const created = (await (await importDocument()).json()) as { importId: string };
    const { items } = await factsOf(created.importId);
    expect(items[0]!.provenance).toBe("generated");
    expect(items[0]!.status).toBe("candidate");
  });

  it("marks a candidate carrying an identifier Private, without asking", async () => {
    model.extractions = [
      [
        {
          claim: "Owned the vendor escalation path",
          quote: "Contact for the vendor escalation path was ops-lead@vendor.example.invalid.",
          technologies: [],
        },
      ],
    ];
    const created = (await (await importDocument()).json()) as { importId: string };
    const { items } = await factsOf(created.importId);
    expect(items[0]!.disclosure).toBe("private");
  });

  it("carries no confidence score anywhere in the response", async () => {
    model.extractions = [
      [
        {
          claim: "Reduced nightly batch runtime",
          quote: "Nightly batch runtime fell from 6 hours to 90 minutes.",
          technologies: [],
        },
      ],
    ];
    const created = (await (await importDocument()).json()) as { importId: string };
    const body = JSON.stringify(await factsOf(created.importId));
    expect(body).not.toMatch(/confidence|certainty|"p"\s*:/i);
  });
});

describe("rejecting an import before any work starts", () => {
  it("rejects an unsupported file type, naming the reason", async () => {
    const form = new FormData();
    form.set("file", new File(["binary"], "resume.pdf", { type: "application/pdf" }));
    const response = await client.request("/api/imports", { method: "POST", body: form });
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("validation_failed");
    expect(body.error.message).toMatch(/pdf/i);
    // Nothing was sent to the model.
    expect(model.extractCalls).toHaveLength(0);
  });

  it("rejects an oversized file the same way", async () => {
    const form = new FormData();
    form.set("file", new File(["x".repeat(3 * 1024 * 1024)], "huge.md", { type: "text/markdown" }));
    const response = await client.request("/api/imports", { method: "POST", body: form });
    expect(response.status).toBe(422);
    expect(model.extractCalls).toHaveLength(0);
  });
});

describe("failure never costs more than it should", () => {
  it("reports zero extracted facts as a failure, with the document retained", async () => {
    model.extractions = [[]];
    const created = (await (await importDocument()).json()) as { importId: string };
    const status = await statusOf(created.importId);

    expect(status.status).toBe("failed");
    expect(status.error?.code).toBe("no_facts_extracted");

    // The document is still readable — the author can retry without re-uploading.
    const source = await client.get(`/api/source-documents/${status.sourceDocumentId}/versions/1/text`);
    expect(source.status).toBe(200);
  });

  it("pauses at the failed chunk, keeps earlier candidates, and resumes there on retry", async () => {
    // Two chunks: the first succeeds, the second is a model outage.
    const long = `${"First half. ".repeat(150)}\n\n${"Second half. ".repeat(150)}`;
    model.extractions = [
      [{ claim: "First half claim", quote: "First half. First half.", technologies: [] }],
      new ModelUnavailableError("The model service returned 529."),
    ];

    const created = (await (await importDocument(long, "long.md")).json()) as { importId: string };
    const failed = await statusOf(created.importId);

    expect(failed.chunksTotal).toBeGreaterThan(1);
    expect(failed.status).toBe("failed");
    expect(failed.chunksDone).toBe(1);
    expect(failed.candidatesExtracted).toBe(1);
    expect(failed.failedAtChunk).toBe(1);

    // Retry re-runs only what failed. The chunk that succeeded is never re-sent.
    model.extractions = [
      [{ claim: "Second half claim", quote: "Second half. Second half.", technologies: [] }],
    ];
    await client.post(`/api/imports/${created.importId}/retry`);
    await settle();

    const recovered = await statusOf(created.importId);
    expect(recovered.status).toBe("ready");
    expect(recovered.candidatesExtracted).toBe(2);
    expect(recovered.failedAtChunk).toBeNull();

    // The author does not pay again for work that already succeeded: the text
    // of the chunk that landed was sent to the model exactly once, across both
    // the original run and the retry.
    const firstChunkSends = model.extractCalls.filter((body) => body.startsWith("First half."));
    expect(firstChunkSends).toHaveLength(1);
  });
});

describe("re-import", () => {
  it("extracts only changed passages and never re-offers a judged fact", async () => {
    const quote = "Nightly batch runtime fell from 6 hours to 90 minutes.";
    model.extractions = [
      [{ claim: "Reduced nightly batch runtime", quote, technologies: [] }],
    ];
    const first = (await (await importDocument()).json()) as {
      importId: string;
      sourceDocumentId: string;
    };
    const { items } = await factsOf(first.importId);
    await client.post(`/api/facts/${items[0]!.id}/accept`);

    // An edited version: one new paragraph, everything else identical.
    const edited = `${CASE_STUDY}\nA later pass introduced read replicas for reporting.\n`;
    model.extractions = [
      [
        // The model re-offers the fact already accepted, and a genuinely new one.
        { claim: "Reduced nightly batch runtime", quote, technologies: [] },
        {
          claim: "Introduced read replicas for reporting",
          quote: "A later pass introduced read replicas for reporting.",
          technologies: [],
        },
      ],
    ];
    const second = (await (
      await importDocument(edited, "aozora-batch.md", { sourceDocumentId: first.sourceDocumentId })
    ).json()) as { importId: string; versionNo: number; isReimport: boolean };

    expect(second.isReimport).toBe(true);
    expect(second.versionNo).toBe(2);

    const status = await statusOf(second.importId);
    expect(status.status).toBe("ready");
    // Only the changed region was sent — the unchanged body was not.
    expect(model.extractCalls.at(-1)).toContain("read replicas");
    expect(model.extractCalls.at(-1)).not.toContain("settlement loop");
    expect(status.changedRegionShare).not.toBeNull();
    expect(status.changedRegionShare!).toBeLessThan(0.5);

    const secondFacts = await factsOf(second.importId);
    expect(secondFacts.items).toHaveLength(1);
    expect(secondFacts.items[0]!.claim).toContain("read replicas");
  });

  it("treats an unchanged re-import as a success with nothing to extract", async () => {
    model.extractions = [
      [
        {
          claim: "Reduced nightly batch runtime",
          quote: "Nightly batch runtime fell from 6 hours to 90 minutes.",
          technologies: [],
        },
      ],
    ];
    const first = (await (await importDocument()).json()) as { sourceDocumentId: string };

    const second = (await (
      await importDocument(CASE_STUDY, "aozora-batch.md", {
        sourceDocumentId: first.sourceDocumentId,
      })
    ).json()) as { importId: string };

    const status = await statusOf(second.importId);
    // Zero candidates, and NOT a failure: there was nothing to extract from.
    expect(status.status).toBe("ready");
    expect(status.candidatesExtracted).toBe(0);
    expect(status.chunksTotal).toBe(0);
    expect(status.error).toBeNull();
  });
});
