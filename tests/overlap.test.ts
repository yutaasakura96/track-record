/**
 * Likely matches and conflicts on the candidate response (`docs/07` §6, PRD §8,
 * issue #36).
 *
 * Through the API, as a portfolio restating a narrative would arrive: one
 * document imported and accepted, then a second whose candidates restate it.
 * Every document and claim here is invented.
 *
 * Since issue #57 a fact is accepted on arrival, so the match a candidate's
 * card computed is kept as a `repeat` flag. Both are here: the candidate card,
 * which the backlog still reads, and the flag.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { harness, settle, stubModel, type Client, type StubModel } from "./helpers/harness";
import { asCandidates, EMPLOYER_FIXTURE, seedAllowedUser, uploadForm } from "./helpers/seed";
import { facts as factsTable } from "~/server/db/schema";

interface Match {
  id: string;
  claim: string;
  provenance: string;
  graded: boolean;
  document: { importId: string; filename: string; versionNo: number } | null;
  conflict: boolean;
}

interface Flag {
  id: string;
  kind: string;
  reason: string;
  checked: boolean;
}

interface Fact {
  id: string;
  claim: string;
  provenance: string;
  status: string;
  employerId: string | null;
  employerSetByHand: boolean;
  likelyMatches: Match[];
  flags: Flag[];
}

interface Extracted {
  claim: string;
  quote: string;
}

const NARRATIVE = `# What I did at Aozora

I spent most of that year on the settlement batch. It used to take six hours
every night, and by the end I had it finishing in about 90 minutes.

I also brought code review to the billing service, which had never had any.
`;
const NARRATIVE_BATCH: Extracted = {
  claim: "Cut the nightly settlement batch from six hours to 90 minutes",
  quote: "It used to take six hours\nevery night, and by the end I had it finishing in about 90 minutes.",
};
const NARRATIVE_REVIEW: Extracted = {
  claim: "Introduced code review for every change to the billing service",
  quote: "I also brought code review to the billing service, which had never had any.",
};

const PORTFOLIO = `# Settlement batch rewrite

Nightly batch runtime fell from 6 hours to 90 minutes.

A later pass brought the nightly settlement batch down to 80 minutes.

The team added a customer sign-in page to the tracking portal.
`;
const RESTATED: Extracted = {
  claim: "Reduced nightly batch runtime from 6 hours to 90 minutes",
  quote: "Nightly batch runtime fell from 6 hours to 90 minutes.",
};
const CONFLICTING: Extracted = {
  claim: "Reduced the nightly settlement batch runtime to 80 minutes",
  quote: "A later pass brought the nightly settlement batch down to 80 minutes.",
};
const UNRELATED: Extracted = {
  claim: "Added a customer sign-in page to the tracking portal",
  quote: "The team added a customer sign-in page to the tracking portal.",
};

let model: StubModel;
let client: Client;

beforeEach(async () => {
  model = stubModel();
  client = harness(model).as(await seedAllowedUser());
});

async function employer(nameJa = EMPLOYER_FIXTURE.nameJa) {
  const response = await client.post("/api/employers", { ...EMPLOYER_FIXTURE, nameJa });
  return ((await response.json()) as { id: string }).id;
}

/** As the importer leaves it now: every fact accepted on arrival (issue #57). */
async function importAccepted(
  text: string,
  filename: string,
  extracted: Extracted[],
  filed: { projectId?: string; employerId?: string } = {},
) {
  model.extractions = [extracted.map((e) => ({ ...e, technologies: [], provenance: "attested" as const }))];
  const form = uploadForm(text, filename);
  for (const [key, value] of Object.entries(filed)) form.set(key, value);
  const created = (await (await client.request("/api/imports", { method: "POST", body: form })).json()) as {
    importId: string;
  };
  await settle();
  return created.importId;
}

/**
 * As a document imported before automatic acceptance arrived: every fact a
 * candidate. The backlog is in this state, and its cards still compute the
 * match on the read.
 */
async function importDocument(text: string, filename: string, extracted: Extracted[], projectId?: string) {
  const importId = await importAccepted(text, filename, extracted, projectId ? { projectId } : {});
  await asCandidates(importId);
  return importId;
}

