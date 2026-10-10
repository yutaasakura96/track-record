/**
 * Applications, through the API (`docs/07` §7b, issue #70).
 *
 * What is pinned here: a job is added by hand at Not applied; setting a status
 * saves its date and the date can be corrected; a step passed over has no date
 * until one is added; the "how long since" figures follow the dates; gone
 * quiet appears at 14 days and only while waiting to hear back; and one user
 * can never read or change another's applications.
 *
 * Two clocks are in play and the tests keep them apart. The figures count from
 * the date a step happened, which the author corrects. Gone quiet and the
 * list's order count from the last time the author changed the application,
 * which only the clock moves. Every entry here is INVENTED.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { harness, stubModel, type Client, type Harness } from "./helpers/harness";
import { PROFILE_FIXTURE, SECOND_EMAIL, seedAllowedUser, seedTailoredResume } from "./helpers/seed";

interface Row {
  id: string;
  company: string;
  position: string;
  postingUrl: string | null;
  step: string;
  closedAs: string | null;
  dates: Record<string, string>;
  lastActivityAt: string;
  daysSinceResumePassed: number | null;
  daysSinceFirstInterview: number | null;
  daysSinceClosed: number | null;
  daysSinceLastActivity: number;
  quietDays: number | null;
  resume: { title: string; versionNo: number | null } | null;
}
interface Detail extends Omit<Row, "resume"> {
  requirements: string[];
  jobDescription: string;
  resume: { id: string; ref: string; status: string } | null;
  canGenerate: boolean;
  today: string;
}

const POSTING = "Vellum Tideworks is hiring a backend engineer for its harbour scheduling service.";
const JOB = { company: "Vellum Tideworks", position: "Backend Engineer", jobDescription: POSTING };

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

const add = async (body: Record<string, unknown> = JOB, as: Client = client) =>
  (await (await as.post("/api/applications", body)).json()) as Detail;
const read = (id: string, as: Client = client) => as.json<Detail>(`/api/applications/${id}`);
const list = (as: Client = client) => as.json<{ items: Row[]; today: string }>("/api/applications");
const set = (id: string, status: string, as: Client = client) => as.post(`/api/applications/${id}/steps`, { status });
const correct = (id: string, status: string, date: string, as: Client = client) =>
  as.patch(`/api/applications/${id}/steps/${status}`, { date });

describe("adding a job by hand", () => {
  it("saves it as Not applied, with today as the day it was added", async () => {
    const response = await client.post("/api/applications", {
      ...JOB,
      postingUrl: "https://jobs.example.invalid/vellum/backend",
      requirements: ["Go in production", "  ", "Scheduling systems"],
    });
    expect(response.status).toBe(201);
    const made = (await response.json()) as Detail;

    expect(made).toMatchObject({
      company: "Vellum Tideworks",
      position: "Backend Engineer",
      postingUrl: "https://jobs.example.invalid/vellum/backend",
      // A requirement left blank is not one.
      requirements: ["Go in production", "Scheduling systems"],
      jobDescription: POSTING,
      step: "not_applied",
      closedAs: null,
      dates: { not_applied: dateAfter(0) },
      daysSinceResumePassed: null,
      daysSinceFirstInterview: null,
      quietDays: null,
      resume: null,
      today: dateAfter(0),
    });
    expect(await read(made.id)).toEqual(made);
  });

  it("lists it without the job description", async () => {
    const made = await add();
    const body = await list();
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ id: made.id, company: "Vellum Tideworks", step: "not_applied", resume: null });
    expect(JSON.stringify(body)).not.toContain("harbour scheduling");
  });

  it("refuses one with no company, no position or no job description, and says which", async () => {
    for (const [body, words] of [
      [{ ...JOB, company: " " }, "Give it a company."],
      [{ ...JOB, position: "" }, "Give it a position."],
      [{ ...JOB, jobDescription: "" }, "Paste the job description."],
      [{ ...JOB, jobDescription: "a".repeat(20_001) }, "at most 20,000 characters"],
      [{ ...JOB, postingUrl: "javascript:alert(1)" }, "starts with https://"],
    ] as [Record<string, unknown>, string][]) {
      const response = await client.post("/api/applications", body);
      expect(response.status, words).toBe(422);
      expect(JSON.stringify(await response.json())).toContain(words);
    }
    // A status is never chosen at creation: it starts at Not applied.
    expect((await client.post("/api/applications", { ...JOB, step: "offer" })).status).toBe(422);
    expect((await list()).items).toEqual([]);
  });

  it("corrects the company, the position, the link and the requirements, and never the job description", async () => {
    const made = await add();
    const edited = await client.patch(`/api/applications/${made.id}`, {
      company: "Vellum Tideworks K.K.",
      position: "Senior Backend Engineer",
      postingUrl: "",
      requirements: ["Tide tables"],
    });
    expect(edited.status).toBe(200);
    expect(await edited.json()).toMatchObject({
      company: "Vellum Tideworks K.K.",
      position: "Senior Backend Engineer",
      postingUrl: null,
      requirements: ["Tide tables"],
      jobDescription: POSTING,
    });

    expect((await client.patch(`/api/applications/${made.id}`, { jobDescription: "Something else." })).status).toBe(422);
    expect((await client.patch(`/api/applications/${made.id}`, { company: "" })).status).toBe(422);
    expect((await read(made.id)).jobDescription).toBe(POSTING);
  });
});

describe("status steps and their dates", () => {
  it("saves today's date on each change, and keeps the dates already saved", async () => {
    const { id } = await add();
    vi.setSystemTime(dayAfter(2));
    expect((await set(id, "applied")).status).toBe(200);
    vi.setSystemTime(dayAfter(9));
    const passed = (await (await set(id, "resume_passed")).json()) as Detail;

    expect(passed).toMatchObject({
      step: "resume_passed",
      dates: { not_applied: dateAfter(0), applied: dateAfter(2), resume_passed: dateAfter(9) },
      daysSinceResumePassed: 0,
      daysSinceFirstInterview: null,
    });

    vi.setSystemTime(dayAfter(12));
    expect(await read(id)).toMatchObject({ daysSinceResumePassed: 3, today: dateAfter(12) });
  });

  it("gives a skipped step no date, until one is added", async () => {
    const { id } = await add();
    await set(id, "applied");
    vi.setSystemTime(dayAfter(20));
    // Straight to the first interview: the company never said the résumé passed.
    const skipped = (await (await set(id, "interview_1")).json()) as Detail;
    expect(skipped.step).toBe("interview_1");
    expect(skipped.dates).toEqual({ not_applied: dateAfter(0), applied: dateAfter(0), interview_1: dateAfter(20) });
    expect(skipped).toMatchObject({ daysSinceResumePassed: null, daysSinceFirstInterview: 0 });

    const added = await correct(id, "resume_passed", dateAfter(8));
    expect(added.status).toBe(200);
    expect(await added.json()).toMatchObject({
      dates: { resume_passed: dateAfter(8), interview_1: dateAfter(20) },
      daysSinceResumePassed: 12,
    });
  });

  it("corrects a date, and the figures follow", async () => {
    const { id } = await add();
    await set(id, "applied");
    await set(id, "resume_passed");
    await set(id, "interview_1");
    vi.setSystemTime(dayAfter(30));
    expect(await read(id)).toMatchObject({ daysSinceResumePassed: 30, daysSinceFirstInterview: 30 });

    await correct(id, "resume_passed", dateAfter(10));
    const corrected = (await (await correct(id, "interview_1", dateAfter(14))).json()) as Detail;
    expect(corrected).toMatchObject({
      dates: { resume_passed: dateAfter(10), interview_1: dateAfter(14) },
      daysSinceResumePassed: 20,
      daysSinceFirstInterview: 16,
    });
    // The day the job was added is a date like the others.
    expect((await (await correct(id, "not_applied", "2026-02-20")).json() as Detail).dates.not_applied).toBe("2026-02-20");
    expect((await list()).items[0]).toMatchObject({ daysSinceResumePassed: 20, daysSinceFirstInterview: 16 });
  });

  it("refuses a date that is not a day, is in the future, or is for a step not reached", async () => {
    const { id } = await add();
    await set(id, "applied");

    expect((await correct(id, "applied", "2026-02-30")).status).toBe(422);
    expect((await correct(id, "applied", "next week")).status).toBe(422);
    expect((await correct(id, "applied", dateAfter(1))).status).toBe(422);
    expect((await correct(id, "offer", dateAfter(0))).status).toBe(409);
    expect((await correct(id, "rejected", dateAfter(0))).status).toBe(409);
    expect((await correct(id, "promoted", dateAfter(0))).status).toBe(404);
    expect((await set(id, "promoted")).status).toBe(422);
    expect((await read(id)).dates).toEqual({ not_applied: dateAfter(0), applied: dateAfter(0) });
  });

  it("drops the dates of later steps when it is moved back", async () => {
    const { id } = await add();
    for (const step of ["applied", "resume_passed", "interview_1", "interview_2"]) await set(id, step);
    vi.setSystemTime(dayAfter(5));
    const back = (await (await set(id, "resume_passed")).json()) as Detail;

    expect(back.step).toBe("resume_passed");
    expect(back.dates).toEqual({ not_applied: dateAfter(0), applied: dateAfter(0), resume_passed: dateAfter(5) });
    expect(back.daysSinceFirstInterview).toBeNull();

    // All the way back keeps the day the job was added.
    const start = (await (await set(id, "not_applied")).json()) as Detail;
    expect(start.dates).toEqual({ not_applied: dateAfter(0) });
  });

  it("closes it where it stands, refuses to move it while closed, and reopens it at the same step", async () => {
    const { id } = await add();
    await set(id, "applied");
    vi.setSystemTime(dayAfter(6));
    const closed = (await (await set(id, "rejected")).json()) as Detail;
    expect(closed).toMatchObject({
      step: "applied",
      closedAs: "rejected",
      dates: { applied: dateAfter(0), rejected: dateAfter(6) },
      daysSinceClosed: 0,
    });

    expect((await set(id, "resume_passed")).status).toBe(409);
    expect((await set(id, "withdrawn")).status).toBe(409);
    // The day it closed is correctable like any other.
    expect((await (await correct(id, "rejected", dateAfter(4))).json() as Detail).daysSinceClosed).toBe(2);

    const reopened = await client.post(`/api/applications/${id}/reopen`);
    expect(await reopened.json()).toMatchObject({
      step: "applied",
      closedAs: null,
      dates: { not_applied: dateAfter(0), applied: dateAfter(0) },
      daysSinceClosed: null,
    });
    expect((await client.post(`/api/applications/${id}/reopen`)).status).toBe(409);
  });

  it("undoes a change by putting back the standing from before it", async () => {
    const { id } = await add();
    await set(id, "applied");
    await correct(id, "applied", "2026-02-27");
    const before = await read(id);
    vi.setSystemTime(dayAfter(3));
    await set(id, "interview_2");
    await set(id, "withdrawn");

    const undone = await client.put(`/api/applications/${id}/standing`, {
      step: before.step,
      closedAs: before.closedAs,
      dates: before.dates,
    });
    expect(undone.status).toBe(200);
    expect(await undone.json()).toMatchObject({ step: "applied", closedAs: null, dates: before.dates });
  });

  it("refuses to put back a standing no change could have left", async () => {
    const { id } = await add();
    const today = dateAfter(0);
    for (const standing of [
      // A date on a step ahead of the one it is at.
      { step: "applied", closedAs: null, dates: { not_applied: today, applied: today, offer: today } },
      // The step it is at with no date.
      { step: "applied", closedAs: null, dates: { not_applied: today } },
      // No day it was added.
      { step: "applied", closedAs: null, dates: { applied: today } },
      // Closed with no date, and a closing date while open.
      { step: "applied", closedAs: "rejected", dates: { not_applied: today, applied: today } },
      { step: "applied", closedAs: null, dates: { not_applied: today, applied: today, withdrawn: today } },
      { step: "applied", closedAs: null, dates: { not_applied: today, applied: dateAfter(1) } },
    ]) {
      const response = await client.put(`/api/applications/${id}/standing`, standing);
      expect(response.status, JSON.stringify(standing)).toBe(422);
    }
    expect((await client.put(`/api/applications/${id}/standing`, { step: "rejected", closedAs: null, dates: {} })).status).toBe(422);
    expect(await read(id)).toMatchObject({ step: "not_applied", dates: { not_applied: today } });
  });

  it("keeps every date it ever held: a correction and a step moved back from are superseded, not deleted", async () => {
    const { id } = await add();
    await set(id, "applied");
    await correct(id, "applied", "2026-02-27");
    await set(id, "resume_passed");
    await set(id, "applied");

    const backup = (await client.json<{
      applications: { id: string; currentStep: string }[];
      applicationSteps: { applicationId: string; status: string; happenedOn: string; supersededAt: string | null }[];
    }>("/api/export"));
    expect(backup.applications).toMatchObject([{ id, currentStep: "applied" }]);
    const rows = backup.applicationSteps.filter((row) => row.applicationId === id);
    const held = (status: string, live: boolean) =>
      rows.filter((row) => row.status === status && (row.supersededAt === null) === live).map((row) => row.happenedOn).sort();

    expect(held("applied", true)).toEqual([dateAfter(0)]);
    expect(held("applied", false)).toEqual(["2026-02-27", dateAfter(0)]);
    expect(held("resume_passed", true)).toEqual([]);
    expect(held("resume_passed", false)).toEqual([dateAfter(0)]);
  });
});

describe("gone quiet", () => {
  it("appears at 14 days with no change, and not at 13", async () => {
    const { id } = await add();
    await set(id, "applied");

    vi.setSystemTime(dayAfter(13));
    expect(await read(id)).toMatchObject({ quietDays: null, daysSinceLastActivity: 13 });
    expect((await list()).items[0]!.quietDays).toBeNull();

    vi.setSystemTime(dayAfter(14));
    expect(await read(id)).toMatchObject({ quietDays: 14, daysSinceLastActivity: 14 });
    expect((await list()).items[0]!.quietDays).toBe(14);

    vi.setSystemTime(dayAfter(40));
    expect((await read(id)).quietDays).toBe(40);
  });

  it("applies only while waiting to hear back", async () => {
    const steps = ["not_applied", "applied", "resume_passed", "interview_1", "interview_2", "interview_final", "offer"];
    const made: Record<string, string> = {};
    for (const step of steps) {
      const { id } = await add({ ...JOB, company: `Vellum ${step}` });
      if (step !== "not_applied") await set(id, step);
      made[step] = id;
    }
    const rejected = (await add({ ...JOB, company: "Vellum rejected" })).id;
    await set(rejected, "applied");
    await set(rejected, "rejected");
    const withdrawn = (await add({ ...JOB, company: "Vellum withdrawn" })).id;
    await set(withdrawn, "interview_1");
    await set(withdrawn, "withdrawn");

    vi.setSystemTime(dayAfter(30));
    const quiet = new Map((await list()).items.map((row) => [row.id, row.quietDays]));
    for (const step of ["applied", "resume_passed", "interview_1", "interview_2", "interview_final"]) {
      expect(quiet.get(made[step]!), step).toBe(30);
    }
    for (const id of [made.not_applied!, made.offer!, rejected, withdrawn]) expect(quiet.get(id)).toBeNull();

    // Reopened, it is waiting again, and reopening it is itself a change.
    await client.post(`/api/applications/${rejected}/reopen`);
    expect((await read(rejected)).quietDays).toBeNull();
    vi.setSystemTime(dayAfter(44));
    expect((await read(rejected)).quietDays).toBe(14);
  });

  it("counts from the last change the author made, not from the date a step carries", async () => {
    const { id } = await add();
    vi.setSystemTime(dayAfter(30));
    await set(id, "applied");
    // Entered today for something that happened four weeks ago.
    await correct(id, "applied", dateAfter(2));
    expect(await read(id)).toMatchObject({ quietDays: null, daysSinceLastActivity: 0 });

    vi.setSystemTime(dayAfter(44));
    expect((await read(id)).quietDays).toBe(14);
    // A corrected date is a change, and so is a status.
    await correct(id, "applied", dateAfter(3));
    expect((await read(id)).quietDays).toBeNull();
    vi.setSystemTime(dayAfter(58));
    expect((await read(id)).quietDays).toBe(14);
    await set(id, "resume_passed");
    expect((await read(id)).quietDays).toBeNull();
  });

  it("is not reset by correcting the company or the position", async () => {
    const { id } = await add();
    await set(id, "applied");
    vi.setSystemTime(dayAfter(20));
    const before = await read(id);

    await client.patch(`/api/applications/${id}`, { position: "Staff Backend Engineer" });
    expect(await read(id)).toMatchObject({ quietDays: 20, lastActivityAt: before.lastActivityAt });
  });
});

describe("the list", () => {
  it("is ordered by newest activity first", async () => {
    const first = await add({ ...JOB, company: "Alder Quay" });
    vi.setSystemTime(dayAfter(1));
    const second = await add({ ...JOB, company: "Birch Mole" });
    vi.setSystemTime(dayAfter(2));
    const third = await add({ ...JOB, company: "Cedar Wharf" });
    expect((await list()).items.map((row) => row.id)).toEqual([third.id, second.id, first.id]);

    vi.setSystemTime(dayAfter(3));
    await set(first.id, "applied");
    expect((await list()).items.map((row) => row.id)).toEqual([first.id, third.id, second.id]);

    // An old date on a step does not send it down the list: the change is what is new.
    vi.setSystemTime(dayAfter(4));
    await correct(second.id, "not_applied", "2026-01-05");
    expect((await list()).items.map((row) => row.id)).toEqual([second.id, first.id, third.id]);
  });
});

describe("a tailored résumé carried over", () => {
  it("is an application at Not applied, with its job description and its résumé inside it", async () => {
    const user = await seedAllowedUser();
    const mine = app.as(user);
    await mine.put("/api/profile", PROFILE_FIXTURE);
    const carried = await seedTailoredResume(user, "Kestrel, platform engineer", POSTING);

    const body = await list(mine);
    expect(body.items).toMatchObject([
      {
        id: carried.applicationId,
        company: "Kestrel, platform engineer",
        position: "",
        step: "not_applied",
        resume: { title: "Résumé for Kestrel, platform engineer", versionNo: null },
      },
    ]);

    const one = await read(carried.applicationId, mine);
    expect(one).toMatchObject({
      jobDescription: POSTING,
      resume: { id: carried.id, ref: carried.id, status: "never_generated" },
      canGenerate: false,
    });
    // It is the document it was: every render route still answers by its id.
    expect((await mine.get(`/api/renders/${carried.id}/versions`)).status).toBe(200);
    // And the routes of the screen it replaces are gone.
    expect((await mine.get("/api/tailored-resumes")).status).toBe(404);
  });
});

describe("another user's applications", () => {
  it("are not listed, and every route addressed by one's id is a 404 that changes nothing", async () => {
    const mine = await add();
    await set(mine.id, "applied");
    const before = await read(mine.id);
    const other = app.as(await seedAllowedUser(SECOND_EMAIL));
    await add({ company: "Stranger Shipping", position: "Purser", jobDescription: "Purser on the night ferry." }, other);

    expect((await list(other)).items.map((row) => row.company)).toEqual(["Stranger Shipping"]);
    expect((await list()).items.map((row) => row.company)).toEqual(["Vellum Tideworks"]);

    const today = dateAfter(0);
    for (const [method, path, body] of [
      ["GET", `/api/applications/${mine.id}`, undefined],
      ["PATCH", `/api/applications/${mine.id}`, { company: "Taken" }],
      ["POST", `/api/applications/${mine.id}/steps`, { status: "offer" }],
      ["POST", `/api/applications/${mine.id}/steps`, { status: "withdrawn" }],
      ["PATCH", `/api/applications/${mine.id}/steps/applied`, { date: "2026-01-01" }],
      ["POST", `/api/applications/${mine.id}/reopen`, undefined],
      ["PUT", `/api/applications/${mine.id}/standing`, { step: "not_applied", closedAs: null, dates: { not_applied: today } }],
    ] as [string, string, unknown][]) {
      const response = await other.request(path, {
        method,
        ...(body ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}),
      });
      expect(response.status, `${method} ${path}`).toBe(404);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe("not_found");
    }

    expect(await read(mine.id)).toEqual(before);
    expect(JSON.stringify(await other.json("/api/export"))).not.toContain("Vellum");
  });
});
