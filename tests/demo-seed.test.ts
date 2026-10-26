/**
 * `npm run db:seed:demo` (issue #103, `docs/12` §5a).
 *
 * What is pinned here: the refusals fire before anything is written; the reset
 * order covers every table a user owns, so a table added later cannot be
 * forgotten; a second run prints what the first did; nothing is left waiting
 * on the owner, every document has an accepted version that downloads, and
 * each application holds the documents it sent; the user, their sign-in and
 * every other user's rows survive; uploaded recordings stop the reset; and the
 * fixture is invented. The seeding itself runs here against the suite's
 * database, because the command's own guard refuses that database.
 */
import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { eq, getTableName, sql } from "drizzle-orm";
import { createDb } from "~/server/db/client";
import * as s from "~/server/db/schema";
import type { Bindings } from "~/server/env";
import { newId } from "~/server/http/ids";
import {
  RENDER_DOWNLOAD_ALTERNATIVE,
  RENDER_DOWNLOAD_FORMAT,
  RENDER_KINDS,
  type RenderKind,
} from "~/shared/render-content";
import { RESET_ORDER, seedDemo } from "../scripts/demo-seed/demo";
import { DOCUMENTS } from "../scripts/demo-seed/documents";
import * as fixture from "../scripts/demo-seed/fixture";
import {
  RECORDINGS_FLAG,
  REMOTE_FLAG,
  assertRecordingsGone,
  assertSeedTarget,
} from "../scripts/demo-seed/guard";
import { harness, type Client } from "./helpers/harness";
import { seedAllowedUser, seedUser } from "./helpers/seed";

const bindings = env as unknown as Bindings;
const db = createDb(bindings.DATABASE_URL);

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
  it("prints the same counts twice, leaves nothing waiting, keeps the user, leaves another user alone, and stops at an upload", async () => {
    const user = await seedAllowedUser();
    const other = await seedUser();
    await db.insert(s.profiles).values({
      id: newId("profile"),
      userId: other.id,
      ...fixture.PROFILE,
      dateOfBirth: `${fixture.PROFILE.dateOfBirth}-01`,
    });

    const first = await seedDemo(bindings.DATABASE_URL, user.id);
    const second = await seedDemo(bindings.DATABASE_URL, user.id);

    expect(second).toEqual(first);
    // The counts the production runbook checks a reset against (`docs/12` §5a step 5).
    expect(first).toEqual(COUNTS(user.id));

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
    expect(await seedDemo(bindings.DATABASE_URL, user.id).then(() => null, (error: Error) => error.message)).toMatch(/uploaded recording/);
    const [still] = await db.select({ n: sql<number>`count(*)::int` }).from(s.facts).where(eq(s.facts.userId, user.id));
    expect(still?.n).toBe(first.facts);
    await expect(seedDemo(bindings.DATABASE_URL, user.id, [RECORDINGS_FLAG])).resolves.toEqual(first);

    await expectNothingWaiting(harness().as(user), user.id);
  }, 900_000);
});

const COUNTS = (user: string) => ({
  user,
  employers: 4,
  projects: 5,
  documents: 7,
  facts: 59,
  flags: 16,
  skills: 21,
  renderVersions: 6,
  applications: 4,
  sentCopies: 6,
  interviews: 2,
});

/** What the owner sees after a reset: every screen filled in, and nothing asking them to act. */
async function expectNothingWaiting(as: Client, userId: string): Promise<void> {
  const overview = await as.json<{
    flagged: number;
    review: unknown;
    unconfirmed: unknown;
    activeImport: unknown;
    canGenerate: boolean;
    documents: { kind: RenderKind; status: string; currentVersionNo: number | null; pendingProposalId: string | null }[];
  }>("/api/overview");
  expect(overview).toMatchObject({ flagged: 0, review: null, unconfirmed: null, activeImport: null, canGenerate: true });
  // Every document has a first version and is up to date with the record.
  expect(overview.documents.map((d) => [d.kind, d.status, d.currentVersionNo, d.pendingProposalId])).toEqual(
    RENDER_KINDS.map((kind) => [kind, "up_to_date", 1, null]),
  );

  // The two figures no passage states are ruled out; every other flag was looked at.
  const flags = await as.json<{ counts: { open: number; checked: number } }>("/api/flags");
  expect(flags.counts).toEqual({ open: 0, checked: 12 });
  const facts = await db.select({ status: s.facts.status, provenance: s.facts.provenance }).from(s.facts).where(eq(s.facts.userId, userId));
  expect(facts.filter((f) => f.status === "rejected")).toEqual([
    { status: "rejected", provenance: "generated" },
    { status: "rejected", provenance: "generated" },
  ]);
  expect(facts.every((f) => f.status !== "candidate")).toBe(true);

  // The 履歴書 photo is there, and its one gap is explained.
  expect((await as.get("/api/profile/photo")).status).toBe(200);
  const timeline = await as.json<{ gaps: unknown[]; explained: unknown[]; staleNotes: unknown[] }>("/api/career-timeline");
  expect([timeline.gaps.length, timeline.explained.length, timeline.staleNotes.length]).toEqual([0, 1, 0]);

  // Each document downloads in every format its card offers.
  for (const kind of RENDER_KINDS) {
    for (const format of [RENDER_DOWNLOAD_FORMAT[kind], RENDER_DOWNLOAD_ALTERNATIVE[kind]].filter((f) => f !== undefined)) {
      const file = await as.get(`/api/renders/${kind}/download?format=${format}`);
      expect([kind, format, file.status]).toEqual([kind, format, 200]);
      expect((await file.arrayBuffer()).byteLength).toBeGreaterThan(0);
    }
  }

  // Applications stand where their steps say, each with the documents it sent.
  const list = await as.json<{ items: { id: string; company: string; step: string; closedAs: string | null; quietDays: number | null }[] }>("/api/applications");
  const byCompany = new Map(list.items.map((a) => [a.company, a]));
  expect(list.items.filter((a) => a.quietDays !== null).map((a) => a.company)).toEqual(["Harbor Ledger"]);
  for (const application of fixture.APPLICATIONS) {
    const row = byCompany.get(application.company)!;
    const detail = await as.json<{
      documents: { ref: string; kind: RenderKind; tailored: boolean; currentVersionNo: number | null }[];
      sentCopies: { id: string; kind: RenderKind }[];
    }>(`/api/applications/${row.id}`);
    const chosen = [...(application.tailoredResume ? ["english_resume"] : []), ...application.documents];
    expect(detail.documents.map((d) => d.kind).sort()).toEqual([...chosen].sort());
    expect(detail.documents.every((d) => d.currentVersionNo === 1)).toBe(true);
    expect(detail.sentCopies.length).toBe(application.steps.length > 0 ? chosen.length : 0);
    for (const copy of detail.sentCopies) {
      expect((await as.get(`/api/applications/${row.id}/sent-copies/${copy.id}/download`)).status).toBe(200);
    }
    const tailored = detail.documents.find((d) => d.tailored);
    if (tailored) {
      for (const format of ["pdf", "docx"]) {
        expect((await as.get(`/api/renders/${tailored.ref}/download?format=${format}`)).status).toBe(200);
      }
    }
  }
}

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
