/**
 * Quick capture, through the API (`docs/07` §6, `docs/09` Flow 6, issue #95).
 *
 * What is pinned here: reading stores nothing and offers the model only the
 * author's own employers and projects; a failed reading is a 503 the screen
 * turns into the plain form; a save puts every claim straight into the record,
 * accepted and Attested with the author's grade, no source and no quote, and
 * Restricted unless the shape check makes it Private; filing by employer,
 * project or `No employer` is the author's and checked for ownership; and a
 * rejected captured fact comes back accepted on undo. Every text is INVENTED.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { harness, stubModel, type Client, type StubModel } from "./helpers/harness";
import { EMPLOYER_FIXTURE, SECOND_EMAIL, seedAllowedUser } from "./helpers/seed";
import { createDb } from "~/server/db/client";
import { facts } from "~/server/db/schema";
import { ModelUnavailableError, type CapturedClaim } from "~/model";
import type { Bindings } from "~/server/env";

const db = createDb((env as unknown as Bindings).DATABASE_URL);

const TEXT_EN = "Last month I moved the Corvel nightly export onto a queue. The morning report now arrives by 7:00.";
const TEXT_JA = "先月、受注データの夜間集計をキュー処理に切り替えた。朝の帳票が7時までに届くようになった。";

interface Saved {
  id: string;
  claim: string;
  status: string;
  provenance: string;
  disclosure: string;
  month: string | null;
  employerId: string | null;
  employerSetByHand: boolean;
  projectId: string | null;
  evidence: unknown;
  graded: boolean;
  gradedBy: string | null;
  autoAccepted: boolean;
  flags: { kind: string; reason: string }[];
}

let model: StubModel;
let client: Client;
let employerId: string;

beforeEach(async () => {
  model = stubModel();
  client = harness(model).as(await seedAllowedUser());
  employerId = ((await (await client.post("/api/employers", EMPLOYER_FIXTURE)).json()) as { id: string }).id;
});

const claim = (overrides: Partial<CapturedClaim> = {}): CapturedClaim => ({
  claim: "Moved the nightly export onto a queue.",
  month: "2026-09",
  employerId: null,
  projectId: null,
  technologies: [],
  missing: [],
  ...overrides,
});

const readIt = async (text: string, as: Client = client) => {
  const response = await as.post("/api/capture/read", { text, today: "2026-10" });
  return { status: response.status, body: (await response.json()) as { claims?: CapturedClaim[]; error?: { code: string } } };
};

const saveIt = async (claims: Record<string, unknown>[], as: Client = client) => {
  const response = await as.post("/api/capture", { claims });
  return { status: response.status, body: (await response.json()) as { items: Saved[] } };
};

const captured = (as: Client = client) => as.json<{ items: Saved[] }>("/api/facts?captured=true");

describe("reading what was typed", () => {
  it("proposes claims, with the author's employers and this month to read against, and stores nothing", async () => {
    const proposed = [
      claim({ claim: "Moved the Corvel nightly export onto a queue.", employerId: null, missing: ["employer", "proof"] }),
      claim({ claim: "The morning report now arrives by 7:00.", missing: ["employer"] }),
    ];
    model.captures = [proposed];

    expect(await readIt(`  ${TEXT_EN}\n`)).toEqual({ status: 200, body: { claims: proposed } });
    expect(model.captureCalls).toHaveLength(1);
    // The text as typed, trimmed. The employer by id and by both of its names, and nothing else of it.
    expect(model.captureCalls[0]).toEqual({
      text: TEXT_EN,
      context: {
        today: "2026-10",
        employers: [{ id: employerId, name: `${EMPLOYER_FIXTURE.nameJa} / ${EMPLOYER_FIXTURE.nameLatin}` }],
        projects: [],
      },
    });
    expect((await captured()).items).toEqual([]);
  });

  it("reads Japanese as it reads English", async () => {
    const proposed = [claim({ claim: "夜間集計をキュー処理に切り替えた。", month: "2026-09" })];
    model.captures = [proposed];
    expect(await readIt(TEXT_JA)).toEqual({ status: 200, body: { claims: proposed } });
  });

  it("answers an empty list when the text makes no claim, which opens the plain form", async () => {
    model.captures = [[]];
    expect(await readIt("Tired today.")).toEqual({ status: 200, body: { claims: [] } });
  });

  it("answers 503 when the model fails, so the screen opens the plain form instead", async () => {
    model.captures = [new ModelUnavailableError("down")];
    const { status, body } = await readIt(TEXT_EN);
    expect(status).toBe(503);
    expect(body.error?.code).toBe("upstream_unavailable");
  });

  it("refuses an empty text before calling the model", async () => {
    expect((await readIt("   ")).status).toBe(422);
    expect(model.captureCalls).toEqual([]);
  });

  it("never offers the model another user's employers", async () => {
    const other = harness(model).as(await seedAllowedUser(SECOND_EMAIL));
    await readIt(TEXT_EN, other);
    expect(model.captureCalls[0]!.context.employers).toEqual([]);
  });
});

describe("saving the confirmed claims", () => {
  it("puts them straight into the record: accepted, Attested, graded by the author, no source and no quote", async () => {
    const { status, body } = await saveIt([
      { claim: "Moved the nightly export onto a queue.", month: "2026-09", employerId, technologies: ["RabbitMQ"] },
      { claim: "The morning report now arrives by 7:00.", month: null },
    ]);
    expect(status).toBe(201);
    expect(body.items).toHaveLength(2);
    for (const fact of body.items) {
      expect(fact).toMatchObject({
        status: "accepted",
        provenance: "attested",
        disclosure: "restricted",
        evidence: null,
        graded: true,
        gradedBy: "author",
        autoAccepted: false,
      });
    }
    const [first, second] = body.items.sort((a, b) => a.claim.localeCompare(b.claim));
    expect(first).toMatchObject({ claim: "Moved the nightly export onto a queue.", month: "2026-09", employerId, employerSetByHand: true });
    // Nothing said about where: left unfiled, not filed under `No employer`.
    expect(second).toMatchObject({ month: null, employerId: null, employerSetByHand: false });
    // A number with no passage is not flagged for checking against one.
    expect(second!.flags).toEqual([]);

    const rows = await db.select().from(facts).where(eq(facts.id, first!.id));
    expect(rows[0]).toMatchObject({
      sourceDocumentVersionId: null,
      quote: null,
      quoteStart: null,
      quoteEnd: null,
      occurredOn: "2026-09-01",
      technologies: ["RabbitMQ"],
    });
    expect(rows[0]!.gradedAt).not.toBeNull();
    expect(rows[0]!.autoAcceptedAt).toBeNull();
    expect((await captured()).items.map((fact) => fact.id).sort()).toEqual(body.items.map((fact) => fact.id).sort());
  });

  it("makes a claim Private, and flags why, when it has a confidential shape", async () => {
    const { body } = await saveIt([{ claim: "Moved the export off host 10.24.6.19 onto a queue.", month: null }]);
    expect(body.items[0]).toMatchObject({ provenance: "attested", disclosure: "private" });
    expect(body.items[0]!.flags.map((flag) => flag.kind)).toEqual(["confidential"]);
  });

  it("files a claim under a project, or under a chosen No employer", async () => {
    const project = (await (await client.post("/api/projects", { name: "Harbour scheduling", employerId })).json()) as {
      id: string;
    };
    const { body } = await saveIt([
      { claim: "Wrote the berth allocation rules.", month: null, projectId: project.id },
      { claim: "Ran a study group on weekends.", month: null, employerId: null },
    ]);
    const [rules, study] = body.items.sort((a, b) => a.claim.localeCompare(b.claim)).reverse();
    // Through the project, to the project's employer, as an imported fact would be.
    expect(rules).toMatchObject({ projectId: project.id, employerId, employerSetByHand: false });
    expect(study).toMatchObject({ projectId: null, employerId: null, employerSetByHand: true });
  });

  it("refuses another user's employer or project, and saves nothing", async () => {
    const other = harness(model).as(await seedAllowedUser(SECOND_EMAIL));
    const theirs = ((await (await other.post("/api/employers", EMPLOYER_FIXTURE)).json()) as { id: string }).id;
    const project = (await (await other.post("/api/projects", { name: "Their project" })).json()) as { id: string };

    expect((await saveIt([{ claim: "A claim.", month: null, employerId: theirs }])).status).toBe(404);
    expect((await saveIt([{ claim: "A claim.", month: null, projectId: project.id }])).status).toBe(404);
    expect((await captured()).items).toEqual([]);
  });

  it("refuses an empty claim, a malformed month and a claim filed twice over", async () => {
    expect((await saveIt([])).status).toBe(422);
    expect((await saveIt([{ claim: "  ", month: null }])).status).toBe(422);
    expect((await saveIt([{ claim: "A claim.", month: "2026-13" }])).status).toBe(422);
    const project = (await (await client.post("/api/projects", { name: "Harbour scheduling" })).json()) as { id: string };
    expect((await saveIt([{ claim: "A claim.", month: null, employerId, projectId: project.id }])).status).toBe(422);
    expect((await captured()).items).toEqual([]);
  });

  it("keeps a captured fact out of every other user's listing", async () => {
    await saveIt([{ claim: "Moved the nightly export onto a queue.", month: null }]);
    const other = harness(model).as(await seedAllowedUser(SECOND_EMAIL));
    expect((await captured(other)).items).toEqual([]);
  });
});

describe("a captured fact on its card", () => {
  it("can be edited, given a month, rejected, and comes back accepted on undo", async () => {
    const [fact] = (await saveIt([{ claim: "Moved the nightly export onto a queue.", month: null }])).body.items;

    const edited = (await (await client.patch(`/api/facts/${fact!.id}`, { claim: "Moved the nightly export onto a job queue.", month: "2026-08" })).json()) as Saved;
    expect(edited).toMatchObject({ claim: "Moved the nightly export onto a job queue.", month: "2026-08", status: "accepted" });

    const rejected = (await (await client.post(`/api/facts/${fact!.id}/reject`)).json()) as Saved;
    expect(rejected.status).toBe("rejected");

    // Never a candidate: it was never waiting to be sorted.
    const undone = (await (await client.post(`/api/facts/${fact!.id}/undo`)).json()) as Saved;
    expect(undone).toMatchObject({ status: "accepted", provenance: "attested", gradedBy: "author" });
  });

  it("raises no number flag when reworded with a number, and still flags a confidential shape", async () => {
    const [fact] = (await saveIt([{ claim: "Moved the nightly export onto a queue.", month: null }])).body.items;

    const reworded = (await (await client.patch(`/api/facts/${fact!.id}`, { claim: "Cut the nightly batch from 6 hours to 90 minutes." })).json()) as Saved;
    expect(reworded.flags).toEqual([]);

    const shaped = (await (await client.patch(`/api/facts/${fact!.id}`, { claim: "Cut the batch on host 10.24.6.19 from 6 hours to 90 minutes." })).json()) as Saved;
    expect(shaped.flags.map((flag) => flag.kind)).toEqual(["confidential"]);
    expect(shaped.disclosure).toBe("private");
  });
});
