/**
 * Recordings on an interview entry, through the API (`docs/07` §9b, issue #74).
 *
 * What is pinned here: a link to a recording kept elsewhere can be added to an
 * entry and is read back on it; only `http` and `https` links are accepted;
 * removing one empties the link for good and leaves a line with the day;
 * adding and removing are changes to the application; and neither reaches the
 * exported record.
 *
 * Every company, person, link and label here is INVENTED.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { harness, stubModel, type Client, type Harness } from "./helpers/harness";
import { SECOND_EMAIL, seedAllowedUser } from "./helpers/seed";
import { interviewRecordings } from "~/server/db/schema";
import { isWebLink, type Recording } from "~/shared/recording";

interface Detail {
  id: string;
  step: string;
  lastActivityAt: string;
  daysSinceLastActivity: number;
  interviews: { id: string; round: string; recordings: Recording[] }[];
}

const JOB = {
  company: "Osprey Grid",
  position: "Platform Engineer",
  jobDescription: "Osprey Grid is hiring a platform engineer for its substation telemetry service.",
};
const LINK = { url: "https://meet.example.invalid/rec/osprey-first", label: "Their recording of the call" };

/** Midday in Japan, so a test that moves the clock by whole days never crosses midnight. */
const DAY_ONE = new Date("2026-03-02T03:00:00.000Z");
const dayAfter = (days: number) => new Date(DAY_ONE.getTime() + days * 86_400_000);
const dateAfter = (days: number) => dayAfter(days).toISOString().slice(0, 10);

let app: Harness;
let client: Client;

beforeEach(async () => {
  // Only `Date`: the database is real and its requests keep their real timers.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(DAY_ONE);
  app = harness(stubModel());
  client = app.as(await seedAllowedUser());
});

afterEach(() => {
  vi.useRealTimers();
});

const read = (id: string, as: Client = client) => as.json<Detail>(`/api/applications/${id}`);
const at = (id: string, interviewId: string) => `/api/applications/${id}/interviews/${interviewId}/recordings`;
const attach = (id: string, interviewId: string, body: unknown, as: Client = client) =>
  as.post(at(id, interviewId), body);
const remove = (id: string, interviewId: string, recordingId: string, as: Client = client) =>
  as.delete(`${at(id, interviewId)}/${recordingId}`);

/** An application with one interview entry on it. */
async function noted(as: Client = client) {
  const { id } = (await (await as.post("/api/applications", JOB)).json()) as Detail;
  const response = await as.post(`/api/applications/${id}/interviews`, {
    date: dateAfter(0),
    round: "interview_1",
    howItWent: "Friendly and fast.",
  });
  const after = (await response.json()) as Detail;
  return { id, interviewId: after.interviews[0]!.id };
}