async function factsOf(importId: string) {
  return (await client.json<{ items: Fact[] }>(`/api/facts?importId=${importId}`)).items;
}

const byClaim = (items: Fact[], claim: string) => items.find((f) => f.claim === claim)!;

/** The narrative, accepted and filed under `employerId`, as the 2026-09-04 import was. */
async function acceptedNarrative(employerId: string | null) {
  const importId = await importDocument(NARRATIVE, "narrative.md", [NARRATIVE_BATCH, NARRATIVE_REVIEW]);
  for (const fact of await factsOf(importId)) {
    if (employerId) await client.patch(`/api/facts/${fact.id}`, { employerId });
    await client.post(`/api/facts/${fact.id}/accept`);
  }
  const items = await factsOf(importId);
  return { importId, batch: byClaim(items, NARRATIVE_BATCH.claim) };
}

/** The portfolio's candidates, each filed under `employerId` on its card. */
async function portfolioCandidates(employerId: string | null) {
  const importId = await importDocument(PORTFOLIO, "portfolio.md", [RESTATED, CONFLICTING, UNRELATED]);
  if (employerId) {
    for (const fact of await factsOf(importId)) {
      await client.patch(`/api/facts/${fact.id}`, { employerId });
    }
  }
  return { importId, items: await factsOf(importId) };
}

describe("a candidate is shown what it likely restates", () => {
  it("matches a restated claim, and marks a match whose number differs as a conflict", async () => {
    const aozora = await employer();
    const narrative = await acceptedNarrative(aozora);
    const { items } = await portfolioCandidates(aozora);

    const document = { importId: narrative.importId, filename: "narrative.md", versionNo: 1 };
    // Accepted on its cards, so the author's grade (issue #37).
    const graded = { id: narrative.batch.id, claim: NARRATIVE_BATCH.claim, provenance: narrative.batch.provenance, graded: true };
    expect(byClaim(items, RESTATED.claim).likelyMatches).toEqual([
      { ...graded, document, conflict: false },
    ]);
    expect(byClaim(items, CONFLICTING.claim).likelyMatches).toEqual([
      { ...graded, document, conflict: true },
    ]);
    expect(byClaim(items, UNRELATED.claim).likelyMatches).toEqual([]);
  });

  it("carries ids, claims, grades and documents, never a quote and never a score", async () => {
    const aozora = await employer();
    await acceptedNarrative(aozora);
    const { items } = await portfolioCandidates(aozora);

    const [match] = byClaim(items, RESTATED.claim).likelyMatches;
    expect(Object.keys(match!).sort()).toEqual(["claim", "conflict", "document", "graded", "id", "provenance"]);
    const body = JSON.stringify(items.map((f) => f.likelyMatches));
    expect(body).not.toContain(NARRATIVE_BATCH.quote.slice(0, 20));
  });

  it("resolves the employer through the fact's project when it has none of its own", async () => {
    const aozora = await employer();
    const project = (await (
      await client.post("/api/projects", { name: "Settlement batch", employerId: aozora })
    ).json()) as { id: string };
    const narrativeImport = await importDocument(NARRATIVE, "narrative.md", [NARRATIVE_BATCH], project.id);
    const [narrativeFact] = await factsOf(narrativeImport);
    await client.post(`/api/facts/${narrativeFact!.id}/accept`);
    // No employer of its own: it resolves to the project's.
    expect(narrativeFact!.employerSetByHand).toBe(false);
    expect(narrativeFact!.employerId).toBe(aozora);

    const { items } = await portfolioCandidates(aozora);
    expect(byClaim(items, RESTATED.claim).likelyMatches.map((m) => m.id)).toEqual([narrativeFact!.id]);
  });

  it("shows nothing on a candidate whose employer does not resolve", async () => {
    await acceptedNarrative(await employer());
    const { items } = await portfolioCandidates(null);
    expect(items.every((f) => f.likelyMatches.length === 0)).toBe(true);
  });
});

