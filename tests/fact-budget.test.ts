/**
 * How many facts a document is sent, and which (`docs/06`, 2026-11-02).
 *
 * What is pinned here: nothing is left out of a record under budget; a large
 * employer cannot crowd out a small one; repeats leave first, and the rest of a
 * tier thins evenly through the source and not from its end; a tailored
 * document keeps what its posting names; and what is left out of the request is
 * left out of nothing else, because staleness and the skills list read every
 * usable fact.
 *
 * Every value here is INVENTED.
 */
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { createDb } from "~/server/db/client";
import { factFlags, facts, skillCurations } from "~/server/db/schema";
import type { Bindings } from "~/server/env";
import { newId } from "~/server/http/ids";
import { collectRenderInputs } from "~/server/services/render";
import { FACTS_PER_EMPLOYER, chooseFacts, type BudgetedFact } from "~/server/services/fact-budget";
import { harness, settle, stubModel, type Client, type SeededUser, type StubModel } from "./helpers/harness";
import { PROFILE_FIXTURE, postJob, seedAllowedUser } from "./helpers/seed";

const bindings = env as unknown as Bindings;
const db = createDb(bindings.DATABASE_URL);

const fact = (n: number, over: Partial<BudgetedFact> = {}): BudgetedFact => ({
  id: `fct_${String(n).padStart(5, "0")}`,
  employerId: "emp_1",
  sourceDocumentVersionId: "sdv_1",
  quoteStart: n * 100,
  ...over,
});

const NONE = new Map<string, Set<string>>();

describe("choosing an employer's facts", () => {
  it("keeps everything at or under the budget, in the order given", () => {
    const held = [fact(3), fact(1), fact(2)];
    expect(chooseFacts(held, NONE, 3)).toEqual(held);
  });

  it("leaves repeats out first, then facts with another open flag", () => {
    const repeats = [1, 2].map((n) => fact(n));
    const flagged = [3, 4].map((n) => fact(n));
    const clean = [5, 6].map((n) => fact(n));
    const open = new Map([
      ...repeats.map((f) => [f.id, new Set(["repeat"])] as const),
      ...flagged.map((f) => [f.id, new Set(["number"])] as const),
    ]);
    const all = [...repeats, ...flagged, ...clean];

    expect(chooseFacts(all, open, 2)).toEqual(clean);
    expect(chooseFacts(all, open, 4).map((f) => f.id).sort()).toEqual([...flagged, ...clean].map((f) => f.id).sort());
    expect(chooseFacts(all, open, 5).filter((f) => repeats.includes(f))).toHaveLength(1);
  });

  it("thins a tier evenly through its source, not from the end", () => {
    const held = Array.from({ length: 1000 }, (_, n) => fact(n));
    const kept = chooseFacts(held, NONE, 100);

    expect(kept).toHaveLength(100);
    expect(new Set(kept.map((f) => f.id)).size).toBe(100);
    // Each tenth of the document keeps its tenth of the budget.
    for (let part = 0; part < 10; part++) {
      expect(kept.filter((f) => Math.floor(f.quoteStart! / 10_000) === part)).toHaveLength(10);
    }
  });

  it("chooses the same facts whatever order they arrive in", () => {
    const held = Array.from({ length: 300 }, (_, n) => fact(n));
    const ids = (facts: BudgetedFact[]) => facts.map((f) => f.id).sort();
    expect(ids(chooseFacts([...held].reverse(), NONE, 50))).toEqual(ids(chooseFacts(held, NONE, 50)));
  });

  it("does not let a repeat pass a clean fact", () => {
    const repeat = fact(1);
    const clean = fact(2);
    expect(chooseFacts([repeat, clean], new Map([[repeat.id, new Set(["repeat"])]]), 1)).toEqual([clean]);
  });
});

