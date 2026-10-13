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
 * And of a saved entry (issue #81): a correction overwrites it and keeps the
 * row of each question that stays; a corrected day is followed by its round's
 * step date and the figure; deleting takes it off the page, keeps the row and
 * moves nothing back; and neither reaches another user's entry.
 *
 * Every company, person and question here is INVENTED.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { harness, stubModel, type Client, type Harness } from "./helpers/harness";
import { SECOND_EMAIL, seedAllowedUser } from "./helpers/seed";
import { readStanding, saveStanding } from "~/server/routes/applications";
import { eq } from "drizzle-orm";
import { interviewRecordings, interviews } from "~/server/db/schema";
import { moveTo } from "~/shared/application";
import { standingAfterInterview } from "~/shared/interview";

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
let userId: string;

beforeEach(async () => {
  // Only `Date`: the database is real and its requests keep their real timers.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(DAY_ONE);
  app = harness(stubModel());
  const user = await seedAllowedUser();
  userId = user.id;
  client = app.as(user);
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
  it("refuses an entry based on a standing another save already moved", async () => {
    const { id } = await add();
    const { row, steps, standing } = await readStanding(app.db, userId, id);
    await saveStanding(app.db, userId, id, row, steps, moveTo(standing, "interview_1", dateAfter(0)));

    await expect(
      saveStanding(app.db, userId, id, row, steps, moveTo(standing, "interview_final", dateAfter(0)), [
        app.db.insert(interviews).values({
          id: `stale_${crypto.randomUUID()}`,
          userId,
          applicationId: id,
          happenedOn: dateAfter(0),
          round: "interview_final",
          howItWent: "A later conversation.",
        }),
      ]),
    ).rejects.toMatchObject({ code: "conflict", message: "This application was changed somewhere else. Reload it and try again." });

    const after = await read(id);
    expect(after.step).toBe("interview_1");
    expect(after.dates.interview_final).toBeUndefined();
    expect(after.interviews).toEqual([]);
  });

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

describe("a standing read before a date-only change", () => {
  it("refuses a stale move back and keeps the newly dated skipped step", async () => {
    const { id } = await add();
    await set(id, "interview_final");
    const { row, steps, standing } = await readStanding(app.db, userId, id);
    expect(standing.dates.interview_2).toBeUndefined();

    await saveStanding(app.db, userId, id, row, steps, standingAfterInterview(standing, "interview_2", dateAfter(0)));
    await expect(
      saveStanding(app.db, userId, id, row, steps, moveTo(standing, "interview_1", dateAfter(0))),
    ).rejects.toMatchObject({ code: "conflict", message: "This application was changed somewhere else. Reload it and try again." });

    const after = await read(id);
    expect(after.step).toBe("interview_final");
    expect(after.dates.interview_2).toBe(dateAfter(0));
    expect(after.dates.interview_1).toBeUndefined();
  });
});

describe("an entry that leaves the status alone", () => {
  it("keeps a dated round and fills an earlier skipped round without moving the status", async () => {
    const { id } = await add();
    await set(id, "interview_2");
    await client.patch(`/api/applications/${id}/steps/interview_2`, { date: "2026-02-25" });

    const same = (await (await note(id, { ...FIRST, round: "interview_2", date: "2026-02-20" })).json()) as Detail;
    expect(same.step).toBe("interview_2");
    // The date the step already carries is not replaced by the entry's.
    expect(same.dates.interview_2).toBe("2026-02-25");

    const earlier = (await (await note(id, { ...FIRST, date: "2026-02-10" })).json()) as Detail;
    expect(earlier.step).toBe("interview_2");
    expect(earlier.dates.interview_1).toBe("2026-02-10");
    expect(earlier.daysSinceFirstInterview).toBe(20);
    const repeated = (await (await note(id, { ...FIRST, date: "2026-02-12" })).json()) as Detail;
    expect(repeated.dates.interview_1).toBe("2026-02-10");
    expect(earlier.interviews).toHaveLength(2);
  });

  it("undoes a filled skipped date while keeping the entry", async () => {
    const { id } = await add();
    await set(id, "interview_2");
    const before = await read(id);
    expect(before.dates.interview_1).toBeUndefined();

    const saved = (await (await note(id, { ...FIRST, date: "2026-02-20" })).json()) as Detail;
    expect(saved.step).toBe("interview_2");
    expect(saved.dates.interview_1).toBe("2026-02-20");

    const undone = await client.put(`/api/applications/${id}/standing`, {
      step: before.step,
      closedAs: before.closedAs,
      dates: before.dates,
    });
    expect(undone.status).toBe(200);
    const after = await read(id);
    expect(after.dates.interview_1).toBeUndefined();
    expect(after.daysSinceFirstInterview).toBeNull();
    expect(after.interviews).toHaveLength(1);
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

describe("correcting an entry", () => {
  const correct = (id: string, interviewId: string, body: Record<string, unknown>, as: Client = client) =>
    as.put(`/api/applications/${id}/interviews/${interviewId}`, body);
  /** The entry as its form would send it back, each question under its id. */
  const asSaved = (entry: Entry) => ({
    date: entry.date,
    round: entry.round,
    who: entry.who,
    howItWent: entry.howItWent,
    questions: entry.questions.map(({ id, text }) => ({ id, text })),
  });

  it("overwrites the day, the round, who and how it went, at once and after a reload", async () => {
    const { id } = await add();
    await set(id, "interview_2");
    const [entry] = ((await (await note(id, FIRST)).json()) as Detail).interviews;

    const response = await correct(id, entry!.id, {
      ...asSaved(entry!),
      date: "2026-02-27",
      round: "other",
      who: "The recruiter",
      howItWent: "Shorter than planned.",
    });
    expect(response.status).toBe(200);
    const after = (await response.json()) as Detail;

    expect(after.interviews).toHaveLength(1);
    expect(after.interviews[0]).toMatchObject({
      id: entry!.id,
      date: "2026-02-27",
      round: "other",
      who: "The recruiter",
      howItWent: "Shorter than planned.",
    });
    expect((await read(id)).interviews).toEqual(after.interviews);
  });

  it("keeps the row of each question that stays, in its new place, drops the ones left out and adds the new", async () => {
    const { id } = await add();
    const [entry] = ((await (await note(id, FIRST)).json()) as Detail).interviews;
    const [measure, outage, build] = entry!.questions;

    const after = (await (
      await correct(id, entry!.id, {
        ...asSaved(entry!),
        questions: [
          { text: "Who is on call tonight?" },
          { id: build!.id, text: build!.text },
          { id: measure!.id, text: "What would you measure first?" },
          { text: "  " },
          { text: "What did the last incident teach you?" },
        ],
      })
    ).json()) as Detail;

    const questions = after.interviews[0]!.questions;
    expect(questions.map((question) => question.text)).toEqual([
      "Who is on call tonight?",
      "How do you decide what not to build?",
      "What would you measure first?",
      "What did the last incident teach you?",
    ]);
    expect([questions[1]!.id, questions[2]!.id]).toEqual([build!.id, measure!.id]);
    expect(questions.map((question) => question.id)).not.toContain(outage!.id);

    const backup = await client.json<{ interviewQuestions: { id: string; position: number; removedAt: string | null }[] }>("/api/export");
    const live = backup.interviewQuestions.filter((row) => row.removedAt === null);
    expect(live.sort((a, b) => a.position - b.position).map((row) => [row.id, row.position])).toEqual(
      questions.map((question, position) => [question.id, position]),
    );
    expect(backup.interviewQuestions.find((row) => row.id === outage!.id)).toMatchObject({
      id: outage!.id, position: 1,
    });
    expect(backup.interviewQuestions.find((row) => row.id === outage!.id)?.removedAt).not.toBeNull();
    expect((await read(id)).interviews[0]!.questions).toEqual(questions);
    expect((await correct(id, entry!.id, {
      ...asSaved(after.interviews[0]!),
      questions: [{ id: outage!.id, text: outage!.text }],
    })).status).toBe(422);
  });

  it("is followed by the date of its round's step, and by the first-interview figure", async () => {
    const { id } = await add();
    await set(id, "applied");
    vi.setSystemTime(dayAfter(20));
    const noted = (await (await note(id, { ...FIRST, date: dateAfter(16) })).json()) as Detail;
    expect(noted.dates.interview_1).toBe(dateAfter(16));
    expect(noted.daysSinceFirstInterview).toBe(4);

    // It was the day before.
    const after = (await (await correct(id, noted.interviews[0]!.id, { ...asSaved(noted.interviews[0]!), date: dateAfter(15) })).json()) as Detail;

    expect(after.step).toBe("interview_1");
    expect(after.dates.interview_1).toBe(dateAfter(15));
    expect(after.daysSinceFirstInterview).toBe(5);
    expect(after.interviews[0]!.date).toBe(dateAfter(15));
    expect((await read(id)).dates.interview_1).toBe(dateAfter(15));

    // Undo puts the step's date back and keeps the corrected entry.
    const undone = await client.put(`/api/applications/${id}/standing`, { step: noted.step, closedAs: noted.closedAs, dates: noted.dates });
    expect(undone.status).toBe(200);
    const restored = await read(id);
    expect(restored.dates.interview_1).toBe(dateAfter(16));
    expect(restored.interviews[0]!.date).toBe(dateAfter(15));
  });

  it("keeps the first interview date when another live entry shares the old day", async () => {
    const { id } = await add();
    await set(id, "applied");
    vi.setSystemTime(dayAfter(20));
    await note(id, { ...FIRST, date: dateAfter(16) });
    const noted = (await (await note(id, { ...FIRST, date: dateAfter(16) })).json()) as Detail;
    const corrected = (await (await correct(id, noted.interviews[0]!.id, {
      ...asSaved(noted.interviews[0]!), date: dateAfter(15),
    })).json()) as Detail;

    expect(corrected.interviews.find((entry) => entry.id === noted.interviews[0]!.id)?.date).toBe(dateAfter(15));
    expect(corrected.dates.interview_1).toBe(dateAfter(16));
    expect(corrected.daysSinceFirstInterview).toBe(4);
    expect((await read(id)).dates.interview_1).toBe(dateAfter(16));
  });

  it("leaves a step date the author set by hand, and a status the words alone do not concern", async () => {
    const { id } = await add();
    await set(id, "applied");
    const before = await read(id);
    const noted = (await (await note(id, { ...FIRST, date: "2026-02-20" })).json()) as Detail;
    const [entry] = noted.interviews;

    // Undone: back at Applied. Putting a typo right must not move it again.
    await client.put(`/api/applications/${id}/standing`, { step: before.step, closedAs: before.closedAs, dates: before.dates });
    const reworded = (await (await correct(id, entry!.id, { ...asSaved(entry!), who: "Two engineers" })).json()) as Detail;
    expect(reworded.step).toBe("applied");
    expect(reworded.dates.interview_1).toBeUndefined();
    expect(reworded.interviews[0]!.who).toBe("Two engineers");

    // At the round again, with a date set by hand that is not the entry's.
    await set(id, "interview_1");
    await client.patch(`/api/applications/${id}/steps/interview_1`, { date: "2026-02-25" });
    const redated = (await (await correct(id, entry!.id, { ...asSaved(entry!), who: "Two engineers", date: "2026-02-18" })).json()) as Detail;
    expect(redated.dates.interview_1).toBe("2026-02-25");
    expect(redated.interviews[0]!.date).toBe("2026-02-18");
  });

  it("moves the status on when the round becomes a later one, and never back", async () => {
    const { id } = await add();
    await set(id, "interview_1");
    const [entry] = ((await (await note(id, FIRST)).json()) as Detail).interviews;

    const later = (await (await correct(id, entry!.id, { ...asSaved(entry!), round: "interview_final", date: "2026-02-27" })).json()) as Detail;
    expect(later.step).toBe("interview_final");
    expect(later.dates.interview_final).toBe("2026-02-27");

    const earlier = (await (await correct(id, entry!.id, { ...asSaved(entry!), round: "interview_2", date: "2026-02-24" })).json()) as Detail;
    expect(earlier.step).toBe("interview_final");
    expect(earlier.dates.interview_final).toBe("2026-02-27");
    // The round it now names was passed over, so it gets the entry's day.
    expect(earlier.dates.interview_2).toBe("2026-02-24");
  });

  it("leaves a closed application where it stands", async () => {
    const { id } = await add();
    await set(id, "interview_1");
    const [entry] = ((await (await note(id, FIRST)).json()) as Detail).interviews;
    await set(id, "rejected");

    const after = (await (await correct(id, entry!.id, { ...asSaved(entry!), date: "2026-02-20" })).json()) as Detail;
    expect(after).toMatchObject({ step: "interview_1", closedAs: "rejected" });
    expect(after.dates.interview_1).toBe(dateAfter(0));
    expect(after.interviews[0]!.date).toBe("2026-02-20");
  });

  it("writes nothing when nothing was changed, and counts as a change when something was", async () => {
    const { id } = await add();
    await set(id, "applied");
    const noted = (await (await note(id, { ...FIRST, round: "other" })).json()) as Detail;
    const [entry] = noted.interviews;
    vi.setSystemTime(dayAfter(20));

    const same = (await (await correct(id, entry!.id, asSaved(entry!))).json()) as Detail;
    expect(same.lastActivityAt).toBe(noted.lastActivityAt);
    expect(same.quietDays).toBe(20);

    const changed = (await (await correct(id, entry!.id, { ...asSaved(entry!), howItWent: "Friendly and fast." })).json()) as Detail;
    expect(changed.daysSinceLastActivity).toBe(0);
    expect(changed.quietDays).toBeNull();
  });

  it("refuses what a new entry is refused for, a question that is not the entry's, and an entry that is not there", async () => {
    const { id } = await add();
    const noted = (await (await note(id, FIRST)).json()) as Detail;
    const other = ((await (await note(id, { ...FIRST, round: "other", questions: ["Why now?"] })).json()) as Detail).interviews.find(
      (entry) => entry.round === "other",
    )!;
    const entry = noted.interviews[0]!;
    const saved = asSaved(entry);

    for (const [why, body] of [
      ["no such day", { ...saved, date: "2026-02-30" }],
      ["tomorrow", { ...saved, date: dateAfter(1) }],
      ["not a round", { ...saved, round: "offer" }],
      ["an extra field", { ...saved, recording: "https://example.invalid/call.m4a" }],
      ["nothing in it", { ...saved, howItWent: " ", questions: [] }],
      ["questions as plain strings", { ...saved, questions: ["Why now?"] }],
      ["a question of another entry", { ...saved, questions: [{ id: other.questions[0]!.id, text: "Why now?" }] }],
      ["one question twice", { ...saved, questions: [saved.questions[0], saved.questions[0]] }],
    ] as [string, Record<string, unknown>][]) {
      expect((await correct(id, entry.id, body)).status, why).toBe(422);
    }
    expect((await correct(id, "int_nothere", saved)).status).toBe(404);

    expect((await read(id)).interviews.find((item) => item.id === entry.id)).toEqual(entry);
  });
});

describe("deleting an entry", () => {
  const remove = (id: string, interviewId: string, as: Client = client) =>
    as.delete(`/api/applications/${id}/interviews/${interviewId}`);

  it("takes it off the application, at once and after a reload, and leaves the status and its dates", async () => {
    const { id } = await add();
    await set(id, "applied");
    await note(id, { ...FIRST, round: "other" });
    const noted = (await (await note(id, FIRST)).json()) as Detail;
    expect(noted.step).toBe("interview_1");
    const moved = noted.interviews.find((entry) => entry.round === "interview_1")!;

    const response = await remove(id, moved.id);
    expect(response.status).toBe(200);
    const after = (await response.json()) as Detail;

    expect(after.interviews.map((entry) => entry.round)).toEqual(["other"]);
    // The entry that moved the status is gone, and the status is not moved back.
    expect(after.step).toBe("interview_1");
    expect(after.dates).toEqual(noted.dates);
    expect(after.daysSinceFirstInterview).toBe(0);
    expect((await read(id)).interviews).toEqual(after.interviews);
  });

  it("leaves nothing of it to correct, delete again or attach a recording to", async () => {
    const { id } = await add();
    const [entry] = ((await (await note(id, FIRST)).json()) as Detail).interviews;
    expect((await remove(id, entry!.id)).status).toBe(200);

    expect((await remove(id, entry!.id)).status).toBe(404);
    expect(
      (await client.put(`/api/applications/${id}/interviews/${entry!.id}`, { ...FIRST, questions: [] })).status,
    ).toBe(404);
    expect(
      (await client.post(`/api/applications/${id}/interviews/${entry!.id}/recordings`, { url: "https://calls.example.invalid/rec/one" }))
        .status,
    ).toBe(404);
    expect((await remove(id, "int_nothere")).status).toBe(404);
  });

  it("keeps the row and its questions, and removes its recording links for good", async () => {
    const { id } = await add();
    const [entry] = ((await (await note(id, FIRST)).json()) as Detail).interviews;
    await client.post(`/api/applications/${id}/interviews/${entry!.id}/recordings`, {
      url: "https://calls.example.invalid/rec/one",
      label: "Their recording",
    });
    await remove(id, entry!.id);

    const backup = await client.json<{
      interviews: { id: string; removedAt: string | null; howItWent: string }[];
      interviewQuestions: { interviewId: string }[];
    }>("/api/export");
    expect(backup.interviews).toHaveLength(1);
    expect(backup.interviews[0]).toMatchObject({ id: entry!.id, howItWent: FIRST.howItWent });
    expect(backup.interviews[0]!.removedAt).not.toBeNull();
    expect(backup.interviewQuestions.filter((row) => row.interviewId === entry!.id)).toHaveLength(3);

    const links = await app.db.select().from(interviewRecordings).where(eq(interviewRecordings.interviewId, entry!.id));
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ url: null, label: "" });
    expect(links[0]!.removedAt).not.toBeNull();
  });

  it("counts as a change to the application", async () => {
    const { id } = await add();
    await set(id, "applied");
    const [entry] = ((await (await note(id, { ...FIRST, round: "other" })).json()) as Detail).interviews;
    vi.setSystemTime(dayAfter(20));
    expect((await read(id)).quietDays).toBe(20);

    const after = (await (await remove(id, entry!.id)).json()) as Detail;
    expect(after.daysSinceLastActivity).toBe(0);
    expect(after.quietDays).toBeNull();
  });
});

describe("another user's interviews", () => {
  it("cannot be corrected or deleted, and are as they were", async () => {
    const mine = await add();
    const [entry] = ((await (await note(mine.id, FIRST)).json()) as Detail).interviews;
    const other = app.as(await seedAllowedUser(SECOND_EMAIL));
    const theirs = await add(other);
    const taken = { date: dateAfter(0), round: "interview_final", who: "taken", howItWent: "taken", questions: [{ text: "taken" }] };

    // Through the owner's application, and through their own with the owner's entry.
    for (const applicationId of [mine.id, theirs.id]) {
      const at = `/api/applications/${applicationId}/interviews/${entry!.id}`;
      expect((await other.put(at, taken)).status).toBe(404);
      expect((await other.delete(at)).status).toBe(404);
    }

    const after = await read(mine.id);
    expect(after.step).toBe("interview_1");
    expect(after.interviews).toEqual([entry]);
    expect((await read(theirs.id, other)).interviews).toEqual([]);
    expect((await read(theirs.id, other)).step).toBe("not_applied");
  });

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
