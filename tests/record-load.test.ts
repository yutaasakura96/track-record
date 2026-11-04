/**
 * `npm run db:load:record` (`docs/12` §5b).
 *
 * What is pinned here: the example in the runbook loads, so it cannot go stale;
 * a file is refused by place and rule and never by repeating what it holds; the
 * load empties one user's record and keeps their sign-in and everyone else's
 * rows; a load that fails leaves the record it found; recordings stop it unless
 * dealt with, and clearing them removes objects under that user alone; and it
 * will not run under a Workflow still writing. The command's own guard refuses
 * this database, so the load runs here beneath it.
 *
 * Every value here is INVENTED.
 */
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createDb } from "~/server/db/client";
import * as s from "~/server/db/schema";
import type { Bindings } from "~/server/env";
import { newId } from "~/server/http/ids";
import runbook from "../docs/12-deployment-devops.md?raw";
import { RESET_ORDER } from "../scripts/demo-seed/reset";
import {
  RecordFileError,
  assertOutsideRepository,
  parseRecordFile,
  type RecordFile,
} from "../scripts/record-load/format";
import { clearAndLoad } from "../scripts/record-load/load";
import { boundObjects, clearRecordingObjects, cloudflareObjects } from "../scripts/record-load/recordings";
import type { SeededUser } from "./helpers/harness";
import { SECOND_EMAIL, seedAllowedUser, seedUser } from "./helpers/seed";

const bindings = env as unknown as Bindings;
const db = createDb(bindings.DATABASE_URL);

/** The one JSON block in §5b. */
const EXAMPLE = /## 5b\.[\s\S]*?```json\n([\s\S]*?)\n```/.exec(runbook)![1]!;
const example = () => JSON.parse(EXAMPLE) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const record = (change: (file: ReturnType<typeof example>) => void = () => {}): RecordFile => {
  const file = example();
  change(file);
  return parseRecordFile(JSON.stringify(file));
};

const problems = (text: string): string[] => {
  try {
    parseRecordFile(text);
  } catch (error) {
    if (error instanceof RecordFileError) return error.problems;
    throw error;
  }
  return [];
};
const problemsWith = (change: (file: ReturnType<typeof example>) => void) => {
  const file = example();
  change(file);
  return problems(JSON.stringify(file));
};

describe("the record file", () => {
  it("accepts the runbook's example", () => {
    expect(problems(EXAMPLE)).toEqual([]);
  });

  it("refuses a misspelt key rather than dropping it", () => {
    expect(problemsWith((f) => (f.employers[0].leavingReason = "一身上の都合により"))[0]).toMatch(/^employers\.0: .*leavingReason/);
    expect(problemsWith((f) => (f.profile.nickname = "x"))).toHaveLength(1);
    expect(problemsWith((f) => (f.employers[0].roles[0].employerId = "emp_1"))).toHaveLength(1);
    expect(problemsWith((f) => (f.extra = []))).toHaveLength(1);
  });

  it("holds each row to its route's rules", () => {
    expect(problemsWith((f) => (f.employers[0].startedOn = "2021-04-15"))[0]).toContain("employers.0.startedOn");
    expect(problemsWith((f) => (f.profile.familyNameKana = "カクウ"))[0]).toMatch(/hiragana/);
    expect(problemsWith((f) => delete f.educations[0].endedOn)[0]).toContain("educations.0.endedOn");
    expect(problemsWith((f) => delete f.educations[0].level)).toHaveLength(1);
    expect(problemsWith((f) => (f.certifications[0].kind = "licence"))).toHaveLength(1);
    expect(problemsWith((f) => (f.employers = []))).toHaveLength(1);
    expect(problemsWith((f) => (f.formatVersion = 2))).toHaveLength(1);
  });

  it("never repeats what the file holds", () => {
    const secret = "東京都秘密区 0-0-0 secret-value";
    const refused = [
      ...problems(`{ "profile": { "address": "${secret}" `),
      ...problemsWith((f) => {
        f.profile.familyNameKana = `カクウ ${secret}`;
        f.profile.email = secret;
        f.profile.resumeGithubUrl = secret;
        f.employers[0].startedOn = secret;
        f.employers[0].employmentType = secret;
        f.certifications[0].credentialUrl = secret;
        f.certifications[0].kind = secret;
        f.formatVersion = secret;
      }),
    ];
    expect(refused.length).toBeGreaterThan(5);
    expect(refused.join("\n")).not.toMatch(/secret|秘密/);
  });

  it("is refused anywhere inside the repository", () => {
    const root = "/work/track-record";
    expect(() => assertOutsideRepository("/work/track-record/docs/record.json", root)).toThrow(/public/);
    expect(() => assertOutsideRepository("/work/track-record/record.json", root)).toThrow(/public/);
    expect(() => assertOutsideRepository("/work/track-record/local/../record.json", root)).toThrow(/public/);
    expect(() => assertOutsideRepository("/work/track-record/local/record.json", root)).toThrow(/public/);
    expect(() => assertOutsideRepository(root, root)).toThrow(/public/);
    expect(() => assertOutsideRepository("/home/author/record.json", root)).not.toThrow();
    expect(() => assertOutsideRepository("/work/track-record-other/record.json", root)).not.toThrow();
  });
});