describe("a document over budget", () => {
  let model: StubModel;
  let client: Client;
  let user: SeededUser;
  let large: string;
  let small: string;

  /** Rows, not imports: the budget reads facts, and this is thousands of them. */
  const seedFacts = async (count: number, employerId: string | null, over: Partial<typeof facts.$inferInsert> = {}) => {
    const rows = Array.from({ length: count }, (_, n) => ({
      id: newId("fact"), userId: user.id, employerId, claim: `Delivered invented outcome ${n} for the batch platform.`,
      provenance: "attested" as const, disclosure: "public" as const, status: "accepted" as const, ...over,
    }));
    for (let at = 0; at < rows.length; at += 500) await db.insert(facts).values(rows.slice(at, at + 500));
    return rows.map((row) => row.id);
  };

  const sent = () => model.generationInputs[0]!.facts;

  beforeEach(async () => {
    model = stubModel();
    user = await seedAllowedUser();
    client = harness(model).as(user);
    await client.put("/api/profile", PROFILE_FIXTURE);
    large = await postJob(client);
    small = await postJob(client, { nameJa: "株式会社ミドリ運輸", nameLatin: "Midori Transport K.K." });
  });

  it("sends each employer its budget, the thin one all it has, and the unfiled theirs", async () => {
    await seedFacts(1000, large);
    const thin = await seedFacts(7, small);
    await seedFacts(200, null);

    expect((await client.post("/api/renders/english_resume/generate")).status).toBe(202);
    await settle();

    const held = (id: string | undefined) => sent().filter((f) => f.employer?.id === id).length;
    expect(held(large)).toBe(FACTS_PER_EMPLOYER);
    expect(held(undefined)).toBe(FACTS_PER_EMPLOYER);
    expect(sent().filter((f) => thin.includes(f.id))).toHaveLength(7);
  });

  it("never gives a place to a fact that may not be rendered", async () => {
    await seedFacts(FACTS_PER_EMPLOYER, large, { disclosure: "private" });
    await seedFacts(FACTS_PER_EMPLOYER, large, { provenance: "generated" });
    const usable = await seedFacts(FACTS_PER_EMPLOYER, large);

    const inputs = await collectRenderInputs(db, user.id, "english_resume", "", null, { forModel: true });
    expect(inputs.facts.map((f) => f.id).sort()).toEqual([...usable].sort());
    expect(inputs.omittedFactCount).toBe(0);
  });

  it("counts a flag the author checked as settled", async () => {
    const [flaggedOpen, flaggedChecked] = await Promise.all([seedFacts(100, large), seedFacts(100, large)]);
    const clean = await seedFacts(100, large);
    const flagged = (ids: string[], checkedAt: Date | null) =>
      ids.map((factId) => ({ id: newId("factFlag"), userId: user.id, factId, kind: "repeat" as const, reason: "Likely repeats another fact.", checkedAt }));
    await db.insert(factFlags).values([...flagged(flaggedOpen!, null), ...flagged(flaggedChecked!, new Date())]);

    const { facts: chosen, omittedFactCount } = await collectRenderInputs(db, user.id, "english_resume", "", null, { forModel: true });
    expect(chosen).toHaveLength(FACTS_PER_EMPLOYER);
    expect(omittedFactCount).toBe(150);
    expect(chosen.filter((f) => flaggedOpen!.includes(f.id))).toHaveLength(0);
    expect(chosen.filter((f) => clean.includes(f.id)).length).toBeGreaterThan(50);
  });

  it("leaves staleness and the skills reading the whole record", async () => {
    await seedFacts(FACTS_PER_EMPLOYER + 50, large);
    await seedFacts(1, large, { technologies: ["ZigBeeOnly"], claim: "Shipped the sensor gateway." });
    await db.insert(skillCurations).values({
      id: newId("skillCuration"), userId: user.id, skillName: "ZigBeeOnly", groupName: "Protocols", sortOrder: 0,
    });

    const every = await collectRenderInputs(db, user.id, "shokumu_keirekisho", "");
    const budgeted = await collectRenderInputs(db, user.id, "shokumu_keirekisho", "", null, { forModel: true });

    expect(every.facts).toHaveLength(FACTS_PER_EMPLOYER + 51);
    expect(every.omittedFactCount).toBe(0);
    expect(budgeted.facts).toHaveLength(FACTS_PER_EMPLOYER);
    expect(budgeted.usableFactIds).toEqual(every.usableFactIds);
    expect(budgeted.spec.curatedSkills).toEqual(every.spec.curatedSkills);
    expect(budgeted.spec.curatedSkills?.flatMap((group) => group.skills)).toContain("ZigBeeOnly");
  });
});
