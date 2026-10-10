/**
 * Automatic acceptance, the flagged list, `Explain this` and the sort of the
 * waiting backlog, through the API (`docs/07` §6, issue #57).
 *
 * The rules a flag is raised by are stated in `flag-rules.test.ts`. What is
 * pinned here is what the author can rely on: nothing waits and nothing is
 * rejected, a confidential fact never reaches a document, the list is read
 * without spending a token, and one press of `Explain this` is one model call.
 * Every document and claim here is invented.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { harness, settle, stubModel, type Client, type Harness, type StubModel } from "./helpers/harness";
import { asCandidates, PROFILE_FIXTURE, SECOND_EMAIL, seedAllowedUser, uploadForm } from "./helpers/seed";
import { factFlags, facts as factsTable } from "~/server/db/schema";
import { ModelUnavailableError, type CandidateFact, type FactGrade } from "~/model/types";

interface Flag {
  id: string;
  kind: "confidential" | "number" | "unsure" | "repeat";
  reason: string;
  explanation: string | null;
  checked: boolean;
}

interface Fact {
  id: string;
  claim: string;
  provenance: string;
  disclosure: string;
  status: string;
  graded: boolean;
  autoAccepted: boolean;
  gradedBy: "author" | "importer" | null;
  flags: Flag[];
}

interface Listing {
  counts: { open: number; checked: number };
  items: (Flag & {
    fact: {
      id: string;
      claim: string;
      provenance: string;
      disclosure: string;
      lineNumber: number | null;
      importId: string | null;
      filename: string | null;
    };
  })[];
}

const PLAIN: CandidateFact = {
  claim: "Introduced code review for the billing service",
  quote: "I brought code review to the billing service, which had never had any.",
  technologies: [],
  provenance: "attested",
};
const NUMBERED: CandidateFact = {
  claim: "Cut the nightly settlement run from 6 hours to 90 minutes",
  quote: "The nightly settlement run fell from 6 hours to 90 minutes.",
  technologies: [],
  provenance: "measured",
};
const CLIENT: CandidateFact = {
  claim: "Rebuilt the settlement ledger for the retail client",
  quote: "The retail client's settlement ledger was rebuilt over one quarter.",
  technologies: [],
  provenance: "attested",
  confidential: true,
  note: "It names a client's system",
};
const SHAPED: CandidateFact = {
  claim: "Owned the vendor escalation path",
  quote: "Escalations went to desk-lead@vendor.example.invalid first.",
  technologies: [],
  provenance: "attested",
};
const GUESSED: CandidateFact = {
  claim: "Improved the team's delivery confidence",
  quote: "Releases felt calmer by the end of the year.",
  technologies: [],
  provenance: "generated",
};
const DOUBTED: CandidateFact = {
  claim: "Led the ledger migration",
  quote: "The ledger migration finished in the spring.",
  technologies: [],
  provenance: "attested",
  unsure: true,
  note: "The passage does not say who led it",
};
const UNGRADED: CandidateFact = {
  claim: "Wrote the on-call runbook",
  quote: "An on-call runbook was written for the payments team.",
  technologies: [],
};

const EVERY = [PLAIN, NUMBERED, CLIENT, SHAPED, GUESSED, DOUBTED, UNGRADED];

let model: StubModel;
let app: Harness;
let client: Client;

beforeEach(async () => {
  model = stubModel();
  app = harness(model);
  client = app.as(await seedAllowedUser());
});

async function imported(candidates: CandidateFact[], as: Client = client, filename = "kestrel-notes.md") {
  model.extractions = [candidates];
  const text = `# Notes\n\n${candidates.map((c) => c.quote).join("\n\n")}\n`;
  const { importId } = (await (
    await as.request("/api/imports", { method: "POST", body: uploadForm(text, filename) })
  ).json()) as { importId: string };
  await settle();
  return importId;
}

const factsOf = async (importId: string, as: Client = client) =>
  (await as.json<{ items: Fact[] }>(`/api/facts?importId=${importId}`)).items;
const of = (items: Fact[], candidate: CandidateFact) => items.find((f) => f.claim === candidate.claim)!;
const listing = (as: Client = client, state = "") => as.json<Listing>(`/api/flags${state ? `?state=${state}` : ""}`);
const kindsOf = (fact: Fact) => fact.flags.map((flag) => flag.kind);

describe("what an import leaves behind", () => {
  it("accepts every fact it read, with the importer's grade, and leaves none waiting", async () => {
    const items = await factsOf(await imported(EVERY));

    expect(items).toHaveLength(EVERY.length);
    for (const fact of items) {
      expect(fact.status).toBe("accepted");
      expect(fact.autoAccepted).toBe(true);
      expect(fact.gradedBy).toBe("importer");
      // Nothing an import reads is stored as Public.
      expect(fact.disclosure).not.toBe("public");
    }
    expect(of(items, PLAIN)).toMatchObject({ provenance: "attested", disclosure: "restricted", flags: [] });
    expect(of(items, NUMBERED)).toMatchObject({ provenance: "measured", disclosure: "restricted" });
    expect(of(items, GUESSED)).toMatchObject({ provenance: "generated", disclosure: "restricted" });
  });

  it("flags what there is to check, and every flag says why", async () => {
    const items = await factsOf(await imported(EVERY));

    expect(kindsOf(of(items, NUMBERED))).toEqual(["number"]);
    expect(kindsOf(of(items, CLIENT))).toEqual(["confidential"]);
    expect(kindsOf(of(items, SHAPED))).toEqual(["confidential"]);
    expect(kindsOf(of(items, GUESSED))).toEqual(["unsure"]);
    expect(kindsOf(of(items, DOUBTED))).toEqual(["unsure"]);
    expect(kindsOf(of(items, UNGRADED))).toEqual(["unsure"]);
    for (const flag of items.flatMap((fact) => fact.flags)) {
      expect(flag.reason.length).toBeGreaterThan(20);
      expect(flag.explanation).toBeNull();
      expect(flag.checked).toBe(false);
    }
  });

  it("keeps a confidential fact Private, by the importer's reading or by its shape", async () => {
    const items = await factsOf(await imported(EVERY));

    expect(of(items, CLIENT).disclosure).toBe("private");
    expect(of(items, CLIENT).flags[0]!.reason).toContain("It names a client's system.");
    expect(of(items, SHAPED).disclosure).toBe("private");
    // The kind of identifier, never the identifier.
    expect(of(items, SHAPED).flags[0]!.reason).toContain("an email address");
    expect(JSON.stringify(of(items, SHAPED).flags)).not.toContain("desk-lead");
  });

  it("keeps a fact the importer returned no grade for, as Generated, rather than dropping it", async () => {
    const items = await factsOf(await imported([UNGRADED]));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ status: "accepted", provenance: "generated", disclosure: "restricted" });
  });

  it("still discards the one thing it must: a quote that is not in the document", async () => {
    model.extractions = [[PLAIN, { ...NUMBERED, quote: "The nightly settlement run fell to 45 minutes." }]];
    const text = `# Notes\n\n${PLAIN.quote}\n\n${NUMBERED.quote}\n`;
    const { importId } = (await (
      await client.request("/api/imports", { method: "POST", body: uploadForm(text) })
    ).json()) as { importId: string };
    await settle();

    expect((await factsOf(importId)).map((f) => f.claim)).toEqual([PLAIN.claim]);
    const status = await client.json<{ candidatesDiscarded: number }>(`/api/imports/${importId}`);
    expect(status.candidatesDiscarded).toBe(1);
  });

  it("gives the next résumé every usable fact unopened, and never a Private or Generated one", async () => {
    await client.put("/api/profile", PROFILE_FIXTURE);
    await imported(EVERY);

    model.generations = [{ sections: [] }];
    const response = await client.post("/api/renders/english_resume/generate");
    await settle();
    expect(response.status).toBe(202);

    const given = model.generationInputs.at(-1)!.facts.map((fact) => fact.claim).sort();
    // The flagged number and the flagged doubt are advice: both are usable.
    expect(given).toEqual([DOUBTED.claim, NUMBERED.claim, PLAIN.claim].sort());
    expect(model.generationInputs.at(-1)!.facts.every((fact) => fact.disclosure !== ("private" as string))).toBe(true);
  });

  it("puts a rejected fact back where the importer left it on undo, flags and all", async () => {
    const [fact] = await factsOf(await imported([NUMBERED]));
    const rejected = (await (await client.post(`/api/facts/${fact!.id}/reject`)).json()) as Fact;
    expect(rejected.status).toBe("rejected");

    const undone = (await (await client.post(`/api/facts/${fact!.id}/undo`)).json()) as Fact;
    expect(undone).toMatchObject({ status: "accepted", autoAccepted: true, gradedBy: "importer" });
    expect(kindsOf(undone)).toEqual(["number"]);
  });

  it("records the author's grade as the author's once they re-grade it", async () => {
    const [fact] = await factsOf(await imported([GUESSED]));
    const regraded = (await (
      await client.post(`/api/facts/${fact!.id}/regrade`, { provenance: "attested" })
    ).json()) as Fact;
    expect(regraded).toMatchObject({ provenance: "attested", gradedBy: "author", autoAccepted: true });
  });
});

describe("the flagged list", () => {
  it("lists every open flag with its fact and where to open it, what keeps a fact out of documents first", async () => {
    const importId = await imported(EVERY);
    const body = await listing();

    expect(body.counts).toEqual({ open: 6, checked: 0 });
    expect(body.items.map((item) => item.kind)).toEqual([
      "confidential",
      "confidential",
      "unsure",
      "unsure",
      "unsure",
      "number",
    ]);
    const numbered = body.items.find((item) => item.kind === "number")!;
    expect(numbered.fact).toMatchObject({
      claim: NUMBERED.claim,
      provenance: "measured",
      disclosure: "restricted",
      importId,
      filename: "kestrel-notes.md",
    });
    expect(numbered.fact.lineNumber).toBeGreaterThan(0);
    expect(numbered.reason).toBe("It states a number. Check the number against the passage it was read from.");
  });

  it("carries no passage from the source document", async () => {
    await imported(EVERY);
    const body = JSON.stringify(await listing());
    for (const candidate of EVERY) expect(body).not.toContain(candidate.quote.slice(0, 24));
  });

  it("is read without a model call, however often", async () => {
    await imported(EVERY);
    await listing();
    await listing(client, "checked");
    await client.get("/api/overview");
    await client.get("/api/imports/summary");

    expect(model.explainCalls).toEqual([]);
    expect(model.gradeCalls).toEqual([]);
  });

  it("moves a flag off the list when it is marked checked, and back again", async () => {
    await imported([NUMBERED, DOUBTED]);
    const [first] = (await listing()).items;

    const checked = await client.post(`/api/flags/${first!.id}/check`);
    expect(checked.status).toBe(200);
    expect(((await checked.json()) as Flag).checked).toBe(true);
    // A double-click is the same outcome, not an error.
    expect((await client.post(`/api/flags/${first!.id}/check`)).status).toBe(200);

    expect((await listing()).counts).toEqual({ open: 1, checked: 1 });
    expect((await listing()).items.map((item) => item.id)).not.toContain(first!.id);
    expect((await listing(client, "checked")).items.map((item) => item.id)).toEqual([first!.id]);
    expect((await client.json<{ openFlags: number }>("/api/imports/summary")).openFlags).toBe(1);
    expect((await client.json<{ flagged: number }>("/api/overview")).flagged).toBe(1);

    const back = (await (await client.post(`/api/flags/${first!.id}/uncheck`)).json()) as Flag;
    expect(back.checked).toBe(false);
    expect((await listing()).counts).toEqual({ open: 2, checked: 0 });
  });

  it("changes nothing about the fact when its flag is marked checked", async () => {
    const [before] = await factsOf(await imported([CLIENT]));
    await client.post(`/api/flags/${before!.flags[0]!.id}/check`);

    const [row] = await app.db.select().from(factsTable).where(eq(factsTable.id, before!.id));
    // Checked is "I have looked". Making a Private fact usable is a separate act.
    expect(row).toMatchObject({ status: "accepted", disclosure: "private", provenance: "attested", gradedAt: null });
  });

  it("drops a rejected fact's flags from the list, and brings them back with it", async () => {
    const [fact] = await factsOf(await imported([NUMBERED]));
    await client.post(`/api/facts/${fact!.id}/reject`);
    expect((await listing()).counts).toEqual({ open: 0, checked: 0 });
    expect((await client.json<{ flagged: number }>("/api/overview")).flagged).toBe(0);

    await client.post(`/api/facts/${fact!.id}/undo`);
    expect((await listing()).counts).toEqual({ open: 1, checked: 0 });
  });

  it("is in the export, reason and explanation with it, and only the reader's own", async () => {
    const other = app.as(await seedAllowedUser(SECOND_EMAIL));
    const [fact] = await factsOf(await imported([NUMBERED]));
    model.explanations = ["Read the two figures against the passage."];
    await client.post(`/api/flags/${fact!.flags[0]!.id}/explain`);

    const mine = await client.json<{ factFlags: Record<string, unknown>[] }>("/api/export");
    expect(mine.factFlags).toHaveLength(1);
    expect(mine.factFlags[0]).toMatchObject({
      factId: fact!.id,
      kind: "number",
      reason: fact!.flags[0]!.reason,
      explanation: "Read the two figures against the passage.",
      checkedAt: null,
    });
    expect(mine.factFlags[0]).not.toHaveProperty("userId");
    expect((await other.json<{ factFlags: unknown[] }>("/api/export")).factFlags).toEqual([]);
  });

  it("shows and changes only the reader's own flags", async () => {
    const other = app.as(await seedAllowedUser(SECOND_EMAIL));
    await imported([NUMBERED, CLIENT]);
    const [mine] = (await listing()).items;

    expect(await listing(other)).toEqual({ counts: { open: 0, checked: 0 }, items: [] });
    for (const action of ["explain", "check", "uncheck"]) {
      const response = await other.post(`/api/flags/${mine!.id}/${action}`);
      expect(response.status, action).toBe(404);
    }
    expect(model.explainCalls).toEqual([]);
    expect((await listing()).counts).toEqual({ open: 2, checked: 0 });
  });
});

describe("Explain this", () => {
  it("makes one model call on the press, about that flag and its fact, and stores the answer", async () => {
    const [fact] = await factsOf(await imported([NUMBERED]));
    const flag = fact!.flags[0]!;
    model.explanations = ["The claim gives two figures. Read them against the passage before you rely on them."];
    model.usage = { inputTokens: 210, outputTokens: 40, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };

    const response = await client.post(`/api/flags/${flag.id}/explain`);
    expect(response.status).toBe(200);
    expect(((await response.json()) as Flag).explanation).toBe(
      "The claim gives two figures. Read them against the passage before you rely on them.",
    );
    expect(model.explainCalls).toEqual([
      {
        kind: "number",
        reason: flag.reason,
        claim: NUMBERED.claim,
        quote: NUMBERED.quote,
        provenance: "measured",
        disclosure: "restricted",
      },
    ]);

    const [row] = await app.db.select().from(factFlags).where(eq(factFlags.id, flag.id));
    expect(row).toMatchObject({ inputTokens: 210, outputTokens: 40, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 });
  });

  it("reads the stored answer back on a second press, and spends nothing", async () => {
    const importId = await imported([NUMBERED]);
    const [fact] = await factsOf(importId);
    const flag = fact!.flags[0]!;
    model.explanations = ["First answer.", "A second answer that must never be asked for."];

    await client.post(`/api/flags/${flag.id}/explain`);
    const again = (await (await client.post(`/api/flags/${flag.id}/explain`)).json()) as Flag;

    expect(again.explanation).toBe("First answer.");
    expect(model.explainCalls).toHaveLength(1);
    // And it travels with the flag from then on, on the list and on the card.
    expect((await listing()).items[0]!.explanation).toBe("First answer.");
    expect((await factsOf(importId))[0]!.flags[0]!.explanation).toBe("First answer.");
  });

  it("answers 503 when the model is unavailable, stores nothing, and works on the next press", async () => {
    const [fact] = await factsOf(await imported([DOUBTED]));
    const flag = fact!.flags[0]!;
    model.explanations = [new ModelUnavailableError("down"), "It was not clear who led the work."];

    const failed = await client.post(`/api/flags/${flag.id}/explain`);
    expect(failed.status).toBe(503);
    expect(((await failed.json()) as { error: { code: string; message: string } }).error).toMatchObject({
      code: "upstream_unavailable",
      message: "The explanation could not be written just now. Try again.",
    });
    expect((await listing()).items[0]!.explanation).toBeNull();

    const retried = (await (await client.post(`/api/flags/${flag.id}/explain`)).json()) as Flag;
    expect(retried.explanation).toBe("It was not clear who led the work.");
  });

  it("answers 404 for a flag that does not exist", async () => {
    expect((await client.post("/api/flags/flg_missing/explain")).status).toBe(404);
    expect(model.explainCalls).toEqual([]);
  });
});

describe("sorting the facts that were waiting", () => {
  const graded = (grades: Record<string, Partial<FactGrade>>) => (asked: { id: string; claim: string }[]) =>
    Object.fromEntries(
      asked
        .filter((fact) => grades[fact.claim])
        .map((fact) => [
          fact.id,
          { provenance: "attested", confidential: false, unsure: false, note: "", ...grades[fact.claim] } as FactGrade,
        ]),
    );

  /** A document imported before automatic acceptance: every fact a candidate. */
  async function waiting(candidates: CandidateFact[], as: Client = client, filename?: string) {
    const importId = await imported(candidates.map(({ claim, quote, technologies }) => ({ claim, quote, technologies })), as, filename);
    await asCandidates(importId);
    return importId;
  }

  it("grades and accepts every waiting fact in one press, and flags what there is to check", async () => {
    const importId = await waiting([PLAIN, NUMBERED, CLIENT, UNGRADED]);
    model.gradings = [
      graded({
        [PLAIN.claim]: {},
        [NUMBERED.claim]: { provenance: "measured" },
        [CLIENT.claim]: { confidential: true, note: "It names a client's system" },
      }),
    ];

    const response = await client.post("/api/facts/sort", {});
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sorted: 4, flagged: 3, remaining: 0 });
    // The claim and the passage, and nothing else about the fact.
    expect(model.gradeCalls[0]!.map((fact) => Object.keys(fact).sort())).toEqual(
      Array.from({ length: 4 }, () => ["claim", "id", "quote"]),
    );

    const items = await factsOf(importId);
    expect(items.every((fact) => fact.status === "accepted" && fact.autoAccepted)).toBe(true);
    expect(of(items, PLAIN)).toMatchObject({ provenance: "attested", disclosure: "restricted", flags: [] });
    expect(of(items, NUMBERED).provenance).toBe("measured");
    expect(kindsOf(of(items, NUMBERED))).toEqual(["number"]);
    expect(of(items, CLIENT).disclosure).toBe("private");
    // No grade came back for it: kept as Generated and flagged, never left waiting.
    expect(of(items, UNGRADED).provenance).toBe("generated");
    expect(kindsOf(of(items, UNGRADED))).toEqual(["unsure"]);
  });

  it("takes twenty-five at a time, and says how many are left", async () => {
    const words = "amber birch cedar delta ember fjord grove heron inlet jetty kelp larch moss north otter pine quay reed slate tern umber vale wren yarrow zephyr alder brook cairn dune elm".split(" ");
    const importId = await waiting(
      words.map((word) => ({
        claim: `Finished the ${word} work item`,
        quote: `The ${word} work item was finished on schedule.`,
        technologies: [],
      })),
    );

    expect(await (await client.post("/api/facts/sort", { importId })).json()).toEqual({ sorted: 25, flagged: 25, remaining: 5 });
    expect(await (await client.post("/api/facts/sort", { importId })).json()).toEqual({ sorted: 5, flagged: 5, remaining: 0 });
    // Nothing left: no model call, and nothing to report.
    expect(await (await client.post("/api/facts/sort", { importId })).json()).toEqual({ sorted: 0, flagged: 0, remaining: 0 });
    expect(model.gradeCalls.map((batch) => batch.length)).toEqual([25, 5]);
  });

  it("changes nothing when the model is unavailable", async () => {
    const importId = await waiting([PLAIN, NUMBERED]);
    model.gradings = [new ModelUnavailableError("down")];

    const response = await client.post("/api/facts/sort", {});
    expect(response.status).toBe(503);
    expect(((await response.json()) as { error: { message: string } }).error.message).toBe(
      "The facts could not be sorted just now. Nothing was changed; try again.",
    );
    expect((await factsOf(importId)).map((fact) => fact.status)).toEqual(["candidate", "candidate"]);
    expect((await listing()).counts.open).toBe(0);
  });

  it("never loosens a disclosure the author already set", async () => {
    const importId = await waiting([PLAIN, NUMBERED, CLIENT]);
    const before = await factsOf(importId);
    await client.patch(`/api/facts/${of(before, PLAIN).id}`, { disclosure: "private" });
    await client.patch(`/api/facts/${of(before, NUMBERED).id}`, { disclosure: "public" });
    await client.patch(`/api/facts/${of(before, CLIENT).id}`, { disclosure: "public" });
    model.gradings = [
      graded({ [PLAIN.claim]: {}, [NUMBERED.claim]: {}, [CLIENT.claim]: { confidential: true } }),
    ];

    await client.post("/api/facts/sort", {});
    const after = await factsOf(importId);
    expect(of(after, PLAIN).disclosure).toBe("private");
    expect(of(after, NUMBERED).disclosure).toBe("public");
    // Public by the author's hand, and read as confidential: Private wins.
    expect(of(after, CLIENT).disclosure).toBe("private");
  });

  it("sorts only the import it is given, and only the reader's own facts", async () => {
    const other = app.as(await seedAllowedUser(SECOND_EMAIL));
    const mine = await waiting([PLAIN]);
    const alsoMine = await waiting([NUMBERED], client, "second.md");
    const theirs = await waiting([DOUBTED], other, "theirs.md");

    expect(await (await client.post("/api/facts/sort", { importId: mine })).json()).toMatchObject({ sorted: 1, remaining: 0 });
    expect((await factsOf(alsoMine))[0]!.status).toBe("candidate");

    // Another user's import id sorts nothing, and their fact still waits.
    expect(await (await client.post("/api/facts/sort", { importId: theirs })).json()).toEqual({ sorted: 0, flagged: 0, remaining: 0 });
    expect(await (await client.post("/api/facts/sort", {})).json()).toMatchObject({ sorted: 1, remaining: 0 });
    expect((await factsOf(theirs, other))[0]!.status).toBe("candidate");
    expect(model.gradeCalls.flat().map((fact) => fact.claim)).not.toContain(DOUBTED.claim);
  });

  it("writes flags only for candidates whose guarded sort update won", async () => {
    const importId = await waiting([PLAIN, NUMBERED, CLIENT, DOUBTED]);
    const before = await factsOf(importId);
    let releaseGrade!: () => void;
    let gradingStarted!: () => void;
    const started = new Promise<void>((resolve) => { gradingStarted = resolve; });
    const released = new Promise<void>((resolve) => { releaseGrade = resolve; });
    model.gradeFacts = async (facts) => {
      gradingStarted();
      await released;
      return new Map(facts.map((fact) => [fact.id, {
        provenance: "attested" as const, confidential: true, unsure: false, note: "It names a client.",
      }]));
    };

    const sorting = client.post("/api/facts/sort", { importId });
    await started;
    await client.post(`/api/facts/${of(before, PLAIN).id}/reject`);
    await client.post(`/api/facts/${of(before, NUMBERED).id}/accept`);
    await client.patch(`/api/facts/${of(before, CLIENT).id}`, { claim: "Rewrote the team handover notes" });
    releaseGrade();

    expect(await sorting.then((response) => response.json())).toEqual({ sorted: 1, flagged: 1, remaining: 1 });
    const after = await factsOf(importId);
    expect(of(after, PLAIN).flags).toEqual([]);
    expect(of(after, NUMBERED).flags).toEqual([]);
    expect(after.find((fact) => fact.id === of(before, CLIENT).id)!.flags).toEqual([]);
    expect(of(after, DOUBTED)).toMatchObject({ status: "accepted", disclosure: "private" });
    expect(kindsOf(of(after, DOUBTED))).toEqual(["confidential"]);
    await client.post(`/api/facts/${of(before, PLAIN).id}/undo`);
    expect(of(await factsOf(importId), PLAIN).flags).toEqual([]);
  });

  it("leaves no flag of the old claim open when the fact is edited as its sort lands", async () => {
    const importId = await waiting([NUMBERED]);
    const [fact] = await factsOf(importId);
    model.gradings = [graded({ [NUMBERED.claim]: { provenance: "measured" } })];
    const revised = "Shortened the nightly settlement run";

    // The edit arrives the moment the database has answered the write that sorts the fact.
    const send = globalThis.fetch;
    let edited = false;
    const fetching = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const response = await send(input, init);
      const body = typeof init?.body === "string" ? init.body : "";
      if (edited || !body.includes('update \\"facts\\"') || !body.includes("auto_accepted_at")) return response;
      edited = true;
      expect((await client.patch(`/api/facts/${fact!.id}`, { claim: revised })).status).toBe(200);
      return response;
    });
    try {
      expect(await (await client.post("/api/facts/sort", { importId })).json()).toMatchObject({ sorted: 1, remaining: 0 });
    } finally {
      fetching.mockRestore();
    }

    expect(edited).toBe(true);
    const [after] = await factsOf(importId);
    expect(after).toMatchObject({ claim: revised, status: "accepted" });
    expect(after!.flags.filter((flag) => !flag.checked).map((flag) => flag.kind)).toEqual([]);
  });
});
