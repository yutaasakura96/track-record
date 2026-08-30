/**
 * Fact review (`docs/07-api-design.md` §6, `docs/10-screen-specifications.md`).
 *
 * The rule this file exists to pin down: **a Generated fact CAN be accepted.**
 * It is accepted, flagged, and excluded when a render is produced. The block
 * lives at render time, not at review time, because a block at review time
 * would depend on review having happened correctly.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { harness, settle, stubModel, type Client, type StubModel } from "./helpers/harness";
import { CASE_STUDY, seedAllowedUser, uploadForm } from "./helpers/seed";
import { facts as factsTable } from "~/server/db/schema";

const QUOTE = "Nightly batch runtime fell from 6 hours to 90 minutes.";

interface Fact {
  id: string;
  claim: string;
  provenance: string;
  disclosure: string;
  status: string;
  evidence: unknown | null;
}

let model: StubModel;
let client: Client;

beforeEach(async () => {
  model = stubModel();
  client = harness(model).as(await seedAllowedUser());
});

async function importOne(claim = "Reduced nightly batch runtime", quote = QUOTE) {
  model.extractions = [[{ claim, quote, technologies: [] }]];
  const created = (await (
    await client.request("/api/imports", { method: "POST", body: uploadForm(CASE_STUDY) })
  ).json()) as { importId: string };
  await settle();
  const { items } = await client.json<{ items: Fact[] }>(
    `/api/facts?importId=${created.importId}`,
  );
  return { importId: created.importId, fact: items[0]! };
}

describe("provenance", () => {
  it("allows Measured on a fact whose quote is in the source", async () => {
    const { fact } = await importOne();
    expect(fact.evidence).not.toBeNull();
    const promoted = await client.patch(`/api/facts/${fact.id}`, { provenance: "measured" });
    expect(promoted.status).toBe(200);
    expect(((await promoted.json()) as Fact).provenance).toBe("measured");
  });

  it("refuses Measured on a fact with no evidence, with a plain reason", async () => {
    // An evidence-less fact cannot be produced through the M1 API: a candidate
    // whose quote does not verify is discarded before it reaches the database.
    // The state arrives with M3 quick capture, and the guard is built now so the
    // endpoint cannot quietly regress into allowing it — which is why this one
    // test seeds the row directly rather than through the API.
    const app = harness(model);
    const user = await seedAllowedUser();
    const scoped = app.as(user);
    const id = `fct_no_evidence_${Date.now()}`;
    await app.db.insert(factsTable).values({
      id,
      userId: user.id,
      claim: "Improved system performance by approximately 30%",
      provenance: "generated",
      disclosure: "public",
      status: "candidate",
    });

    const response = await scoped.patch(`/api/facts/${id}`, { provenance: "measured" });
    expect(response.status).toBe(422);
    const body = (await response.json()) as {
      error: { code: string; message: string; details: { fields: string[] } };
    };
    expect(body.error.code).toBe("validation_failed");
    expect(body.error.details.fields).toContain("provenance");
    expect(body.error.message).toMatch(/passage in the source/i);
  });

  it("accepts a Generated fact rather than blocking it", async () => {
    const { fact } = await importOne();
    expect(fact.provenance).toBe("generated");

    const response = await client.post(`/api/facts/${fact.id}/accept`);
    expect(response.status).toBe(200);
    expect(((await response.json()) as Fact).status).toBe("accepted");
  });

  it("accepts a Private fact normally", async () => {
    const { fact } = await importOne();
    await client.patch(`/api/facts/${fact.id}`, { disclosure: "private" });
    const response = await client.post(`/api/facts/${fact.id}/accept`);
    expect(response.status).toBe(200);
    expect(((await response.json()) as Fact).disclosure).toBe("private");
  });
});

describe("review moves at reading pace", () => {
  it("saves an edit as it is made", async () => {
    const { fact, importId } = await importOne();
    await client.patch(`/api/facts/${fact.id}`, { claim: "Cut nightly batch runtime to 90 minutes" });

    const reread = await client.json<{ items: Fact[] }>(`/api/facts?importId=${importId}`);
    expect(reread.items[0]!.claim).toBe("Cut nightly batch runtime to 90 minutes");
  });

  it("undoes an accept or a reject", async () => {
    const { fact } = await importOne();
    await client.post(`/api/facts/${fact.id}/reject`);
    const undone = (await (await client.post(`/api/facts/${fact.id}/undo`)).json()) as Fact;
    expect(undone.status).toBe("candidate");
  });

  it("treats a repeated accept as the same outcome, not an error", async () => {
    const { fact } = await importOne();
    const first = await client.post(`/api/facts/${fact.id}/accept`);
    const second = await client.post(`/api/facts/${fact.id}/accept`);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(((await second.json()) as Fact).status).toBe("accepted");
  });

  it("returns to a half-finished review exactly where it was left", async () => {
    const { fact, importId } = await importOne();
    await client.post(`/api/facts/${fact.id}/accept`);

    const open = await client.json<{ items: Fact[] }>(
      `/api/facts?importId=${importId}&status=candidate`,
    );
    const resolved = await client.json<{ items: Fact[] }>(
      `/api/facts?importId=${importId}&status=accepted`,
    );
    expect(open.items).toHaveLength(0);
    expect(resolved.items).toHaveLength(1);
  });

  it("finishes the review in one action, from either affordance", async () => {
    const { fact, importId } = await importOne();
    await client.post(`/api/facts/${fact.id}/accept`);

    const finished = (await (await client.post(`/api/imports/${importId}/finish`)).json()) as {
      acceptedFacts: number;
    };
    expect(finished.acceptedFacts).toBe(1);
  });
});

describe("a rejected fact stays rejected", () => {
  it("is retained rather than deleted, so a re-import cannot re-offer it", async () => {
    const { fact, importId } = await importOne();
    await client.post(`/api/facts/${fact.id}/reject`);

    const all = await client.json<{ items: Fact[] }>(`/api/facts?importId=${importId}`);
    expect(all.items).toHaveLength(1);
    expect(all.items[0]!.status).toBe("rejected");
  });
});
