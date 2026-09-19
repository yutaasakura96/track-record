/**
 * Screen 8, Documents, through the API (`docs/07-api-design.md` §5,
 * `docs/10-screen-specifications.md` Screen 8).
 *
 * `GET /api/imports` is grouped by source document because a re-import acts on a
 * document, and every count on it is derived from facts on the read: nothing
 * records that a review finished.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { harness, settle, stubModel, type Client, type StubModel } from "./helpers/harness";
import { CASE_STUDY, SECOND_EMAIL, seedAllowedUser, uploadForm } from "./helpers/seed";
import { ModelUnavailableError } from "~/model/types";

interface Version {
  importId: string;
  versionNo: number;
  importedAt: string;
  status: "queued" | "extracting" | "ready" | "failed";
  wordCount: number;
  changedRegionShare: number | null;
  chunksTotal: number;
  chunksDone: number;
  extractorVersion: string;
  facts: { accepted: number; rejected: number; open: number };
  error: { code: string; message: string } | null;
}

interface Document {
  sourceDocumentId: string;
  filename: string;
  mimeType: string;
  project: { id: string; name: string } | null;
  lastImportedAt: string;
  openCandidates: number;
  reimportable: boolean;
  versions: Version[];
}

interface Listing {
  openCandidates: number;
  documents: Document[];
}

interface Summary {
  openCandidates: number;
  running: boolean;
}

const QUOTE = "Nightly batch runtime fell from 6 hours to 90 minutes.";
const SECOND_QUOTE = "A second pass added partition pruning on the ledger table.";

let model: StubModel;
let client: Client;

beforeEach(async () => {
  model = stubModel();
  client = harness(model).as(await seedAllowedUser());
});

async function upload(text: string, filename: string, extra: Record<string, string> = {}) {
  const form = uploadForm(text, filename);
  for (const [key, value] of Object.entries(extra)) form.set(key, value);
  return client.request("/api/imports", { method: "POST", body: form });
}

async function importDocument(text: string, filename: string, extra: Record<string, string> = {}) {
  const response = await upload(text, filename, extra);
  await settle();
  return (await response.json()) as { importId: string; sourceDocumentId: string; versionNo: number };
}

const listing = () => client.json<Listing>("/api/imports");
const summary = () => client.json<Summary>("/api/imports/summary");

describe("the documents listing", () => {
  it("groups versions under their document, newest import first", async () => {
    const first = await importDocument(CASE_STUDY, "harbor-notes.md");
    await importDocument("# Another write-up\n\nSomething else.\n", "orchard-log.md");
    await importDocument(`${CASE_STUDY}\nA later pass added a cache.\n`, "harbor-notes.md", {
      sourceDocumentId: first.sourceDocumentId,
    });

    const { documents } = await listing();
    expect(documents.map((d) => d.filename)).toEqual(["harbor-notes.md", "orchard-log.md"]);
    expect(documents[0]!.versions.map((v) => v.versionNo)).toEqual([2, 1]);
    expect(documents[0]!.lastImportedAt).toBe(documents[0]!.versions[0]!.importedAt);
    expect(documents[1]!.versions).toHaveLength(1);
    expect(documents[0]!.versions[1]!.changedRegionShare).toBeNull();
  });

  it("derives accepted, rejected and open counts from the facts themselves", async () => {
    model.extractions = [
      [
        { claim: "Reduced nightly batch runtime", quote: QUOTE, technologies: [] },
        { claim: "Added partition pruning", quote: SECOND_QUOTE, technologies: [] },
        {
          claim: "Owned the vendor escalation path",
          quote: "Contact for the vendor escalation path was ops-lead@vendor.example.invalid.",
          technologies: [],
        },
      ],
    ];
    const created = await importDocument(CASE_STUDY, "harbor-notes.md");
    const { items } = await client.json<{ items: { id: string }[] }>(
      `/api/facts?importId=${created.importId}`,
    );
    await client.post(`/api/facts/${items[0]!.id}/accept`);
    await client.post(`/api/facts/${items[1]!.id}/reject`);
    // Finishing writes nothing, so the open candidate is still open after it.
    await client.post(`/api/imports/${created.importId}/finish`);

    const body = await listing();
    const version = body.documents[0]!.versions[0]!;
    expect(version.facts).toEqual({ accepted: 1, rejected: 1, open: 1 });
    expect(body.documents[0]!.openCandidates).toBe(1);
    expect(body.openCandidates).toBe(1);
  });

  it("carries no source text", async () => {
    model.extractions = [[{ claim: "Reduced nightly batch runtime", quote: QUOTE, technologies: [] }]];
    await importDocument(CASE_STUDY, "harbor-notes.md");
    const raw = await (await client.get("/api/imports")).text();
    expect(raw).not.toContain("settlement");
    expect(raw).not.toContain("Reduced nightly batch runtime");
  });

  it("lists an unchanged re-import as a ready version with nothing changed", async () => {
    const first = await importDocument(CASE_STUDY, "harbor-notes.md");
    await importDocument(CASE_STUDY, "harbor-notes.md", { sourceDocumentId: first.sourceDocumentId });

    const newest = (await listing()).documents[0]!.versions[0]!;
    expect(newest.versionNo).toBe(2);
    expect(newest.status).toBe("ready");
    expect(newest.changedRegionShare).toBe(0);
    expect(newest.facts).toEqual({ accepted: 0, rejected: 0, open: 0 });
    expect(newest.error).toBeNull();
  });

  it("keeps the document's filename and type when a re-import carries different ones", async () => {
    const first = await importDocument(CASE_STUDY, "harbor-notes.md");
    const form = new FormData();
    form.set("file", new File([`${CASE_STUDY}\nOne more line.\n`], "harbor-notes-final.txt", { type: "text/plain" }));
    form.set("sourceDocumentId", first.sourceDocumentId);
    const response = await client.request("/api/imports", { method: "POST", body: form });
    await settle();
    expect(response.status).toBe(202);

    const [document] = (await listing()).documents;
    expect(document!.filename).toBe("harbor-notes.md");
    expect(document!.mimeType).toBe("text/markdown");
    expect(document!.versions).toHaveLength(2);
  });

  // One shape for `error` across the imports resources (`docs/07` §2): the
  // listing says what the import's own status says, code included.
  it("reports a zero-fact failure with the same code and reason as the import itself", async () => {
    model.extractions = [[]];
    const created = await importDocument(CASE_STUDY, "harbor-notes.md");
    const version = (await listing()).documents[0]!.versions[0]!;
    const status = await client.json<{ error: unknown }>(`/api/imports/${created.importId}`);
    expect(version.status).toBe("failed");
    expect(version.error).toEqual({ code: "no_facts_extracted", message: expect.any(String) });
    expect(version.error!.message.length).toBeGreaterThan(0);
    expect(version.error).toEqual(status.error);
  });

  it("reports a failed chunk with the same code and reason as the import itself", async () => {
    const long = `${"First half. ".repeat(150)}\n\n${"Second half. ".repeat(150)}`;
    model.extractions = [
      [{ claim: "First half claim", quote: "First half. First half.", technologies: [] }],
      new ModelUnavailableError("The model service returned 529."),
    ];
    const created = await importDocument(long, "long.md");
    const version = (await listing()).documents[0]!.versions[0]!;
    const status = await client.json<{ error: unknown }>(`/api/imports/${created.importId}`);
    expect(version.status).toBe("failed");
    expect(version.error).toEqual({ code: "extraction_failed", message: expect.any(String) });
    expect(version.error).toEqual(status.error);
  });

  it("lists nothing for a user with no documents", async () => {
    expect(await listing()).toEqual({ openCandidates: 0, documents: [] });
  });
});

/**
 * The sidebar's badge (`docs/10` Screen 8) is one number, and it is on screen on
 * every sidebar screen. Reading it from the listing meant fetching every
 * document, every version and every fact count on Home, Record and Skills, and
 * polling all of it while an import ran.
 */
