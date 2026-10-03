/**
 * Re-grading an accepted fact, and the listing of what is still to re-grade
 * (`docs/07` §6, ADR-0002, issue #37).
 *
 * The 2026-09-04 import's facts were accepted before a grade was recorded, so
 * each test builds that state the only way it can arise now: a document
 * imported and accepted through the API, then its `graded_at` cleared. Every
 * document and claim here is invented.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { harness, settle, stubModel, type Client, type Harness, type StubModel } from "./helpers/harness";
import { EMPLOYER_FIXTURE, seedAllowedUser, uploadForm } from "./helpers/seed";
import { facts as factsTable } from "~/server/db/schema";

interface Fact {
  id: string;
  claim: string;
  provenance: string;
  status: string;
  graded: boolean;
  likelyMatches: { id: string; provenance: string; graded: boolean }[];
}

interface Extracted {
  claim: string;
  quote: string;
}

const NARRATIVE = `# A year at Kestrel

I rebuilt the invoice export, which used to take four hours and now takes twenty minutes.

I ran the on-call rotation for the payments team.

I wrote the runbook for the ledger migration.

I mentored two new engineers through their first release.
`;
const EXPORT: Extracted = {
  claim: "Cut the invoice export from four hours to twenty minutes",
  quote: "I rebuilt the invoice export, which used to take four hours and now takes twenty minutes.",
};
const ON_CALL: Extracted = {
  claim: "Ran the on-call rotation for the payments team",
  quote: "I ran the on-call rotation for the payments team.",
};
const RUNBOOK: Extracted = {
  claim: "Wrote the runbook for the ledger migration",
  quote: "I wrote the runbook for the ledger migration.",
};
const MENTORING: Extracted = {
  claim: "Mentored two new engineers through their first release",
  quote: "I mentored two new engineers through their first release.",
};

const PORTFOLIO = `# Invoice export

The invoice export runtime fell from four hours to twenty minutes after the rebuild.
`;
const RESTATED: Extracted = {
  claim: "Reduced the invoice export runtime from four hours to twenty minutes",
  quote: "The invoice export runtime fell from four hours to twenty minutes after the rebuild.",
};

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

async function importDocument(as: Client, text: string, filename: string, extracted: Extracted[]) {
  model.extractions = [extracted.map((e) => ({ ...e, technologies: [] }))];
  const created = (await (
    await as.request("/api/imports", { method: "POST", body: uploadForm(text, filename) })
  ).json()) as { importId: string };
  await settle();
  return created.importId;
}

const factsOf = async (as: Client, query: string) =>
  (await as.json<{ items: Fact[] }>(`/api/facts?${query}`)).items;

const byClaim = (items: Fact[], claim: string) => items.find((f) => f.claim === claim)!;

/**
 * The narrative, as the 2026-09-04 import left it: every fact accepted as
 * Attested, with no grade of the author's. One is then rejected and one put
 * back to a candidate, so the listing has something to leave out.
 */
async function defaultGradedNarrative(as: Client = client, employerId?: string) {
  const importId = await importDocument(as, NARRATIVE, "narrative.md", [EXPORT, ON_CALL, RUNBOOK, MENTORING]);
  const items = await factsOf(as, `importId=${importId}`);
  for (const fact of items) {
    await as.patch(`/api/facts/${fact.id}`, {
      provenance: "attested",
      ...(employerId ? { employerId } : {}),
    });
    await as.post(`/api/facts/${fact.id}/accept`);
  }
  await app.db
    .update(factsTable)
    .set({ gradedAt: null })
    .where(inArray(factsTable.id, items.map((f) => f.id)));
  await as.post(`/api/facts/${byClaim(items, RUNBOOK.claim).id}/reject`);
  await as.post(`/api/facts/${byClaim(items, MENTORING.claim).id}/undo`);
  return {
    importId,
    exportFact: byClaim(items, EXPORT.claim),
    onCall: byClaim(items, ON_CALL.claim),
    runbook: byClaim(items, RUNBOOK.claim),
    mentoring: byClaim(items, MENTORING.claim),
  };
}

type Row = typeof factsTable.$inferSelect;

const rowOf = async (id: string) =>
  (await app.db.select().from(factsTable).where(eq(factsTable.id, id)).limit(1))[0]!;