describe("loading a record", () => {
  let user: SeededUser;
  let other: SeededUser;
  const objects = boundObjects(bindings.RECORDINGS);

  const count = async (table: (typeof RESET_ORDER)[number], userId: string) =>
    (await db.select({ n: sql<number>`count(*)::int` }).from(table).where(eq(table.userId, userId)))[0]?.n ?? 0;

  /** Some of everything a reset removes, and the row each child hangs from. */
  const seedOldRecord = async (userId: string) => {
    await clearAndLoad(db, userId, record((f) => (f.profile.nameLatin = "Old Record")), objects);
    const applicationId = newId("application");
    await db.insert(s.applications).values({ id: applicationId, userId, company: "Invented K.K.", position: "Engineer", jobDescription: "An invented posting." });
    const interviewId = newId("interview");
    await db.insert(s.interviews).values({ id: interviewId, userId, applicationId, happenedOn: "2026-10-01", round: "interview_1", howItWent: "Invented." });
    await db.insert(s.facts).values({ id: newId("fact"), userId, claim: "An invented claim.", provenance: "attested", disclosure: "public", status: "accepted" });
    return { interviewId };
  };

  const addUpload = async (userId: string, interviewId: string) => {
    const id = newId("interviewRecording");
    await db.insert(s.interviewRecordings).values({
      id, userId, interviewId, kind: "upload", fileName: "invented.m4a", byteSize: 4, contentType: "audio/mp4",
    });
    return id;
  };

  const seedRunningImport = async (userId: string, importStatus: "extracting" | "queued" | "ready") => {
    const documentId = newId("sourceDocument");
    await db.insert(s.sourceDocuments).values({ id: documentId, userId, filename: "invented.md", mimeType: "text/markdown" });
    await db.insert(s.sourceDocumentVersions).values({
      id: newId("sourceDocumentVersion"), userId, sourceDocumentId: documentId, versionNo: 1, originalBytes: Buffer.from("x"),
      extractedText: "x", extractorVersion: "invented", byteSize: 1, wordCount: 1, importStatus,
    });
  };

  beforeEach(async () => {
    user = await seedAllowedUser();
    other = await seedUser(SECOND_EMAIL);
  });

  it("replaces the record, and keeps the sign-in and every other user's rows", async () => {
    await seedOldRecord(user.id);
    await seedOldRecord(other.id);
    const sessionId = `ses_${crypto.randomUUID()}`;
    await db.insert(s.sessions).values({ id: sessionId, userId: user.id, token: sessionId, expiresAt: new Date(Date.now() + 60_000) });

    const counts = await clearAndLoad(db, user.id, record(), objects);

    expect(counts).toEqual({
      user: user.id, recordingObjectsDeleted: 0, employers: 1, roles: 1, educations: 1, certifications: 1, facts: 0, documents: 0, renders: 0,
    });
    const [profile] = await db.select().from(s.profiles).where(eq(s.profiles.userId, user.id));
    expect(profile).toMatchObject({ nameLatin: "Taro Kakuu", dateOfBirth: "1991-04-17", paperSize: "a4", contactSameAsAddress: true });
    expect(await count(s.applications, user.id)).toBe(0);
    expect(await count(s.interviews, user.id)).toBe(0);

    expect(await db.select({ id: s.sessions.id }).from(s.sessions).where(eq(s.sessions.id, sessionId))).toHaveLength(1);
    expect(await db.select({ id: s.users.id }).from(s.users).where(eq(s.users.id, user.id))).toHaveLength(1);
    expect(await count(s.facts, other.id)).toBe(1);
    expect(await count(s.applications, other.id)).toBe(1);
    const [theirs] = await db.select().from(s.profiles).where(eq(s.profiles.userId, other.id));
    expect(theirs?.nameLatin).toBe("Old Record");
  });

  it("gives the same counts run twice, and keeps the employers in the file's order", async () => {
    const twice = record((f) => {
      f.employers = [f.employers[0], { ...f.employers[0], nameJa: "株式会社二社目", startedOn: "2024-04-01", endedOn: null, leavingReasonJa: null }];
    });
    const first = await clearAndLoad(db, user.id, twice, objects);
    expect(await clearAndLoad(db, user.id, twice, objects)).toEqual(first);

    const rows = await db.select().from(s.employers).where(eq(s.employers.userId, user.id));
    const roles = await db.select().from(s.roles).where(eq(s.roles.userId, user.id));
    expect(rows.sort((a, b) => a.sortOrder - b.sortOrder).map((row) => row.nameJa)).toEqual(["株式会社例示システム", "株式会社二社目"]);
    expect(new Set(roles.map((role) => role.employerId))).toEqual(new Set(rows.map((row) => row.id)));
  });

  it("leaves the record it found when a row cannot be written", async () => {
    await seedOldRecord(user.id);
    // Past `integer`: the route's rule allows it and the column does not.
    const unwritable = record((f) => (f.employers[0].headcount = 3_000_000_000));

    await bindings.RECORDINGS.put(`${user.id}/still-there`, "bytes");
    await expect(clearAndLoad(db, user.id, unwritable, objects)).rejects.toThrow();

    const [profile] = await db.select().from(s.profiles).where(eq(s.profiles.userId, user.id));
    expect(profile?.nameLatin).toBe("Old Record");
    expect(await count(s.facts, user.id)).toBe(1);
    expect(await count(s.applications, user.id)).toBe(1);
    expect(await bindings.RECORDINGS.get(`${user.id}/still-there`)).not.toBeNull();
  });

  it("clears that user's objects, and only theirs, on every load", async () => {
    const { interviewId } = await seedOldRecord(user.id);
    const row = await addUpload(user.id, interviewId);
    await bindings.RECORDINGS.put(`${user.id}/${row}`, "bytes");
    // An object whose row is gone: the prefix finds it and the rows would not.
    await bindings.RECORDINGS.put(`${user.id}/orphan`, "bytes");
    await bindings.RECORDINGS.put(`${other.id}/theirs`, "bytes");

    const counts = await clearAndLoad(db, user.id, record(), objects);

    expect(counts.recordingObjectsDeleted).toBe(2);
    expect((await bindings.RECORDINGS.list({ prefix: `${user.id}/` })).objects).toHaveLength(0);
    expect((await bindings.RECORDINGS.list({ prefix: `${other.id}/` })).objects).toHaveLength(1);
    expect(await count(s.interviewRecordings, user.id)).toBe(0);
  });

  it("clears orphaned objects even when there are no upload rows", async () => {
    await bindings.RECORDINGS.put(`${user.id}/orphan`, "bytes");
    expect((await clearAndLoad(db, user.id, record(), objects)).recordingObjectsDeleted).toBe(1);
    expect((await bindings.RECORDINGS.list({ prefix: `${user.id}/` })).objects).toHaveLength(0);
  });

  it("commits the new record before attempting the R2 clear", async () => {
    const { interviewId } = await seedOldRecord(user.id);
    await addUpload(user.id, interviewId);
    const stuck = { list: async () => ["key"], delete: async () => {} };

    await expect(clearAndLoad(db, user.id, record(), stuck)).rejects.toThrow(/still in R2/);
    expect(await count(s.facts, user.id)).toBe(0);
    expect((await db.select().from(s.profiles).where(eq(s.profiles.userId, user.id)))[0]?.nameLatin).toBe("Taro Kakuu");
    await bindings.RECORDINGS.put(`${user.id}/orphan`, "bytes");
    expect((await clearAndLoad(db, user.id, record(), objects)).recordingObjectsDeleted).toBe(1);
  });

  it("will not run under an import or a generation", async () => {
    await seedOldRecord(user.id);
    await seedRunningImport(user.id, "extracting");
    await expect(clearAndLoad(db, user.id, record(), objects)).rejects.toThrow(/1 import.*still running/);

    await db.update(s.sourceDocumentVersions).set({ importStatus: "ready" }).where(eq(s.sourceDocumentVersions.userId, user.id));
    const renderId = newId("render");
    await db.insert(s.renders).values({ id: renderId, userId: user.id, kind: "english_resume" });
    await db.insert(s.renderProposals).values({ id: newId("renderProposal"), userId: user.id, renderId, content: { sections: [] } });
    await expect(clearAndLoad(db, user.id, record(), objects)).rejects.toThrow(/1 generation.*still running/);
    expect(await count(s.facts, user.id)).toBe(1);

    await seedRunningImport(other.id, "extracting");
    await db.update(s.renderProposals).set({ generationStatus: "failed" }).where(eq(s.renderProposals.userId, user.id));
    await expect(clearAndLoad(db, user.id, record(), objects)).resolves.toMatchObject({ employers: 1 });
  });
});

