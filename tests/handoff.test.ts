/**
 * The hand-off to Suburi, from an application as the API reads it back
 * (issue #77).
 *
 * What is pinned here: the file holds the job description and nothing else;
 * the copied text holds every question of every interview entry, one a line,
 * oldest interview first; and a question taken out of an entry, or an entry
 * deleted, is not in it. Both are made from what the application read answers
 * with, so they are checked against the real routes rather than a stub.
 *
 * Every company and question here is INVENTED.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { harness, stubModel, type Client } from "./helpers/harness";
import { seedAllowedUser } from "./helpers/seed";
import type { Interview } from "~/shared/interview";
import { jobDescriptionFile, questionsAsked, questionsText } from "~/shared/handoff";

interface Detail {
  id: string;
  company: string;
  jobDescription: string;
  interviews: Interview[];
}

const JOB = {
  company: "Larkspur Freight",
  position: "Backend Engineer",
  jobDescription: "Larkspur Freight is hiring a backend engineer.\n\nYou will own the route planner.\n",
};

let client: Client;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-03-02T03:00:00.000Z"));
  client = harness(stubModel()).as(await seedAllowedUser());
});

afterEach(() => {
  vi.useRealTimers();
});

const add = async () => (await (await client.post("/api/applications", JOB)).json()) as Detail;
const read = (id: string) => client.json<Detail>(`/api/applications/${id}`);
const note = async (id: string, date: string, questions: string[]) =>
  (await (await client.post(`/api/applications/${id}/interviews`, { date, round: "other", who: "", howItWent: "", questions })).json()) as Detail;

describe("the job description file", () => {
  it("holds the job description as it was saved, and nothing else", async () => {
    const { id } = await add();
    const file = jobDescriptionFile(await read(id));

    // Saving trims the ends; the line breaks inside are kept.
    expect(file.text).toBe("Larkspur Freight is hiring a backend engineer.\n\nYou will own the route planner.");
    expect(file.name).toBe("Larkspur Freight job description.txt");
  });
});

describe("the questions asked", () => {
  it("are every question of every entry, one a line, oldest interview first", async () => {
    const { id } = await add();
    await note(id, "2026-02-20", ["Walk us through a migration you led.", "What would you change first?"]);
    await note(id, "2026-02-27", ["Why freight?"]);
    // Saved last, held earliest: the order is the interviews', not the saves'.
    await note(id, "2026-02-10", ["What is your notice period?"]);

    expect(questionsText(questionsAsked((await read(id)).interviews))).toBe(
      [
        "What is your notice period?",
        "Walk us through a migration you led.",
        "What would you change first?",
        "Why freight?",
      ].join("\n"),
    );
  });

  it("leave out a question taken out of an entry, and every question of a deleted entry", async () => {
    const { id } = await add();
    await note(id, "2026-02-20", ["Kept question one.", "Taken out of its entry.", "Kept question two."]);
    const saved = await note(id, "2026-02-27", ["On an entry that is deleted."]);
    const [deleted, corrected] = saved.interviews;

    await client.put(`/api/applications/${id}/interviews/${corrected!.id}`, {
      date: corrected!.date,
      round: corrected!.round,
      who: corrected!.who,
      howItWent: corrected!.howItWent,
      questions: corrected!.questions.filter((q) => q.text !== "Taken out of its entry.").map(({ id, text }) => ({ id, text })),
    });
    expect((await client.delete(`/api/applications/${id}/interviews/${deleted!.id}`)).status).toBe(200);

    expect(questionsText(questionsAsked((await read(id)).interviews))).toBe("Kept question one.\nKept question two.");
  });
});