/** Every column a re-grade must leave alone. */
const untouched = ({ provenance: _p, gradedAt: _g, updatedAt: _u, ...rest }: Row) => rest;

describe("the listing of what is still to re-grade", () => {
  it("holds exactly that import's accepted facts with no grade", async () => {
    const narrative = await defaultGradedNarrative();
    // A second import, accepted by the author on its cards: graded, so not listed.
    const graded = await importDocument(client, PORTFOLIO, "portfolio.md", [RESTATED]);
    for (const fact of await factsOf(client, `importId=${graded}`)) {
      await client.post(`/api/facts/${fact.id}/accept`);
    }

    const listing = await factsOf(client, `importId=${narrative.importId}&status=accepted&graded=false`);
    expect(listing.map((f) => f.id).sort()).toEqual([narrative.exportFact.id, narrative.onCall.id].sort());
    expect(listing.every((f) => f.status === "accepted" && !f.graded)).toBe(true);

    expect(await factsOf(client, `importId=${graded}&status=accepted&graded=false`)).toEqual([]);
    const all = await factsOf(client, "status=accepted&graded=false");
    expect(all.map((f) => f.id).sort()).toEqual([narrative.exportFact.id, narrative.onCall.id].sort());
  });

  it("never lists another user's facts", async () => {
    const other = app.as(await seedAllowedUser());
    const theirs = await defaultGradedNarrative(other);
    await defaultGradedNarrative();

    // Their import id, asked for by this user, is an empty listing, not theirs.
    expect(await factsOf(client, `importId=${theirs.importId}&status=accepted&graded=false`)).toEqual([]);
    const mine = await factsOf(client, "status=accepted&graded=false");
    expect(mine.map((f) => f.id)).not.toContain(theirs.exportFact.id);
    expect(mine.map((f) => f.id)).not.toContain(theirs.onCall.id);
    expect(mine).toHaveLength(2);
  });

  it("is empty once each is re-graded or rejected", async () => {
    const narrative = await defaultGradedNarrative();

    await client.post(`/api/facts/${narrative.exportFact.id}/regrade`, { provenance: "attested" });
    expect((await factsOf(client, `importId=${narrative.importId}&status=accepted&graded=false`)).map((f) => f.id)).toEqual([
      narrative.onCall.id,
    ]);

    await client.post(`/api/facts/${narrative.onCall.id}/reject`);
    expect(await factsOf(client, `importId=${narrative.importId}&status=accepted&graded=false`)).toEqual([]);
  });
});

