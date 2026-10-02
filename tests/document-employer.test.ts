/**
 * A document filed under an employer, and a fact's employer read through it
 * (`docs/04-database-schema.md` §3.12, `docs/07-api-design.md` §5 and §6,
 * issue #35).
 *
 * Through the API, as a per-employer portfolio arrives: imported once under its
 * employer, its candidates filed under that employer without a pick each, and
 * the document refiled afterwards. Every document, employer and claim here is
 * invented.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { harness, settle, stubModel, type Client, type Harness, type StubModel } from "./helpers/harness";
import { EMPLOYER_FIXTURE, seedAllowedUser, uploadForm } from "./helpers/seed";
import { facts as factsTable, sourceDocumentVersions } from "~/server/db/schema";
import { effectiveEmployerSql } from "~/server/db/fact-employer";
import { collectRenderInputs } from "~/server/services/render";
import { collectEditableRecord } from "~/server/services/version-edit";

interface Fact {
  id: string;
  claim: string;
  status: string;
  employerId: string | null;
  employerSetByHand: boolean;
  projectId: string | null;
}

interface Refiled {
  sourceDocumentId: string;
  project: { id: string; name: string } | null;
  employer: { id: string; name: string } | null;
  facts: number;
  employerSetByHand: number;
}

const PORTFOLIO = `# Ledger reconciliation at Kinomi

The reconciliation job compared every ledger row against the bank feed by hand.

We moved the comparison into a single set-based query and the run fell from 50 minutes to 4.

The same pass removed three manual sign-offs from the month-end close.

A dashboard now shows unmatched rows as they appear.
`;
const CANDIDATES = [
  {
    claim: "Cut the reconciliation run from 50 minutes to 4",
    quote: "We moved the comparison into a single set-based query and the run fell from 50 minutes to 4.",
  },
  {
    claim: "Removed three manual sign-offs from the month-end close",
    quote: "The same pass removed three manual sign-offs from the month-end close.",
  },
  {
    claim: "Added a dashboard of unmatched reconciliation rows",
    quote: "A dashboard now shows unmatched rows as they appear.",
  },
];

let model: StubModel;
let app: Harness;
let client: Client;
let userId: string;

beforeEach(async () => {
  model = stubModel();
  app = harness(model);
  const user = await seedAllowedUser();
  userId = user.id;
  client = app.as(user);
});

async function employer(nameLatin: string) {
  const response = await client.post("/api/employers", { ...EMPLOYER_FIXTURE, nameLatin });
  return ((await response.json()) as { id: string }).id;
}

async function project(name: string, employerId: string | null) {
  const response = await client.post("/api/projects", { name, employerId });
  return ((await response.json()) as { id: string }).id;
}

async function upload(fields: Record<string, string>, text = PORTFOLIO, filename = "kinomi-portfolio.md") {
  model.extractions = [CANDIDATES.map((c) => ({ ...c, technologies: [] }))];
  const form = uploadForm(text, filename);
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return client.request("/api/imports", { method: "POST", body: form });
}

async function importPortfolio(fields: Record<string, string> = {}) {
  const response = await upload(fields);
  expect(response.status).toBe(202);
  await settle();
  return (await response.json()) as { importId: string; sourceDocumentId: string };
}

const factsOf = async (importId: string) =>
  (await client.json<{ items: Fact[] }>(`/api/facts?importId=${importId}`)).items;

const refile = (sourceDocumentId: string, body: Record<string, unknown>) =>
  client.patch(`/api/source-documents/${sourceDocumentId}`, body);

const listing = () =>
  client.json<{ documents: { sourceDocumentId: string; employer: { id: string; name: string } | null }[] }>(
    "/api/imports",
  );

describe("a document filed under an employer at import", () => {
  it("files every candidate under the document's employer, with no employer copied onto a fact", async () => {
    const kinomi = await employer("Kinomi Trading K.K.");
    const { importId, sourceDocumentId } = await importPortfolio({ employerId: kinomi });

    const items = await factsOf(importId);
    expect(items).toHaveLength(CANDIDATES.length);
    expect(items.every((f) => f.employerId === kinomi && !f.employerSetByHand)).toBe(true);

    // Read through the document: the persist step wrote no employer of its own.
    const stored = await app.db
      .select({ employerId: factsTable.employerId, employerSetAt: factsTable.employerSetAt })
      .from(factsTable)
      .where(eq(factsTable.sourceDocumentVersionId, importId));
    expect(stored.every((row) => row.employerId === null && row.employerSetAt === null)).toBe(true);

    const [document] = (await listing()).documents;
    expect(document).toMatchObject({ sourceDocumentId, employer: { id: kinomi, name: "Kinomi Trading K.K." } });
    // And the fact list's filter finds them by the employer they resolve to.
    const filtered = await client.json<{ items: Fact[] }>(`/api/facts?employerId=${kinomi}`);
    expect(filtered.items).toHaveLength(CANDIDATES.length);
  });

  it("files the candidates under the document's employer when the project names another", async () => {
    const kinomi = await employer("Kinomi Trading K.K.");
    const harbour = await employer("Harbour Freight K.K.");
    const ledger = await project("Ledger reconciliation", harbour);
    const { importId } = await importPortfolio({ projectId: ledger, employerId: kinomi });

    const items = await factsOf(importId);
    expect(items.every((f) => f.employerId === kinomi && f.projectId === ledger)).toBe(true);
  });

  it("keeps the document's employer through a re-import, whatever employer the upload names", async () => {
    const kinomi = await employer("Kinomi Trading K.K.");
    const harbour = await employer("Harbour Freight K.K.");
    const first = await importPortfolio({ employerId: kinomi });

    model.extractions = [
      [{ claim: "Alerted on unmatched rows within a minute", quote: "Alerts fire within a minute.", technologies: [] }],
    ];
    const form = uploadForm(`${PORTFOLIO}\nAlerts fire within a minute.\n`, "kinomi-portfolio.md");
    form.set("sourceDocumentId", first.sourceDocumentId);
    form.set("employerId", harbour);
    const response = await client.request("/api/imports", { method: "POST", body: form });
    expect(response.status).toBe(202);
    await settle();
    const second = (await response.json()) as { importId: string; versionNo: number };
    expect(second.versionNo).toBe(2);

    expect((await listing()).documents[0]!.employer?.id).toBe(kinomi);
    const items = await factsOf(second.importId);
    expect(items).toHaveLength(1);
    expect(items[0]!.employerId).toBe(kinomi);
  });

  it("refuses another user's employer at 404, and imports nothing", async () => {
    const theirs = await app.as(await seedAllowedUser()).post("/api/employers", EMPLOYER_FIXTURE);
    const { id } = (await theirs.json()) as { id: string };

    const response = await upload({ employerId: id });
    expect(response.status).toBe(404);
    expect(model.extractCalls).toEqual([]);
    expect((await listing()).documents).toEqual([]);
  });
});

describe("a document with no employer", () => {
  it("behaves as before: its facts resolve to nothing, then to their project's employer", async () => {
    const unfiled = await importPortfolio();
    expect((await factsOf(unfiled.importId)).every((f) => f.employerId === null && !f.employerSetByHand)).toBe(
      true,
    );
    expect((await listing()).documents[0]!.employer).toBeNull();

    const harbour = await employer("Harbour Freight K.K.");
    await refile(unfiled.sourceDocumentId, { projectId: await project("Ledger reconciliation", harbour) });
    expect(
      (await factsOf(unfiled.importId)).every((f) => f.employerId === harbour && !f.employerSetByHand),
    ).toBe(true);
  });
});

describe("changing a document's employer after import", () => {
  async function filedPortfolio() {
    const kinomi = await employer("Kinomi Trading K.K.");
    const harbour = await employer("Harbour Freight K.K.");
    const imported = await importPortfolio({ employerId: kinomi });
    const [readThrough, handSet, handUnset] = await factsOf(imported.importId);
    return { kinomi, harbour, ...imported, readThrough: readThrough!, handSet: handSet!, handUnset: handUnset! };
  }

  it("moves every fact that reads through it, and leaves a hand-set one, No employer included", async () => {
    const p = await filedPortfolio();
    // On the card: one fact kept at the portfolio's employer by a deliberate
    // pick, and one set to `No employer`.
    await client.patch(`/api/facts/${p.handSet.id}`, { employerId: p.kinomi });
    await client.patch(`/api/facts/${p.handUnset.id}`, { employerId: null });

    const response = await refile(p.sourceDocumentId, { employerId: p.harbour });
    expect(response.status).toBe(200);
    expect((await response.json()) as Refiled).toEqual({
      sourceDocumentId: p.sourceDocumentId,
      project: null,
      employer: { id: p.harbour, name: "Harbour Freight K.K." },
      facts: 3,
      employerSetByHand: 2,
    });

    const byId = new Map((await factsOf(p.importId)).map((f) => [f.id, f]));
    expect(byId.get(p.readThrough.id)).toMatchObject({ employerId: p.harbour, employerSetByHand: false });
    expect(byId.get(p.handSet.id)).toMatchObject({ employerId: p.kinomi, employerSetByHand: true });
    expect(byId.get(p.handUnset.id)).toMatchObject({ employerId: null, employerSetByHand: true });
    expect((await listing()).documents[0]!.employer?.id).toBe(p.harbour);
  });

  it("files the document back under no employer, and its read-through facts with it", async () => {
    const p = await filedPortfolio();

    const response = await refile(p.sourceDocumentId, { employerId: null });
    expect(response.status).toBe(200);
    expect(((await response.json()) as Refiled).employer).toBeNull();
    expect((await factsOf(p.importId)).every((f) => f.employerId === null)).toBe(true);
  });

  it("leaves the project alone when only the employer is named, and the employer when only the project is", async () => {
    const p = await filedPortfolio();
    const ledger = await project("Ledger reconciliation", null);

    await refile(p.sourceDocumentId, { projectId: ledger });
    let items = await factsOf(p.importId);
    expect(items.every((f) => f.projectId === ledger && f.employerId === p.kinomi)).toBe(true);

    await refile(p.sourceDocumentId, { employerId: p.harbour });
    items = await factsOf(p.importId);
    expect(items.every((f) => f.projectId === ledger && f.employerId === p.harbour)).toBe(true);
  });

  it("is not refused while a version extracts, as a project change is", async () => {
    const p = await filedPortfolio();
    const ledger = await project("Ledger reconciliation", null);
    await app.db
      .update(sourceDocumentVersions)
      .set({ importStatus: "extracting" })
      .where(eq(sourceDocumentVersions.id, p.importId));

    expect((await refile(p.sourceDocumentId, { employerId: p.harbour })).status).toBe(200);
    expect((await refile(p.sourceDocumentId, { projectId: ledger })).status).toBe(409);
    expect((await refile(p.sourceDocumentId, { projectId: ledger, employerId: null })).status).toBe(409);
    // The refused body moved nothing, its employer included.
    expect((await listing()).documents[0]!.employer?.id).toBe(p.harbour);
  });

  it("refuses another user's employer at 404, and moves nothing", async () => {
    const p = await filedPortfolio();
    const theirs = await app.as(await seedAllowedUser()).post("/api/employers", EMPLOYER_FIXTURE);
    const { id } = (await theirs.json()) as { id: string };

    expect((await refile(p.sourceDocumentId, { employerId: id })).status).toBe(404);
    expect((await factsOf(p.importId)).every((f) => f.employerId === p.kinomi)).toBe(true);
  });

  it("refuses a body that names neither a project nor an employer", async () => {
    const p = await filedPortfolio();
    const response = await refile(p.sourceDocumentId, {});
    expect(response.status).toBe(422);
  });
});

describe("the employer set on a fact's card", () => {
  it("is a hand set that outlasts the document's, and the response says so", async () => {
    const kinomi = await employer("Kinomi Trading K.K.");
    const harbour = await employer("Harbour Freight K.K.");
    const { importId, sourceDocumentId } = await importPortfolio({ employerId: kinomi });
    const [fact] = await factsOf(importId);

    const response = await client.patch(`/api/facts/${fact!.id}`, { employerId: harbour });
    expect(response.status).toBe(200);
    expect((await response.json()) as Fact).toMatchObject({ employerId: harbour, employerSetByHand: true });

    await refile(sourceDocumentId, { employerId: null });
    const after = (await factsOf(importId)).find((f) => f.id === fact!.id)!;
    expect(after).toMatchObject({ employerId: harbour, employerSetByHand: true });
  });

  it("refuses another user's employer at 404", async () => {
    const { importId } = await importPortfolio();
    const [fact] = await factsOf(importId);
    const theirs = await app.as(await seedAllowedUser()).post("/api/employers", EMPLOYER_FIXTURE);
    const { id } = (await theirs.json()) as { id: string };

    expect((await client.patch(`/api/facts/${fact!.id}`, { employerId: id })).status).toBe(404);
  });
});

describe("deleting an employer a document is filed under", () => {
  it("is refused with the document counted and the control that moves it named", async () => {
    const kinomi = await employer("Kinomi Trading K.K.");
    await importPortfolio({ employerId: kinomi });

    const response = await client.delete(`/api/employers/${kinomi}`);
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { message: string; details: Record<string, number> } };
    // The read-through facts hold no reference of their own; the document does.
    expect(body.error.details).toEqual({ facts: 0, roles: 0, projects: 0, documents: 1 });
    expect(body.error.message).toBe(
      "This employer has 1 document attached. Refile them from Documents before deleting.",
    );
  });
});

/**
 * Every reader of a fact's employer resolves it in one order (`docs/04`
 * §3.12). Before #35 the render read the fact's own column while Version Edit
 * and the attribution check added the project, so a fact filed only through
 * its project reached the model as filed under nothing.
 */