describe("adding a link to a recording", () => {
  it("keeps the link and what it is on the entry, and answers with the application", async () => {
    const { id, interviewId } = await noted();

    const response = await attach(id, interviewId, LINK);
    expect(response.status).toBe(201);
    const after = (await response.json()) as Detail;

    expect(after.interviews[0]!.recordings).toEqual([{ id: expect.stringMatching(/^rec_/), kind: "link", ...LINK }]);
    expect((await read(id)).interviews).toEqual(after.interviews);
  });

  it("needs no label, trims both, and lists several in the order they were attached", async () => {
    const { id, interviewId } = await noted();
    await attach(id, interviewId, { url: "  http://files.example.invalid/first.m4a  " });
    await attach(id, interviewId, { url: LINK.url, label: "  The second half  " });

    expect((await read(id)).interviews[0]!.recordings).toMatchObject([
      { kind: "link", url: "http://files.example.invalid/first.m4a", label: "" },
      { kind: "link", url: LINK.url, label: "The second half" },
    ]);
  });

  it("goes on the entry it was attached to and on no other", async () => {
    const { id, interviewId } = await noted();
    await client.post(`/api/applications/${id}/interviews`, {
      date: dateAfter(0),
      round: "interview_2",
      howItWent: "A design exercise.",
    });
    await attach(id, interviewId, LINK);

    const entries = (await read(id)).interviews;
    expect(entries.find((entry) => entry.id === interviewId)!.recordings).toHaveLength(1);
    expect(entries.find((entry) => entry.id !== interviewId)!.recordings).toEqual([]);
  });

  it.each([
    ["no scheme", "meet.example.invalid/rec/osprey-first"],
    ["a script", "javascript:alert(1)"],
    ["a data address", "data:text/html,<p>hello</p>"],
    ["a file on this machine", "file:///Users/someone/call.m4a"],
    ["another scheme", "ftp://files.example.invalid/call.m4a"],
    ["a scheme and nothing after it", "https://"],
    ["a space inside it", "https://meet.example.invalid/rec/osprey first"],
    ["an https address after other text", "see https://meet.example.invalid/rec"],
    ["nothing", ""],
  ])("refuses %s, and keeps nothing", async (_what, url) => {
    const { id, interviewId } = await noted();

    const response = await attach(id, interviewId, { url, label: "The call" });
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { message: string; details: { fields: string[] } } };
    expect(body.error.message).toBe("That does not look like a link. It should start with https://");
    expect(body.error.details.fields).toEqual(["url"]);

    expect((await read(id)).interviews[0]!.recordings).toEqual([]);
    expect(
      await app.db.select().from(interviewRecordings).where(eq(interviewRecordings.interviewId, interviewId)),
    ).toEqual([]);
  });

  it("refuses a link or a label too long to be one, and anything else in the body", async () => {
    const { id, interviewId } = await noted();

    expect((await attach(id, interviewId, { url: `https://meet.example.invalid/${"a".repeat(2_000)}` })).status).toBe(422);
    expect((await attach(id, interviewId, { ...LINK, label: "a".repeat(201) })).status).toBe(422);
    expect((await attach(id, interviewId, { ...LINK, kind: "upload" })).status).toBe(422);
    expect((await read(id)).interviews[0]!.recordings).toEqual([]);
  });

  it("is a miss on an entry that is not there, or one that belongs to another application", async () => {
    const first = await noted();
    const second = await noted();

    expect((await attach(first.id, "int_nothinghere00000", LINK)).status).toBe(404);
    expect((await attach(first.id, second.interviewId, LINK)).status).toBe(404);
    expect((await attach("app_nothinghere00000", first.interviewId, LINK)).status).toBe(404);
    expect((await read(second.id)).interviews[0]!.recordings).toEqual([]);
  });
});

describe("removing a recording", () => {
  it("empties the link for good and leaves a line with the day it was removed", async () => {
    const { id, interviewId } = await noted();
    const added = (await (await attach(id, interviewId, LINK)).json()) as Detail;
    const recordingId = added.interviews[0]!.recordings[0]!.id;

    vi.setSystemTime(dayAfter(3));
    const response = await remove(id, interviewId, recordingId);
    expect(response.status).toBe(200);
    const after = (await response.json()) as Detail;

    expect(after.interviews[0]!.recordings).toEqual([{ id: recordingId, kind: "removed", removedOn: dateAfter(3) }]);
    expect((await read(id)).interviews).toEqual(after.interviews);

    // Gone from the database too, not only from what is read back.
    const [row] = await app.db.select().from(interviewRecordings).where(eq(interviewRecordings.id, recordingId));
    expect(row).toMatchObject({ url: null, label: "" });
    expect(row!.removedAt).toBeInstanceOf(Date);
  });

  it("says the day in Japan, which is already tomorrow late in the UTC day", async () => {
    const { id, interviewId } = await noted();
    const added = (await (await attach(id, interviewId, LINK)).json()) as Detail;

    vi.setSystemTime(new Date("2026-03-05T20:00:00.000Z"));
    const after = (await (await remove(id, interviewId, added.interviews[0]!.recordings[0]!.id)).json()) as Detail;
    expect(after.interviews[0]!.recordings[0]).toMatchObject({ kind: "removed", removedOn: "2026-03-06" });
  });

  it("keeps the line in its place among the entry's other recordings", async () => {
    const { id, interviewId } = await noted();
    const added = (await (await attach(id, interviewId, LINK)).json()) as Detail;
    await attach(id, interviewId, { url: "https://files.example.invalid/second.m4a" });

    await remove(id, interviewId, added.interviews[0]!.recordings[0]!.id);
    expect((await read(id)).interviews[0]!.recordings.map((recording) => recording.kind)).toEqual(["removed", "link"]);
  });

  it("is a miss the second time, and on a recording, entry or application that is not there", async () => {
    const { id, interviewId } = await noted();
    const other = await noted();
    const added = (await (await attach(id, interviewId, LINK)).json()) as Detail;
    const recordingId = added.interviews[0]!.recordings[0]!.id;

    expect((await remove(id, interviewId, "rec_nothinghere00000")).status).toBe(404);
    expect((await remove(id, other.interviewId, recordingId)).status).toBe(404);
    expect((await remove(other.id, other.interviewId, recordingId)).status).toBe(404);
    expect((await read(id)).interviews[0]!.recordings[0]).toMatchObject({ kind: "link" });

    expect((await remove(id, interviewId, recordingId)).status).toBe(200);
    expect((await remove(id, interviewId, recordingId)).status).toBe(404);
  });
});