describe("what is never matched", () => {
  it("never matches a fact at another employer", async () => {
    await acceptedNarrative(await employer("株式会社ミドリ運輸"));
    const { items } = await portfolioCandidates(await employer());
    expect(items.every((f) => f.likelyMatches.length === 0)).toBe(true);
  });

  it("never matches another user's fact, even one naming this user's employer", async () => {
    const aozora = await employer();
    // Through the API another user cannot file a fact under this employer, so
    // the row is written directly: it is what a query missing its `user_id`
    // filter would find, and the only way to prove the filter is there.
    const other = await seedAllowedUser();
    await harness(model).db.insert(factsTable).values({
      id: `fct_other_${Date.now()}`,
      userId: other.id,
      employerId: aozora,
      claim: NARRATIVE_BATCH.claim,
      provenance: "attested",
      disclosure: "public",
      status: "accepted",
    });

    const { items } = await portfolioCandidates(aozora);
    expect(items.every((f) => f.likelyMatches.length === 0)).toBe(true);
  });

  it("still suppresses an exact repeat before it becomes a candidate", async () => {
    const aozora = await employer();
    await acceptedNarrative(aozora);

    // The same passage and the same claim, from a second document.
    const importId = await importDocument(`${NARRATIVE}\n`, "narrative-copy.md", [NARRATIVE_BATCH]);
    const status = await client.json<{ candidatesExtracted: number; candidatesSuppressed: number }>(
      `/api/imports/${importId}`,
    );
    expect(status.candidatesSuppressed).toBe(1);
    expect(await factsOf(importId)).toEqual([]);
  });
});

describe("the flag is settled by Accept and Reject, as they are today", () => {
  it("accepts a flagged candidate without touching the fact it matches", async () => {
    const aozora = await employer();
    const narrative = await acceptedNarrative(aozora);
    const { importId, items } = await portfolioCandidates(aozora);
    const restated = byClaim(items, RESTATED.claim);

    const accepted = await client.post(`/api/facts/${restated.id}/accept`);
    expect(accepted.status).toBe(200);
    const body = (await accepted.json()) as Fact;
    expect(body.status).toBe("accepted");
    // The flag is settled on the open card, so a resolved one carries none.
    expect(body.likelyMatches).toEqual([]);

    expect(byClaim(await factsOf(narrative.importId), NARRATIVE_BATCH.claim).status).toBe("accepted");
    expect(byClaim(await factsOf(importId), RESTATED.claim).status).toBe("accepted");
  });

  it("drops a match once it is rejected, the portfolio-wins resolution", async () => {
    const aozora = await employer();
    const narrative = await acceptedNarrative(aozora);
    const { importId, items } = await portfolioCandidates(aozora);
    const conflicting = byClaim(items, CONFLICTING.claim);
    expect(conflicting.likelyMatches).toHaveLength(1);

    // An accepted fact is rejected the way it is today: Undo, then Reject.
    await client.post(`/api/facts/${narrative.batch.id}/undo`);
    const rejected = await client.post(`/api/facts/${narrative.batch.id}/reject`);
    expect(rejected.status).toBe(200);

    expect(byClaim(await factsOf(importId), CONFLICTING.claim).likelyMatches).toEqual([]);
    // Retained, as every rejection is.
    expect(byClaim(await factsOf(narrative.importId), NARRATIVE_BATCH.claim).status).toBe("rejected");
  });

  it("rejects and undoes a flagged candidate, and the flag comes back with it", async () => {
    const aozora = await employer();
    await acceptedNarrative(aozora);
    const { items } = await portfolioCandidates(aozora);
    const conflicting = byClaim(items, CONFLICTING.claim);

    const rejected = await client.post(`/api/facts/${conflicting.id}/reject`);
    expect(rejected.status).toBe(200);
    expect(((await rejected.json()) as Fact).status).toBe("rejected");

    const undone = (await (await client.post(`/api/facts/${conflicting.id}/undo`)).json()) as Fact;
    expect(undone.status).toBe("candidate");
    expect(undone.likelyMatches.map((m) => m.conflict)).toEqual([true]);
  });
});

