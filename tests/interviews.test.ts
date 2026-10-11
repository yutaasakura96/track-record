/**
 * Interview entries, through the API (`docs/07` §9b, issue #72).
 *
 * What is pinned here: an entry holds the day, the round, who it was with and
 * how it went; its questions are stored as separate rows in the order given;
 * an entry for a later round moves the status to that round with the entry's
 * day, so the "since the first interview" figure follows; an entry for a round
 * already reached, a conversation that is not a round, or one on a closed
 * application leaves the status alone; and Undo of the move keeps the entry.
 *
 * Every company, person and question here is INVENTED.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { harness, stubModel, type Client, type Harness } from "./helpers/harness";
import { SECOND_EMAIL, seedAllowedUser } from "./helpers/seed";

interface Entry {
  id: string;
  date: string;
  round: string;
  who: string;
  howItWent: string;
  questions: { id: string; text: string }[];
}
interface Detail {
  id: string;
  step: string;
  closedAs: string | null;
  dates: Record<string, string>;
  lastActivityAt: string;
  daysSinceFirstInterview: number | null;
  daysSinceLastActivity: number;
  quietDays: number | null;
  interviews: Entry[];
}

const JOB = {
  company: "Osprey Grid",
  position: "Platform Engineer",
  jobDescription: "Osprey Grid is hiring a platform engineer for its substation telemetry service.",
};

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

const add = async (as: Client = client) => (await (await as.post("/api/applications", JOB)).json()) as Detail;
const read = (id: string, as: Client = client) => as.json<Detail>(`/api/applications/${id}`);
const set = (id: string, status: string) => client.post(`/api/applications/${id}/steps`, { status });
const note = (id: string, body: Record<string, unknown>, as: Client = client) =>
  as.post(`/api/applications/${id}/interviews`, body);

const FIRST = {
  date: dateAfter(0),
  round: "interview_1",
  who: "Engineering manager and one senior engineer",
  howItWent: "Friendly and fast.\nMostly about the telemetry pipeline.",
  questions: [
    "What would you measure first on a pipeline you inherit?",
    "Tell us about an outage you caused.",
    "How do you decide what not to build?",
  ],
};

describe("adding an interview entry", () => {
  it("saves the day, the round, who it was with and how it went, and answers with the application", async () => {
    const { id } = await add();
    await set(id, "interview_1");

    const response = await note(id, FIRST);
    expect(response.status).toBe(201);
    const after = (await response.json()) as Detail;

    expect(after.interviews).toHaveLength(1);
    expect(after.interviews[0]).toMatchObject({
      date: dateAfter(0),
      round: "interview_1",
      who: "Engineering manager and one senior engineer",
      howItWent: "Friendly and fast.\nMostly about the telemetry pipeline.",
    });
    expect((await read(id)).interviews).toEqual(after.interviews);
  });

  it("stores each question as its own row, in the order given", async () => {
    const { id } = await add();
    await note(id, { ...FIRST, questions: ["  " + FIRST.questions[0], "", ...FIRST.questions.slice(1), "   "] });

    // What the page reads: the questions in order, the blank ones gone.
    const [entry] = (await read(id)).interviews;
    expect(entry!.questions.map((question) => question.text)).toEqual(FIRST.questions);
    expect(new Set(entry!.questions.map((question) => question.id)).size).toBe(3);

    // What the database holds: one row a question, numbered from 0 with no gap.
    const backup = await client.json<{
      interviews: { id: string; applicationId: string; happenedOn: string; round: string }[];
      interviewQuestions: { id: string; interviewId: string; position: number; text: string }[];
    }>("/api/export");
    expect(backup.interviews).toMatchObject([
      { id: entry!.id, applicationId: id, happenedOn: dateAfter(0), round: "interview_1" },
    ]);
    const rows = backup.interviewQuestions.sort((a, b) => a.position - b.position);
    expect(rows.map((row) => [row.interviewId, row.position, row.text])).toEqual(
      FIRST.questions.map((text, position) => [entry!.id, position, text]),
    );
    expect(rows.map((row) => row.id)).toEqual(entry!.questions.map((question) => question.id));
  });

  it("keeps two entries apart, each with its own questions, newest day first", async () => {
    const { id } = await add();
    await note(id, { ...FIRST, date: "2026-02-20" });
    await note(id, { date: "2026-02-27", round: "interview_2", howItWent: "", questions: ["Why this team?"] });
    await note(id, { date: "2026-02-20", round: "other", howItWent: "A call with the recruiter.", questions: [] });

    const entries = (await read(id)).interviews;
    // Of the two on one day, the one noted later comes first.
    expect(entries.map((entry) => [entry.date, entry.round])).toEqual([
      ["2026-02-27", "interview_2"],
      ["2026-02-20", "other"],
      ["2026-02-20", "interview_1"],
    ]);
    expect(entries.map((entry) => entry.questions.map((question) => question.text))).toEqual([
      ["Why this team?"],
      [],
      FIRST.questions,
    ]);
  });

  it("needs how it went or at least one question", async () => {
    const { id } = await add();

    const empty = await note(id, { date: dateAfter(0), round: "interview_1", who: "The CTO", howItWent: "  ", questions: [" "] });
    expect(empty.status).toBe(422);
    expect(((await empty.json()) as { error: { message: string } }).error.message).toBe(
      "Write how it went, or add at least one question.",
    );

    expect((await note(id, { date: dateAfter(0), round: "interview_1", howItWent: "Short and kind." })).status).toBe(201);
    expect((await note(id, { date: dateAfter(0), round: "interview_2", questions: ["Why now?"] })).status).toBe(201);
    expect((await read(id)).interviews).toHaveLength(2);
  });

  it("refuses a day that does not exist or is in the future, a round not in the list, and an extra field", async () => {
    const { id } = await add();

    for (const [why, body] of [
      ["no such day", { ...FIRST, date: "2026-02-30" }],
      ["tomorrow", { ...FIRST, date: dateAfter(1) }],
      ["not a round", { ...FIRST, round: "offer" }],
      ["an extra field", { ...FIRST, recording: "https://example.invalid/call.m4a" }],
      ["a question too long", { ...FIRST, questions: ["q".repeat(1_001)] }],
    ] as [string, Record<string, unknown>][]) {
      expect((await note(id, body)).status, why).toBe(422);
    }

    const after = await read(id);
    expect(after.interviews).toEqual([]);
    expect(after.step).toBe("not_applied");
  });
});

describe("an entry for a later round", () => {
  it("moves the status to that round, with the entry's day as its date, and the first-interview figure follows", async () => {
    const { id } = await add();
    await set(id, "applied");
    vi.setSystemTime(dayAfter(20));

    // Noted four days after it happened.
    const after = (await (await note(id, { ...FIRST, date: dateAfter(16) })).json()) as Detail;

    expect(after.step).toBe("interview_1");
    expect(after.dates.interview_1).toBe(dateAfter(16));
    expect(after.daysSinceFirstInterview).toBe(4);
    // Résumé passed was passed over, so it has no date.
    expect(after.dates.resume_passed).toBeUndefined();
    expect(after.dates.applied).toBe(dateAfter(0));
  });

  it("moves past the rounds it skips, and leaves them without a date", async () => {
    const { id } = await add();
    await set(id, "interview_1");

    const after = (await (await note(id, { ...FIRST, round: "interview_final" })).json()) as Detail;

    expect(after.step).toBe("interview_final");
    expect(after.dates.interview_final).toBe(dateAfter(0));
    expect(after.dates.interview_2).toBeUndefined();
  });

  it("is undone by putting back the standing from before it, and the entry stays", async () => {
    const { id } = await add();
    await set(id, "applied");
    const before = await read(id);

    await note(id, FIRST);
    expect((await read(id)).step).toBe("interview_1");

    const undone = await client.put(`/api/applications/${id}/standing`, {
      step: before.step,
      closedAs: before.closedAs,
      dates: before.dates,
    });
    expect(undone.status).toBe(200);

    const after = await read(id);
    expect(after.step).toBe("applied");
    expect(after.dates.interview_1).toBeUndefined();
    expect(after.daysSinceFirstInterview).toBeNull();
    expect(after.interviews).toHaveLength(1);
    expect(after.interviews[0]!.questions).toHaveLength(3);
  });
});

describe("an entry that leaves the status alone", () => {
  it("is one for a round at or before the step it is at", async () => {
    const { id } = await add();
    await set(id, "interview_2");
    await client.patch(`/api/applications/${id}/steps/interview_2`, { date: "2026-02-25" });

    const same = (await (await note(id, { ...FIRST, round: "interview_2", date: "2026-02-20" })).json()) as Detail;
    expect(same.step).toBe("interview_2");
    // The date the step already carries is not replaced by the entry's.
    expect(same.dates.interview_2).toBe("2026-02-25");

    const earlier = (await (await note(id, { ...FIRST, date: "2026-02-10" })).json()) as Detail;
    expect(earlier.step).toBe("interview_2");
    // And a step passed over is not given the entry's date either.
    expect(earlier.dates.interview_1).toBeUndefined();
    expect(earlier.interviews).toHaveLength(2);
  });

  it("is a conversation that is not a round", async () => {
    const { id } = await add();
    await set(id, "applied");

    const after = (await (await note(id, { ...FIRST, round: "other" })).json()) as Detail;

    expect(after.step).toBe("applied");
    expect(after.interviews[0]!.round).toBe("other");
  });

  it("still counts as a change: the application is no longer quiet, and leads the list", async () => {
    const quiet = await add();
    await set(quiet.id, "applied");
    vi.setSystemTime(dayAfter(15));
    const newer = await add();
    vi.setSystemTime(dayAfter(20));
    expect((await read(quiet.id)).quietDays).toBe(20);

    const after = (await (await note(quiet.id, { ...FIRST, round: "other", date: dateAfter(18) })).json()) as Detail;

    expect(after.step).toBe("applied");
    expect(after.daysSinceLastActivity).toBe(0);
    expect(after.quietDays).toBeNull();
    const list = await client.json<{ items: { id: string }[] }>("/api/applications");
    expect(list.items.map((item) => item.id)).toEqual([quiet.id, newer.id]);
  });

  it("is one on a closed application", async () => {
    const { id } = await add();
    await set(id, "applied");
    await set(id, "rejected");

    const response = await note(id, { ...FIRST, round: "interview_final" });
    expect(response.status).toBe(201);
    const after = (await response.json()) as Detail;

    expect(after).toMatchObject({ step: "applied", closedAs: "rejected" });
    expect(after.dates.interview_final).toBeUndefined();
    expect(after.interviews).toHaveLength(1);
  });
});

describe("another user's interviews", () => {
  it("cannot be added to or read, and theirs are unchanged", async () => {
    const mine = await add();
    await note(mine.id, FIRST);
    const other = app.as(await seedAllowedUser(SECOND_EMAIL));
    const theirs = await add(other);

    const response = await note(mine.id, { ...FIRST, round: "interview_final" }, other);
    expect(response.status).toBe(404);
    expect((await read(theirs.id, other)).interviews).toEqual([]);

    const backup = await other.json<{ interviews: unknown[]; interviewQuestions: unknown[] }>("/api/export");
    expect(backup.interviews).toEqual([]);
    expect(backup.interviewQuestions).toEqual([]);

    const after = await read(mine.id);
    expect(after.step).toBe("interview_1");
    expect(after.interviews).toHaveLength(1);
  });
});