describe("the sidebar summary", () => {
  it("counts the same open candidates the listing does", async () => {
    model.extractions = [
      [
        { claim: "Reduced nightly batch runtime", quote: QUOTE, technologies: [] },
        { claim: "Added partition pruning", quote: SECOND_QUOTE, technologies: [] },
      ],
    ];
    const created = await importDocument(CASE_STUDY, "harbor-notes.md");
    expect(await summary()).toEqual({ openCandidates: 2, running: false });

    // The cheap count and the expensive one are never allowed to disagree,
    // through every transition that moves a fact out of `candidate`.
    const { items } = await client.json<{ items: { id: string }[] }>(
      `/api/facts?importId=${created.importId}`,
    );
    await client.post(`/api/facts/${items[0]!.id}/accept`);
    expect((await summary()).openCandidates).toBe((await listing()).openCandidates);

    await client.post(`/api/facts/${items[1]!.id}/reject`);
    expect((await summary()).openCandidates).toBe((await listing()).openCandidates);
    expect((await summary()).openCandidates).toBe(0);

    await client.post(`/api/facts/${items[1]!.id}/undo`);
    expect((await summary()).openCandidates).toBe((await listing()).openCandidates);
    expect((await summary()).openCandidates).toBe(1);
  });

  it("reports an import as running only while it is, so the sidebar knows when to stop polling", async () => {
    // Hold extraction open, so the version is still running when the summary is
    // read. This is the flag the sidebar's refetch interval is driven from.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const extract = model.extractFacts.bind(model);
    model.extractFacts = async (text, ctx) => {
      await gate;
      return extract(text, ctx);
    };
    model.extractions = [[{ claim: "Reduced nightly batch runtime", quote: QUOTE, technologies: [] }]];

    await upload(CASE_STUDY, "harbor-notes.md");
    expect((await summary()).running).toBe(true);

    release();
    await settle();
    expect(await summary()).toEqual({ openCandidates: 1, running: false });
  });

  it("reports nothing running once an import has failed", async () => {
    // A failed version is settled. Reporting it as running would poll forever.
    model.extractions = [[]];
    await importDocument(CASE_STUDY, "harbor-notes.md");
    expect(await summary()).toEqual({ openCandidates: 0, running: false });
  });

  it("counts nothing for a user with no documents", async () => {
    expect(await summary()).toEqual({ openCandidates: 0, running: false });
  });

  it("answers the summary rather than reading `summary` as an import id", async () => {
    // `/api/imports/summary` is a static segment beside `/api/imports/:id`, and
    // Hono resolves those by REGISTRATION ORDER, not by specificity. Registered
    // the other way round, this path is an import id and the sidebar gets a 404.
    const response = await client.get("/api/imports/summary");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ openCandidates: 0, running: false });
  });

  it("counts only the reader's own candidates, and only their own imports", async () => {
    // The every-query-filters-by-user_id rule. The summary returns numbers and
    // no names, so the isolation suite's "does the body mention the other user"
    // check cannot see a leak here — this is where it has to be caught.
    const other = harness(model).as(await seedAllowedUser(SECOND_EMAIL));

    // Hold the other user's extraction open, so their import is running while
    // this user's summary is read.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const extract = model.extractFacts.bind(model);
    model.extractFacts = async (text, ctx) => {
      await gate;
      return extract(text, ctx);
    };
    model.extractions = [
      [
        { claim: "Reduced nightly batch runtime", quote: QUOTE, technologies: [] },
        { claim: "Added partition pruning", quote: SECOND_QUOTE, technologies: [] },
      ],
    ];

    await other.request("/api/imports", { method: "POST", body: uploadForm(CASE_STUDY, "orchard-log.md") });
    expect(await summary()).toEqual({ openCandidates: 0, running: false });

    release();
    await settle();
    expect(await summary()).toEqual({ openCandidates: 0, running: false });
    expect(await other.json<Summary>("/api/imports/summary")).toEqual({
      openCandidates: 2,
      running: false,
    });
  });
});

