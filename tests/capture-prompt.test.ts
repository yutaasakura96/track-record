/**
 * The monthly capture prompt, through the API (issue #116).
 *
 * Home decides whether to ask, in the author's own month, from three things the
 * overview says: when the record last gained a fact, the employer the author
 * works for now, and the month the prompt was put away for. What is pinned
 * here is that each is the author's own and true; that the employer is the one
 * not left, the one joined last of two, and none when every job has ended; and
 * that putting the prompt away is kept for the member, so it holds on every
 * device, and only for a month that is this one. Every text is INVENTED.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { harness, stubModel, type Client, type SeededUser } from "./helpers/harness";
import { EMPLOYER_FIXTURE, PROFILE_FIXTURE, SECOND_EMAIL, seedAllowedUser } from "./helpers/seed";
import { createDb } from "~/server/db/client";
import { facts } from "~/server/db/schema";
import type { Overview } from "~/client/api";
import type { Bindings } from "~/server/env";

const db = createDb((env as unknown as Bindings).DATABASE_URL);

let client: Client;
let user: SeededUser;
let userId: string;

beforeEach(async () => {
  user = await seedAllowedUser();
  userId = user.id;
  client = harness(stubModel()).as(user);
  await client.put("/api/profile", PROFILE_FIXTURE);
});

const prompt = async (as: Client = client) => (await as.json<Overview>("/api/overview")).capturePrompt!;

const addEmployer = async (over: Record<string, unknown>) =>
  ((await (await client.post("/api/employers", { ...EMPLOYER_FIXTURE, ...over })).json()) as { id: string }).id;

/** A UTC month, `YYYY-MM-01`, `shift` months from the server's. */
const month = (shift = 0) => {
  const at = new Date();
  at.setUTCDate(1);
  at.setUTCMonth(at.getUTCMonth() + shift);
  return `${at.toISOString().slice(0, 7)}-01`;
};

const dismiss = (body: unknown, as: Client = client) => as.post("/api/capture/prompt/dismiss", body);

describe("what the overview says the prompt is decided from", () => {
  it("says no fact has arrived, no employer is current, and nothing was put away, on a new record", async () => {
    expect(await prompt()).toEqual({ lastFactAt: null, employer: null, dismissedOn: null });
  });

  it("says when the newest fact arrived, by any road and in any state", async () => {
    await client.post("/api/capture", { claims: [{ claim: "Moved the Lumora export onto a queue.", month: "2026-09" }] });
    const [older] = await db.select({ id: facts.id }).from(facts).where(eq(facts.userId, userId));
    const longAgo = new Date("2026-01-15T00:00:00.000Z");
    await db.update(facts).set({ createdAt: longAgo, status: "rejected" }).where(eq(facts.id, older!.id));
    expect((await prompt()).lastFactAt).toBe(longAgo.toISOString());

    await client.post("/api/capture", { claims: [{ claim: "Cut the Lumora report to one page.", month: "2026-10" }] });
    const lastFactAt = Date.parse((await prompt()).lastFactAt!);
    expect(Date.now() - lastFactAt).toBeLessThan(60_000);
  });

  it("names the employer the author has not left, by its English name", async () => {
    await addEmployer({ nameLatin: "Vandrel Systems", startedOn: "2018-04-01", endedOn: "2022-03-01" });
    const current = await addEmployer({ nameLatin: "Corvel Freight", startedOn: "2022-04-01", endedOn: null });
    expect((await prompt()).employer).toEqual({ id: current, name: "Corvel Freight" });
  });

  it("names the one joined last when two are held at once, by its Japanese name when it has no other", async () => {
    await addEmployer({ nameJa: "株式会社テスラン", nameLatin: "Teslan K.K.", startedOn: "2019-04-01", endedOn: null });
    const later = await addEmployer({ nameJa: "株式会社ミナモ工房", nameLatin: null, startedOn: "2023-10-01", endedOn: null });
    expect((await prompt()).employer).toEqual({ id: later, name: "株式会社ミナモ工房" });
  });

  it("names no employer when every job has ended", async () => {
    await addEmployer({ endedOn: "2024-09-01" });
    expect((await prompt()).employer).toBeNull();
  });
});

describe("putting the prompt away", () => {
  it("keeps the month on the member, so every device reads it", async () => {
    const response = await dismiss({ month: month() });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ dismissedOn: month() });

    // Another device is another session of the same member.
    const elsewhere = harness(stubModel()).as(user);
    expect((await prompt(elsewhere)).dismissedOn).toBe(month());
  });

  it("takes the month on either side of the server's, since the author's month may differ from it", async () => {
    expect((await dismiss({ month: month(-1) })).status).toBe(200);
    expect((await dismiss({ month: month(1) })).status).toBe(200);
    expect((await prompt()).dismissedOn).toBe(month(1));
  });

  it("refuses a month further off, so no dismissal outlasts the month it was for", async () => {
    for (const far of [month(2), month(-2), "2099-12-01"]) {
      const response = await dismiss({ month: far });
      expect(response.status).toBe(422);
    }
    expect((await prompt()).dismissedOn).toBeNull();
  });

  it("refuses what is not a month", async () => {
    for (const body of [{ month: "2026-10" }, { month: "2026-10-15" }, {}]) {
      expect((await dismiss(body)).status).toBe(422);
    }
  });

  it("is the member's own: another member's prompt still asks", async () => {
    await dismiss({ month: month() });
    const other = harness(stubModel()).as(await seedAllowedUser(SECOND_EMAIL));
    await other.put("/api/profile", PROFILE_FIXTURE);
    expect((await prompt(other)).dismissedOn).toBeNull();
  });

  it("answers 404 before a profile exists", async () => {
    const fresh = harness(stubModel()).as(await seedAllowedUser());
    expect((await dismiss({ month: month() }, fresh)).status).toBe(404);
  });

  it("leaves the month alone when the profile is saved again", async () => {
    await dismiss({ month: month() });
    await client.put("/api/profile", PROFILE_FIXTURE);
    expect((await prompt()).dismissedOn).toBe(month());
  });
});