describe("every reader agrees on a fact's employer", () => {
  it("the fact list, the render, Version Edit and the attribution check", async () => {
    const kinomi = await employer("Kinomi Trading K.K.");
    const harbour = await employer("Harbour Freight K.K.");
    const orchard = await employer("Orchard Systems K.K.");
    const ledger = await project("Ledger reconciliation", orchard);

    // One document, filed under a project at one employer and itself under
    // another, its three facts reading through, hand set, and hand unset.
    const { importId } = await importPortfolio({ projectId: ledger, employerId: kinomi });
    const [readThrough, handSet, handUnset] = await factsOf(importId);
    await client.patch(`/api/facts/${handSet!.id}`, { employerId: harbour });
    await client.patch(`/api/facts/${handUnset!.id}`, { employerId: null });
    // A second document, under the project alone: its fact reads the project's.
    model.extractions = [
      [{ claim: "Retired the nightly export", quote: "The nightly export was retired.", technologies: [] }],
    ];
    const form = uploadForm("# Export\n\nThe nightly export was retired.\n", "export-notes.md");
    form.set("projectId", ledger);
    const second = (await (await client.request("/api/imports", { method: "POST", body: form })).json()) as {
      importId: string;
    };
    await settle();
    const [projectOnly] = await factsOf(second.importId);

    const expected = new Map([
      [readThrough!.id, kinomi],
      [handSet!.id, harbour],
      [handUnset!.id, null],
      [projectOnly!.id, orchard],
    ]);
    for (const id of expected.keys()) {
      await client.patch(`/api/facts/${id}`, { provenance: "attested", disclosure: "public" });
      await client.post(`/api/facts/${id}/accept`);
    }

    const list = new Map(
      [...(await factsOf(importId)), ...(await factsOf(second.importId))].map((f) => [f.id, f.employerId]),
    );
    const render = new Map(
      (await collectRenderInputs(app.db, userId, "english_resume", "")).facts.map((f) => [
        f.id,
        f.employer?.id ?? null,
      ]),
    );
    const versionEdit = new Map(
      (await collectEditableRecord(app.db, userId)).record.facts.map((f) => [f.id, f.employerId]),
    );
    // The attribution script's own query shape, with its alias, over the one
    // definition it imports.
    const attribution = await app.db.execute<{ id: string; employer_id: string | null }>(
      sql.raw(
        `select f.id, ${effectiveEmployerSql("f")} as employer_id from facts f where f.user_id = '${userId}'`,
      ),
    );
    const script = new Map(attribution.rows.map((row) => [row.id, row.employer_id]));

    for (const [id, employerId] of expected) {
      expect({ id, list: list.get(id), render: render.get(id), versionEdit: versionEdit.get(id), script: script.get(id) })
        .toEqual({ id, list: employerId, render: employerId, versionEdit: employerId, script: employerId });
    }
  });
});
