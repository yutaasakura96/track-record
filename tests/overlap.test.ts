/**
 * Likely matches and conflicts on the candidate response (`docs/07` §6, PRD §8,
 * issue #36).
 *
 * Through the API, as a portfolio restating a narrative would arrive: one
 * document imported and accepted, then a second whose candidates restate it.
 * Every document and claim here is invented.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { harness, settle, stubModel, type Client, type StubModel } from "./helpers/harness";
import { EMPLOYER_FIXTURE, seedAllowedUser, uploadForm } from "./helpers/seed";
import { facts as factsTable } from "~/server/db/schema";

interface Match {
  id: string;
  claim: string;
  provenance: string;
  graded: boolean;
  document: { importId: string; filename: string; versionNo: number } | null;
  conflict: boolean;
}

interface Fact {
  id: string;
  claim: string;
  provenance: string;
  status: string;
  employerId: string | null;
  likelyMatches: Match[];
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

async function importDocument(text: string, filename: string, extracted: Extracted[], projectId?: string) {
  model.extractions = [extracted.map((e) => ({ ...e, technologies: [] }))];
  const form = uploadForm(text, filename);
  if (projectId) form.set("projectId", projectId);
  const created = (await (await client.request("/api/imports", { method: "POST", body: form })).json()) as {
    importId: string;
  };
  await settle();
  return created.importId;
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
    expect(narrativeFact!.employerId).toBeNull();

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