describe("re-grading an accepted fact", () => {
  it("writes the provenance and the grade, and nothing else", async () => {
    const narrative = await defaultGradedNarrative();
    const others = [narrative.onCall.id, narrative.runbook.id, narrative.mentoring.id];
    const before = await rowOf(narrative.exportFact.id);
    const othersBefore = await app.db.select().from(factsTable).where(inArray(factsTable.id, others));

    const response = await client.post(`/api/facts/${narrative.exportFact.id}/regrade`, {
      provenance: "generated",
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as Fact;
    expect(body).toMatchObject({ id: narrative.exportFact.id, provenance: "generated", status: "accepted", graded: true });

    const after = await rowOf(narrative.exportFact.id);
    expect([before.provenance, before.gradedAt]).toEqual(["attested", null]);
    expect(after.provenance).toBe("generated");
    expect(after.gradedAt).not.toBeNull();
    expect(untouched(after)).toEqual(untouched(before));

    // No other fact is touched.
    const othersAfter = await app.db.select().from(factsTable).where(inArray(factsTable.id, others));
    const sort = (rows: typeof othersAfter) => [...rows].sort((a, b) => a.id.localeCompare(b.id));
    expect(sort(othersAfter)).toEqual(sort(othersBefore));
  });

  it("counts confirming the provenance it already has as a re-grade", async () => {
    const narrative = await defaultGradedNarrative();

    const response = await client.post(`/api/facts/${narrative.onCall.id}/regrade`, { provenance: "attested" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ provenance: "attested", graded: true });
  });

  it("refuses a candidate and a rejected fact, and changes neither", async () => {
    const narrative = await defaultGradedNarrative();

    for (const fact of [narrative.mentoring, narrative.runbook]) {
      const before = await rowOf(fact.id);
      const response = await client.post(`/api/facts/${fact.id}/regrade`, { provenance: "generated" });
      expect(response.status, fact.claim).toBe(409);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe("conflict");
      expect(await rowOf(fact.id)).toEqual(before);
    }
  });

  it("refuses Measured without evidence, as PATCH does", async () => {
    const narrative = await defaultGradedNarrative();
    const id = `fct_noevidence_${Date.now()}`;
    await app.db.insert(factsTable).values({
      id,
      userId,
      claim: "Led the billing guild",
      provenance: "attested",
      disclosure: "public",
      status: "accepted",
    });

    const response = await client.post(`/api/facts/${id}/regrade`, { provenance: "measured" });
    expect(response.status).toBe(422);
    expect((await rowOf(id)).gradedAt).toBeNull();

    // With evidence, Measured is a grade like the others.
    const measured = await client.post(`/api/facts/${narrative.exportFact.id}/regrade`, { provenance: "measured" });
    expect(measured.status).toBe(200);
  });

  it("refuses a provenance that is not one", async () => {
    const narrative = await defaultGradedNarrative();
    const response = await client.post(`/api/facts/${narrative.onCall.id}/regrade`, { provenance: "certain" });
    expect(response.status).toBe(422);
    expect((await rowOf(narrative.onCall.id)).gradedAt).toBeNull();
  });

  it("does not find another user's fact, and leaves it as it was", async () => {
    const other = app.as(await seedAllowedUser());
    const theirs = await defaultGradedNarrative(other);
    const before = await rowOf(theirs.onCall.id);

    const response = await client.post(`/api/facts/${theirs.onCall.id}/regrade`, { provenance: "generated" });
    expect(response.status).toBe(404);
    expect(await rowOf(theirs.onCall.id)).toEqual(before);
  });
});

describe("what records a grade", () => {
  it("accept records it, undo clears it, and reject leaves it", async () => {
    const importId = await importDocument(client, NARRATIVE, "narrative.md", [ON_CALL]);
    const [fact] = await factsOf(client, `importId=${importId}`);
    expect(fact!.graded).toBe(false);

    expect((await (await client.post(`/api/facts/${fact!.id}/accept`)).json()) as Fact).toMatchObject({ graded: true });
    expect((await (await client.post(`/api/facts/${fact!.id}/reject`)).json()) as Fact).toMatchObject({ graded: true });
    expect((await (await client.post(`/api/facts/${fact!.id}/undo`)).json()) as Fact).toMatchObject({ graded: false });
    expect((await rowOf(fact!.id)).gradedAt).toBeNull();
  });

  it("PATCH on an accepted fact records no grade", async () => {
    const narrative = await defaultGradedNarrative();
    await client.patch(`/api/facts/${narrative.onCall.id}`, { provenance: "generated" });
    expect((await rowOf(narrative.onCall.id)).gradedAt).toBeNull();
  });
});

describe("the re-grade beside a portfolio fact", () => {
  it("carries each likely match's provenance and whether it is graded", async () => {
    const kestrel = ((await (await client.post("/api/employers", EMPLOYER_FIXTURE)).json()) as { id: string }).id;
    const narrative = await defaultGradedNarrative(client, kestrel);
    const portfolio = await importDocument(client, PORTFOLIO, "portfolio.md", [RESTATED]);
    const [candidate] = await factsOf(client, `importId=${portfolio}`);
    await client.patch(`/api/facts/${candidate!.id}`, { employerId: kestrel });

    const read = async () => (await factsOf(client, `importId=${portfolio}`))[0]!.likelyMatches;
    expect(await read()).toMatchObject([{ id: narrative.exportFact.id, provenance: "attested", graded: false }]);

    await client.post(`/api/facts/${narrative.exportFact.id}/regrade`, { provenance: "measured" });
    expect(await read()).toMatchObject([{ id: narrative.exportFact.id, provenance: "measured", graded: true }]);

    // Rejecting it where it stands is the portfolio winning: the match is gone.
    await client.post(`/api/facts/${narrative.exportFact.id}/reject`);
    expect(await read()).toEqual([]);

    const rows = await app.db
      .select({ id: factsTable.id })
      .from(factsTable)
      .where(and(eq(factsTable.id, narrative.exportFact.id), eq(factsTable.status, "rejected")));
    expect(rows).toHaveLength(1);
  });
});
