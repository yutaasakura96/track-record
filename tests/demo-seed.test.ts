/**
 * `npm run db:seed:demo` (issue #103, `docs/12` §5a).
 *
 * What is pinned here: the refusals fire before anything is written; the reset
 * order covers every table a user owns, so a table added later cannot be
 * forgotten; a second run prints what the first did; the user, their sign-in
 * and every other user's rows survive; uploaded recordings stop the reset; and
 * the fixture is invented. The seeding itself runs here against the suite's
 * database, because the command's own guard refuses that database.
 */
import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { eq, getTableName, sql } from "drizzle-orm";
import { createDb } from "~/server/db/client";
import * as s from "~/server/db/schema";
import type { Bindings } from "~/server/env";
import { newId } from "~/server/http/ids";
import { RESET_ORDER, seedDemo } from "../scripts/demo-seed/demo";
import { DOCUMENTS } from "../scripts/demo-seed/documents";
import * as fixture from "../scripts/demo-seed/fixture";
import {
  RECORDINGS_FLAG,
  REMOTE_FLAG,
  assertRecordingsGone,
  assertSeedTarget,
} from "../scripts/demo-seed/guard";
import { seedUser } from "./helpers/seed";

const db = createDb((env as unknown as Bindings).DATABASE_URL);

const LOCAL = "postgresql://postgres:postgres@localhost:5432/track_record_dev?sslmode=disable";
const NEON = "postgresql://owner:secret@ep-example-123456.us-east-2.aws.neon.tech/neondb?sslmode=require";

const refusal = (run: () => void) => {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return null;
};

describe("the seed's refusals", () => {
  it("accepts the local development database", () => {
    expect(refusal(() => assertSeedTarget(LOCAL, []))).toBeNull();
  });

  it("refuses the suite's database, with or without the remote flag", () => {
    const url = LOCAL.replace("track_record_dev", "track_record_test");
    expect(refusal(() => assertSeedTarget(url, []))).toMatch(/track_record_test/);
    expect(refusal(() => assertSeedTarget(url, [REMOTE_FLAG]))).toMatch(/track_record_test/);
  });

  it("refuses a remote database until the backup flag is passed", () => {
    expect(refusal(() => assertSeedTarget(NEON, []))).toMatch(/ep-example-123456\.us-east-2\.aws\.neon\.tech.*backup/);
    expect(refusal(() => assertSeedTarget(NEON, [REMOTE_FLAG]))).toBeNull();
  });

  it("refuses a URL it cannot read", () => {
    expect(refusal(() => assertSeedTarget("not a url", [REMOTE_FLAG]))).toMatch(/connection string/);
  });

  it("refuses while uploaded recordings exist, unless they are confirmed deleted", () => {
    expect(refusal(() => assertRecordingsGone(0, "usr_1", []))).toBeNull();
    expect(refusal(() => assertRecordingsGone(2, "usr_1", []))).toMatch(/2 uploaded.*"usr_1\/"/);
    expect(refusal(() => assertRecordingsGone(2, "usr_1", [RECORDINGS_FLAG]))).toBeNull();
  });
});

describe("the reset order", () => {
  it("names every table that holds a user's rows, except the sign-in ones", async () => {
    const rows = await db.execute(sql`
      select table_name from information_schema.columns
      where table_schema = 'public' and column_name = 'user_id'`);
    const owned = (rows.rows as { table_name: string }[]).map((row) => row.table_name);
    const reset = RESET_ORDER.map((table) => getTableName(table));
    expect([...reset].sort()).toEqual(owned.filter((name) => name !== "accounts" && name !== "sessions").sort());
  });
});

describe("seeding a user", () => {
  it("prints the same counts twice, keeps the user, leaves another user alone, and stops at an upload", async () => {
    const user = await seedUser();
    const other = await seedUser();
    await db.insert(s.profiles).values({
      id: newId("profile"),
      userId: other.id,
      ...fixture.PROFILE,
      dateOfBirth: `${fixture.PROFILE.dateOfBirth}-01`,
    });

    const first = await seedDemo(db, user.id);
    const second = await seedDemo(db, user.id);

    expect(second).toEqual(first);
    // The counts the production runbook checks a reset against (`docs/12` §5a step 5).
    expect(first).toEqual({
      user: user.id,
      employers: 4,
      projects: 5,
      documents: 7,
      facts: 59,
      flags: 14,
      skills: 21,
      applications: 4,
      interviews: 2,
    });

    const [kept] = await db.select({ id: s.users.id }).from(s.users).where(eq(s.users.id, user.id));
    expect(kept?.id).toBe(user.id);
    const [theirs] = await db.select({ n: sql<number>`count(*)::int` }).from(s.profiles).where(eq(s.profiles.userId, other.id));
    expect(theirs?.n).toBe(1);
    const [foreign] = await db.select({ n: sql<number>`count(*)::int` }).from(s.facts).where(eq(s.facts.userId, other.id));
    expect(foreign?.n).toBe(0);

    // An uploaded recording stops the reset before it deletes anything.
    const [interview] = await db.select({ id: s.interviews.id }).from(s.interviews).where(eq(s.interviews.userId, user.id));
    await db.insert(s.interviewRecordings).values({
      id: newId("interviewRecording"),
      userId: user.id,
      interviewId: interview!.id,
      kind: "upload",
      fileName: "round1.m4a",
      byteSize: 1024,
      contentType: "audio/mp4",
    });
    expect(await seedDemo(db, user.id).then(() => null, (error: Error) => error.message)).toMatch(/uploaded recording/);
    const [still] = await db.select({ n: sql<number>`count(*)::int` }).from(s.facts).where(eq(s.facts.userId, user.id));
    expect(still?.n).toBe(first.facts);
    await expect(seedDemo(db, user.id, [RECORDINGS_FLAG])).resolves.toEqual(first);
  }, 240_000);
})

describe("the fixture", () => {
  const everything = JSON.stringify([fixture, DOCUMENTS.map((doc) => [doc.filename, doc.text])]);

  it("uses example.com for every address and link", () => {
    for (const email of everything.match(/[A-Za-z0-9._-]+@[A-Za-z0-9.-]+/g) ?? []) {
      expect(email).toMatch(/@example\.com$/);
    }
    for (const link of everything.match(/https?:\/\/[^"\\\s)]+/g) ?? []) {
      expect(new URL(link).hostname).toMatch(/(^|\.)example\.com$/);
    }
  });
});