describe("a fact accepted on arrival is flagged when it likely restates another", () => {
  const repeatOf = (fact: Fact) => fact.flags.find((flag) => flag.kind === "repeat");
  const openRepeats = async () =>
    (await client.json<{ items: { kind: string; fact: { claim: string } }[] }>("/api/flags")).items
      .filter((item) => item.kind === "repeat")
      .map((item) => item.fact.claim)
      .sort();

  /** The narrative and then the portfolio, both filed under `employerId` at upload. */
  async function bothAccepted(employerId: string) {
    const narrativeImport = await importAccepted(NARRATIVE, "narrative.md", [NARRATIVE_BATCH, NARRATIVE_REVIEW], { employerId });
    const portfolioImport = await importAccepted(PORTFOLIO, "portfolio.md", [RESTATED, CONFLICTING, UNRELATED], { employerId });
    return { narrativeImport, portfolioImport, narrative: await factsOf(narrativeImport), portfolio: await factsOf(portfolioImport) };
  }

  it("flags the restatement and the conflict, says which is which, and shows the pair on the card", async () => {
    const { narrative, portfolio } = await bothAccepted(await employer());

    const restated = byClaim(portfolio, RESTATED.claim);
    expect(restated.status).toBe("accepted");
    expect(repeatOf(restated)!.reason).toBe(
      "It likely restates a fact already in your record. Open it to see both, and reject one if they say the same thing.",
    );
    expect(restated.likelyMatches.map((m) => [m.id, m.conflict])).toEqual([
      [byClaim(narrative, NARRATIVE_BATCH.claim).id, false],
    ]);

    const conflicting = byClaim(portfolio, CONFLICTING.claim);
    expect(repeatOf(conflicting)!.reason).toContain("the number differs");
    expect(conflicting.likelyMatches.map((m) => m.conflict)).toEqual([true]);

    expect(repeatOf(byClaim(portfolio, UNRELATED.claim))).toBeUndefined();
    // The fact that was there first is not the repeat.
    expect(narrative.every((fact) => repeatOf(fact) === undefined)).toBe(true);
    expect(await openRepeats()).toEqual([CONFLICTING.claim, RESTATED.claim].sort());
  });

  it("never flags two facts read from the same document against each other", async () => {
    const aozora = await employer();
    // The restatement and the conflict sit in one document and nothing else does.
    const importId = await importAccepted(PORTFOLIO, "portfolio.md", [RESTATED, CONFLICTING], { employerId: aozora });
    expect((await factsOf(importId)).every((fact) => repeatOf(fact) === undefined)).toBe(true);
  });

  it("flags nothing at another employer, and nothing while the employer does not resolve", async () => {
    const aozora = await employer();
    await importAccepted(NARRATIVE, "narrative.md", [NARRATIVE_BATCH], { employerId: aozora });
    await importAccepted(PORTFOLIO, "portfolio.md", [RESTATED], { employerId: await employer("株式会社ミドリ運輸") });
    await importAccepted(`${PORTFOLIO}\n`, "unfiled.md", [CONFLICTING]);
    expect(await openRepeats()).toEqual([]);
  });

  it("is raised when the employer is set on the card afterwards", async () => {
    const aozora = await employer();
    await importAccepted(NARRATIVE, "narrative.md", [NARRATIVE_BATCH], { employerId: aozora });
    const portfolioImport = await importAccepted(PORTFOLIO, "portfolio.md", [RESTATED]);
    const [unfiled] = await factsOf(portfolioImport);
    expect(repeatOf(unfiled!)).toBeUndefined();

    const filed = (await (await client.patch(`/api/facts/${unfiled!.id}`, { employerId: aozora })).json()) as Fact;
    expect(repeatOf(filed)).toBeDefined();
    expect(filed.likelyMatches).toHaveLength(1);
  });

  it("is raised when the whole document is filed under the employer afterwards", async () => {
    const aozora = await employer();
    await importAccepted(NARRATIVE, "narrative.md", [NARRATIVE_BATCH], { employerId: aozora });
    model.extractions = [[{ ...RESTATED, technologies: [], provenance: "attested" }]];
    const created = (await (
      await client.request("/api/imports", { method: "POST", body: uploadForm(PORTFOLIO, "portfolio.md") })
    ).json()) as { importId: string; sourceDocumentId: string };
    await settle();
    expect(await openRepeats()).toEqual([]);

    await client.patch(`/api/source-documents/${created.sourceDocumentId}`, { employerId: aozora });
    expect(await openRepeats()).toEqual([RESTATED.claim]);
  });

  it("takes the pair off the card when the flag is marked checked, and raises it no second time", async () => {
    const aozora = await employer();
    const { portfolio, portfolioImport } = await bothAccepted(aozora);
    const restated = byClaim(portfolio, RESTATED.claim);

    await client.post(`/api/flags/${repeatOf(restated)!.id}/check`);
    const checked = byClaim(await factsOf(portfolioImport), RESTATED.claim);
    expect(checked.likelyMatches).toEqual([]);
    expect(repeatOf(checked)!.checked).toBe(true);

    // An edit that leaves the pair standing does not raise what was dismissed.
    await client.patch(`/api/facts/${restated.id}`, { employerId: aozora });
    expect(await openRepeats()).toEqual([CONFLICTING.claim]);
  });

  it("keeps the pair on the card after the author re-grades the fact", async () => {
    const { portfolio, portfolioImport } = await bothAccepted(await employer());
    const restated = byClaim(portfolio, RESTATED.claim);

    await client.post(`/api/facts/${restated.id}/regrade`, { provenance: "measured" });
    // Grading it says nothing about the repeat: the flag is still open.
    expect(byClaim(await factsOf(portfolioImport), RESTATED.claim).likelyMatches).toHaveLength(1);
  });

  it("settles the flag when the fact it restates is rejected", async () => {
    const { narrative, portfolioImport } = await bothAccepted(await employer());

    await client.post(`/api/facts/${byClaim(narrative, NARRATIVE_BATCH.claim).id}/reject`);
    // Neither is sent to a card with one fact on it.
    expect(await openRepeats()).toEqual([]);
    const after = await factsOf(portfolioImport);
    expect(byClaim(after, RESTATED.claim).likelyMatches).toEqual([]);
    expect(repeatOf(byClaim(after, RESTATED.claim))!.checked).toBe(true);
    // The repeat itself is untouched: still accepted, still in the record.
    expect(byClaim(after, RESTATED.claim).status).toBe("accepted");
  });

  it("settles the flag when the fact is reworded so that nothing is alike", async () => {
    const { portfolio } = await bothAccepted(await employer());
    const restated = byClaim(portfolio, RESTATED.claim);

    await client.patch(`/api/facts/${restated.id}`, { claim: "Wrote the handover notes for the operations desk" });
    expect(await openRepeats()).toEqual([CONFLICTING.claim]);
  });

  it("drops the rejected repeat from the list and leaves the other fact alone", async () => {
    const { narrative, portfolio, narrativeImport } = await bothAccepted(await employer());

    await client.post(`/api/facts/${byClaim(portfolio, RESTATED.claim).id}/reject`);
    expect(await openRepeats()).toEqual([CONFLICTING.claim]);
    expect(byClaim(await factsOf(narrativeImport), NARRATIVE_BATCH.claim).status).toBe("accepted");
    expect(narrative).toHaveLength(2);
  });

  it("is raised by the sort, for a fact that was waiting", async () => {
    const aozora = await employer();
    await importAccepted(NARRATIVE, "narrative.md", [NARRATIVE_BATCH], { employerId: aozora });
    const portfolioImport = await importAccepted(PORTFOLIO, "portfolio.md", [RESTATED, UNRELATED], { employerId: aozora });
    await asCandidates(portfolioImport);
    expect(await openRepeats()).toEqual([]);

    const sorted = (await (await client.post("/api/facts/sort", {})).json()) as { sorted: number; flagged: number };
    // Both come back ungraded, so both are flagged; one of them twice.
    expect(sorted).toMatchObject({ sorted: 2, flagged: 2 });
    expect(await openRepeats()).toEqual([RESTATED.claim]);
  });

  it("never flags against another user's fact", async () => {
    const aozora = await employer();
    const other = await seedAllowedUser();
    await harness(model).db.insert(factsTable).values({
      id: `fct_other_${Date.now()}`,
      userId: other.id,
      employerId: aozora,
      claim: NARRATIVE_BATCH.claim,
      provenance: "attested",
      disclosure: "public",
      status: "accepted",
    });

    await importAccepted(PORTFOLIO, "portfolio.md", [RESTATED, CONFLICTING], { employerId: aozora });
    expect(await openRepeats()).toEqual([]);
  });
});