describe("a recording and the application it is on", () => {
  it("counts as a change when one is attached and when one is removed, and moves no status", async () => {
    const { id, interviewId } = await noted();
    const before = await read(id);

    vi.setSystemTime(dayAfter(5));
    const added = (await (await attach(id, interviewId, LINK)).json()) as Detail;
    expect(added.daysSinceLastActivity).toBe(0);
    expect(Date.parse(added.lastActivityAt)).toBeGreaterThan(Date.parse(before.lastActivityAt));
    expect(added.step).toBe(before.step);

    vi.setSystemTime(dayAfter(9));
    expect((await read(id)).daysSinceLastActivity).toBe(4);
    const removed = (await (await remove(id, interviewId, added.interviews[0]!.recordings[0]!.id)).json()) as Detail;
    expect(removed.daysSinceLastActivity).toBe(0);
    expect(removed.step).toBe(before.step);
  });

  it("is not in the exported record", async () => {
    const { id, interviewId } = await noted();
    await attach(id, interviewId, LINK);

    const backup = await (await client.get("/api/export")).text();
    expect(backup).toContain(interviewId);
    expect(backup).not.toContain("meet.example.invalid");
    expect(backup).not.toContain(LINK.label);
    expect(backup).not.toContain("ecording");
  });
});

describe("another user's recordings", () => {
  it("cannot be added to, removed or read, and theirs are unchanged", async () => {
    const mine = await noted();
    const added = (await (await attach(mine.id, mine.interviewId, LINK)).json()) as Detail;
    const recordingId = added.interviews[0]!.recordings[0]!.id;
    const other = app.as(await seedAllowedUser(SECOND_EMAIL));
    const theirs = await noted(other);

    expect((await attach(mine.id, mine.interviewId, LINK, other)).status).toBe(404);
    expect((await remove(mine.id, mine.interviewId, recordingId, other)).status).toBe(404);
    // Their own application and entry in the path do not reach across either.
    expect((await remove(theirs.id, theirs.interviewId, recordingId, other)).status).toBe(404);
    expect((await attach(theirs.id, mine.interviewId, LINK, other)).status).toBe(404);

    expect((await read(theirs.id, other)).interviews[0]!.recordings).toEqual([]);
    expect((await read(mine.id)).interviews[0]!.recordings).toEqual([{ id: recordingId, kind: "link", ...LINK }]);
  });
});

describe("what counts as a link", () => {
  it.each(["https://meet.example.invalid/rec/1?t=30#chapter", "http://files.example.invalid/a.m4a", "HTTPS://Meet.Example.invalid/x"])(
    "takes %s",
    (url) => expect(isWebLink(url)).toBe(true),
  );

  it.each(["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,x", "file:///a", "//meet.example.invalid", "https://", "https:// x", "", " https://meet.example.invalid"])(
    "refuses %j",
    (url) => expect(isWebLink(url)).toBe(false),
  );
});