describe("re-importing a document", () => {
  it("is refused at 409 while the newest version is still extracting", async () => {
    // Hold extraction open, so the newest version cannot finish while the
    // re-import is attempted.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const extract = model.extractFacts.bind(model);
    model.extractFacts = async (text, ctx) => {
      await gate;
      return extract(text, ctx);
    };

    const response = await upload(CASE_STUDY, "harbor-notes.md");
    const first = (await response.json()) as { sourceDocumentId: string };

    const running = (await listing()).documents[0]!;
    expect(running.reimportable).toBe(false);

    const refused = await upload(`${CASE_STUDY}\nMore.\n`, "harbor-notes.md", {
      sourceDocumentId: first.sourceDocumentId,
    });
    expect(refused.status).toBe(409);
    const body = (await refused.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("conflict");
    expect(body.error.message).toBe("Wait for v1 to finish extracting.");

    release();
    await settle();

    const settled = (await listing()).documents[0]!;
    expect(settled.versions).toHaveLength(1);
    expect(settled.reimportable).toBe(true);
  });

  it("refuses the loser of two simultaneous re-imports at 409", async () => {
    const first = await importDocument(CASE_STUDY, "harbor-notes.md");

    // Hold the winner's extraction open, so its version is still running when
    // the loser is answered.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const extract = model.extractFacts.bind(model);
    model.extractFacts = async (text, ctx) => {
      await gate;
      return extract(text, ctx);
    };

    const responses = await Promise.all([
      upload(`${CASE_STUDY}\nOne pass.\n`, "harbor-notes.md", { sourceDocumentId: first.sourceDocumentId }),
      upload(`${CASE_STUDY}\nAnother pass.\n`, "harbor-notes.md", { sourceDocumentId: first.sourceDocumentId }),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([202, 409]);

    const loser = responses.find((r) => r.status === 409)!;
    const body = (await loser.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("conflict");
    expect(body.error.message).toBe("Wait for v2 to finish extracting.");

    release();
    await settle();
    expect((await listing()).documents[0]!.versions.map((v) => v.versionNo)).toEqual([2, 1]);
  });

  it("is allowed after the newest version failed", async () => {
    model.extractions = [[]];
    const first = await importDocument(CASE_STUDY, "harbor-notes.md");
    expect((await listing()).documents[0]!.reimportable).toBe(true);

    model.extractions = [[{ claim: "Reduced nightly batch runtime", quote: QUOTE, technologies: [] }]];
    const response = await upload(`${CASE_STUDY}\nMore.\n`, "harbor-notes.md", {
      sourceDocumentId: first.sourceDocumentId,
    });
    await settle();
    expect(response.status).toBe(202);
    expect((await listing()).documents[0]!.versions.map((v) => v.versionNo)).toEqual([2, 1]);
  });
});
