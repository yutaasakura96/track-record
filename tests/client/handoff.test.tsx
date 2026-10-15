/**
 * Practise for this job, on one application
 * (`docs/10-screen-specifications.md`, Screen 13; issue #77).
 *
 * What it can get wrong without looking wrong: a file that carries the company
 * or the requirements along with the job description; questions copied in the
 * order the page lists them, newest first, instead of oldest interview first;
 * two on one line; a request sent anywhere. Each test reads what the click
 * handed the browser.
 *
 * All fixtures are invented.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { Application } from "~/client/api";
import { figures, type Standing } from "~/shared/application";
import type { Interview } from "~/shared/interview";
import { mount } from "./harness";

const TODAY = "2026-10-10";
const ID = "app-test-wrenfield";

const STANDING: Standing = {
  step: "interview_2",
  closedAs: null,
  dates: { not_applied: "2026-09-01", applied: "2026-09-03", interview_1: "2026-09-24", interview_2: "2026-10-02" },
};

const JOB_DESCRIPTION = "Wrenfield Labs is hiring a data engineer.\n\nYou will own the nightly ingest.";

const entry = (id: string, date: string, questions: string[]): Interview => ({
  id,
  date,
  round: "other",
  who: "",
  howItWent: "",
  questions: questions.map((text, index) => ({ id: `${id}-q${index}`, text })),
  recordings: [],
});

const application = (interviews: Interview[]): Application => ({
  id: ID,
  company: "Wrenfield Labs",
  position: "Data Engineer",
  postingUrl: null,
  lastActivityAt: "2026-10-02T03:00:00.000Z",
  ...STANDING,
  ...figures(STANDING, "2026-10-02", TODAY),
  requirements: ["Postgres"],
  jobDescription: JOB_DESCRIPTION,
  documents: [],
  choices: [],
  sentCopies: [],
  canGenerate: true,
  interviews,
  today: TODAY,
});

/** Newest day first, as the server reads them back. */
const ENTRIES = [
  entry("int-test-second", "2026-10-02", ["How do you test a pipeline?"]),
  entry("int-test-first", "2026-09-24", ["Why data engineering?", "Tell us about a backfill that went wrong."]),
];

/** `userEvent.setup()` in `mount` puts in a clipboard of its own, so this one goes in after it. */
function open(interviews: Interview[] = ENTRIES) {
  const mounted = mount(`/applications/${ID}`, {
    "GET /api/applications": { items: [], today: TODAY },
    "GET /api/imports/summary": { openCandidates: 0, openFlags: 0, running: false },
    [`GET /api/applications/${ID}`]: () => application(interviews),
  });
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  return mounted;
}

const panel = async () => {
  const heading = await screen.findByRole("heading", { name: "Practise for this job" });
  return within(heading.closest("section")!);
};

let writeText: ReturnType<typeof vi.fn>;
let saved: { blob: Blob; name: string }[];

beforeEach(() => {
  writeText = vi.fn().mockResolvedValue(undefined);
  saved = [];
  let blob: Blob | null = null;
  vi.spyOn(URL, "createObjectURL").mockImplementation((value) => {
    blob = value as Blob;
    return "blob:test";
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    saved.push({ blob: blob!, name: this.download });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Download the job description (.txt)", () => {
  it("saves a text file holding the job description and nothing else", async () => {
    const { api } = open();
    const practise = await panel();
    const before = api.calls.length;
    fireEvent.click(practise.getByRole("button", { name: "Download the job description (.txt)" }));

    expect(saved).toHaveLength(1);
    expect(saved[0]!.name).toBe("Wrenfield Labs job description.txt");
    expect(saved[0]!.blob.type).toBe("text/plain;charset=utf-8");
    expect(await saved[0]!.blob.text()).toBe(JOB_DESCRIPTION);
    // Made from the page already open: nothing is sent or fetched.
    expect(api.calls.slice(before)).toEqual([]);
  });
});

describe("Copy the questions asked", () => {
  it("copies every question of every entry, one a line, oldest interview first", async () => {
    open();
    fireEvent.click((await panel()).getByRole("button", { name: "Copy the 3 questions asked" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText).toHaveBeenCalledWith(
      "Why data engineering?\nTell us about a backfill that went wrong.\nHow do you test a pipeline?",
    );
    expect(await screen.findByText("Copied the 3 questions.")).toBeTruthy();
  });

  it("says where the questions will be when no interview has any", async () => {
    open([entry("int-test-empty", "2026-09-24", [])]);
    const practise = await panel();

    expect(practise.queryByRole("button", { name: /Copy/ })).toBeNull();
    expect(practise.getByText("Questions asked show up here once an interview has some.")).toBeTruthy();
  });

  it("says so when the browser refuses the copy", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    open();
    fireEvent.click((await panel()).getByRole("button", { name: "Copy the 3 questions asked" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "The questions could not be copied. The browser did not allow it; try again.",
    );
  });
});