describe("the recordings clear", () => {
  it("refuses an empty user id, which would be the whole bucket", async () => {
    await expect(clearRecordingObjects({ list: async () => [], delete: async () => {} }, "")).rejects.toThrow(/No user/);
  });

  it("pages through a large bucket", async () => {
    const keys = Array.from({ length: 1100 }, (_, n) => `usr_paged/${n}`);
    await bindings.RECORDINGS.delete((await bindings.RECORDINGS.list()).objects.map((object) => object.key));
    for (let at = 0; at < keys.length; at += 100) await Promise.all(keys.slice(at, at + 100).map((key) => bindings.RECORDINGS.put(key, "b")));

    const batchSizes: number[] = [];
    const bucket = {
      list: bindings.RECORDINGS.list.bind(bindings.RECORDINGS),
      delete: async (batch: string | string[]) => {
        const size = Array.isArray(batch) ? batch.length : 1;
        batchSizes.push(size);
        if (size > 1000) throw new Error("R2 delete limit exceeded");
        await bindings.RECORDINGS.delete(batch);
      },
    };
    expect(await clearRecordingObjects(boundObjects(bucket), "usr_paged")).toBe(1100);
    expect(batchSizes).toEqual([1000, 100]);
    expect(Math.max(...batchSizes)).toBeLessThanOrEqual(1000);
  });

  it("speaks Cloudflare's API: pages by cursor, deletes by key, and stops on a refusal", async () => {
    const calls: { url: string; method: string; auth: string | null }[] = [];
    const pages = [
      { result: [{ key: "usr_1/a" }], result_info: { is_truncated: true, cursor: "next page" } },
      { result: [{ key: "usr_1/b" }], result_info: { is_truncated: false } },
      { result: [], result_info: { is_truncated: false } },
    ];
    const send = (async (url: string, init: RequestInit) => {
      calls.push({ url, method: init.method!, auth: new Headers(init.headers).get("authorization") });
      return init.method === "GET" ? Response.json(pages.shift()) : new Response(null, { status: 200 });
    }) as unknown as typeof fetch;

    const objects = cloudflareObjects({ accountId: "acct", token: "invented-token", fetch: send });
    expect(await clearRecordingObjects(objects, "usr_1")).toBe(2);

    const base = "https://api.cloudflare.com/client/v4/accounts/acct/r2/buckets/track-record-recordings/objects";
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      `GET ${base}?prefix=usr_1%2F&per_page=1000`,
      `GET ${base}?prefix=usr_1%2F&per_page=1000&cursor=next+page`,
      `DELETE ${base}/usr_1/a`,
      `DELETE ${base}/usr_1/b`,
      `GET ${base}?prefix=usr_1%2F&per_page=1000`,
    ]);
    expect(new Set(calls.map((call) => call.auth))).toEqual(new Set(["Bearer invented-token"]));

    const refusing = cloudflareObjects({ accountId: "acct", token: "t", fetch: (async () => new Response(null, { status: 403 })) as unknown as typeof fetch });
    await expect(refusing.list("usr_1/")).rejects.toThrow(/403/);
  });
});
