/**
 * Applications: the list, one application, and Add a job
 * (`docs/10-screen-specifications.md`, issues #70 and #73).
 *
 * What a screen here can get wrong without looking wrong: a step set on the
 * wrong application, a date sent for the wrong status, an Undo that puts back
 * less or more than the change it undoes, and a filter that hides a row it
 * should not. Each test states the writes a click made and what they carried.
 *
 * The stubbed server answers with the same rules the real one uses
 * (`~/shared/application`), so a figure on screen is one a real answer could
 * hold. All fixtures are invented.
 */
import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { Application, ApplicationRow } from "~/client/api";
import { close, figures, moveTo, reopen, setDate, type Standing } from "~/shared/application";
import { mount, Refusal, toneOf, type Call, type Routes } from "./harness";

const TODAY = "2026-10-10";
const POSTING = "Senior backend engineer for the fernhill warehouse fleet.";
const ID = "app-test-fernhill";
const AT = `/api/applications/${ID}`;

/** At the second interview, last changed eight days ago. */
const FERNHILL: Standing = {
  step: "interview_2",
  closedAs: null,
  dates: {
    not_applied: "2026-09-01",
    applied: "2026-09-03",
    resume_passed: "2026-09-12",
    interview_1: "2026-09-24",
    interview_2: "2026-10-02",
  },
};

const application = (standing: Standing, lastActivityOn: string, over: Partial<Application> = {}): Application => ({
  id: ID,
  company: "Fernhill Robotics",
  position: "Senior Backend Engineer",
  postingUrl: "https://jobs.example.invalid/fernhill",
  lastActivityAt: `${lastActivityOn}T03:00:00.000Z`,
  ...standing,
  ...figures(standing, lastActivityOn, TODAY),
  requirements: ["Idempotent APIs and event streams"],
  jobDescription: POSTING,
  documents: [],
  choices: [],
  sentCopies: [],
  canGenerate: true,
  interviews: [],
  today: TODAY,
  ...over,
});

const row = (
  id: string,
  company: string,
  standing: Standing,
  lastActivityOn: string,
  over: Partial<ApplicationRow> = {},
): ApplicationRow => ({
  id,
  company,
  position: "Platform Engineer",
  postingUrl: null,
  lastActivityAt: `${lastActivityOn}T03:00:00.000Z`,
  ...standing,
  ...figures(standing, lastActivityOn, TODAY),
  resume: { documents: [], sent: false },
  ...over,
});

const at = (step: Standing["step"], dates: Standing["dates"], closedAs: Standing["closedAs"] = null): Standing => ({
  step,
  closedAs,
  dates,
});

/** Newest activity first, as the server orders them. */
const ROWS: ApplicationRow[] = [
  row("app-test-lumen", "Lumen Health", at("not_applied", { not_applied: "2026-10-09" }), "2026-10-09"),
  row(ID, "Fernhill Robotics", FERNHILL, "2026-10-02"),
  row(
    "app-test-bracken",
    "Brackenridge Mobility",
    at("applied", { not_applied: "2026-09-18", applied: "2026-09-20" }),
    "2026-09-20",
  ),
  row(
    "app-test-marlowe",
    "Marlowe Insurance",
    at(
      "resume_passed",
      { not_applied: "2026-08-20", applied: "2026-08-22", resume_passed: "2026-09-01", rejected: "2026-09-19" },
      "rejected",
    ),
    "2026-09-19",
  ),
];

const SUMMARY = { "GET /api/imports/summary": { openCandidates: 0, openFlags: 0, running: false } };

const openList = (items: ApplicationRow[] = ROWS) =>
  mount("/applications", { "GET /api/applications": { items, today: TODAY }, ...SUMMARY });

/**
 * One application behind a server that keeps its standing: each write answers
 * with the application as the rules leave it, changed today.
 */
function openOne(start: Standing = FERNHILL, lastActivityOn = "2026-10-02", routes: Routes = {}) {
  let standing = start;
  let changedOn = lastActivityOn;
  const answer = (next: Standing) => {
    standing = next;
    changedOn = TODAY;
    return application(standing, changedOn);
  };
  return mount(`/applications/${ID}`, {
    "GET /api/applications": { items: [], today: TODAY },
    [`GET ${AT}`]: () => application(standing, changedOn),
    [`POST ${AT}/steps`]: ({ body }: Call) => {
      const { status } = body as { status: Standing["step"] | "rejected" | "withdrawn" };
      return answer(
        status === "rejected" || status === "withdrawn" ? close(standing, status, TODAY) : moveTo(standing, status, TODAY),
      );
    },
    [`PATCH ${AT}/steps/interview_1`]: ({ body }: Call) =>
      answer(setDate(standing, "interview_1", (body as { date: string }).date)),
    [`PATCH ${AT}/steps/applied`]: ({ body }: Call) => answer(setDate(standing, "applied", (body as { date: string }).date)),
    [`POST ${AT}/reopen`]: () => answer(reopen(standing)),
    [`PUT ${AT}/standing`]: ({ body }: Call) => answer(body as Standing),
    ...SUMMARY,
    ...routes,
  });
}

/** The figure card whose caption starts with `caption`, as text. */
const figure = (caption: string) => screen.getByText(new RegExp(`^${caption}`)).parentElement!.textContent;

describe("the list of applications", () => {
  it("shows every application in the order the server gives, with its status and what it is waiting on", async () => {
    openList();
    const rows = await screen.findAllByRole("link", { name: /^Open / });
    expect(rows.map((link) => link.getAttribute("aria-label"))).toEqual([
      "Open Lumen Health",
      "Open Fernhill Robotics",
      "Open Brackenridge Mobility",
      "Open Marlowe Insurance",
    ]);

    const fernhill = within(rows[1]!);
    expect(fernhill.getByText("Second interview")).toBeTruthy();
    expect(fernhill.getByText("28 days since the résumé passed")).toBeTruthy();
    expect(fernhill.getByText("16 days since the first interview")).toBeTruthy();
    expect(fernhill.getByText("Last change 8 days ago")).toBeTruthy();

    // Waiting for twenty days: marked, in words and a count.
    expect(within(rows[2]!).getByText("Gone quiet · 20 days")).toBeTruthy();
    // Closed for twenty-one, and a closed application is never quiet. Its figures are not counted on.
    const marlowe = within(rows[3]!);
    expect(marlowe.getByText("Rejected")).toBeTruthy();
    expect(marlowe.queryByText(/Gone quiet/)).toBeNull();
    expect(marlowe.queryByText(/since the résumé passed/)).toBeNull();
  });

  it("counts the gone-quiet applications in the sidebar and in the line that says what to do", async () => {
    openList();
    const nav = within(await screen.findByRole("navigation"));
    expect((await nav.findByRole("link", { name: /Applications/ })).textContent).toContain("1 gone quiet");
    expect(screen.getByText(/1 application has gone quiet\. Follow up/)).toBeTruthy();
  });

  it("narrows to one status, with the three interview steps as one filter", async () => {
    const { user } = openList();
    await user.click(await screen.findByRole("button", { name: "Interviews 1" }));
    expect(screen.getAllByRole("link", { name: /^Open / }).map((link) => link.getAttribute("aria-label"))).toEqual([
      "Open Fernhill Robotics",
    ]);

    await user.click(screen.getByRole("button", { name: "Rejected 1" }));
    expect(screen.getAllByRole("link", { name: /^Open / }).map((link) => link.getAttribute("aria-label"))).toEqual([
      "Open Marlowe Insurance",
    ]);
  });

  it("narrows to the ones gone quiet, on top of a status, and offers the way back when nothing matches", async () => {
    const { user } = openList();
    await user.click(await screen.findByRole("button", { name: "Gone quiet 1" }));
    expect(screen.getAllByRole("link", { name: /^Open / }).map((link) => link.getAttribute("aria-label"))).toEqual([
      "Open Brackenridge Mobility",
    ]);

    await user.click(screen.getByRole("button", { name: "Interviews 1" }));
    expect(screen.queryByRole("link", { name: /^Open / })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Show all" }));
    expect(screen.getAllByRole("link", { name: /^Open / })).toHaveLength(4);
  });

  it("says a carried-over application has no position yet, and names its résumé", async () => {
    openList([
      row("app-test-kestrel", "Kestrel, platform engineer", at("not_applied", { not_applied: "2026-10-07" }), "2026-10-07", {
        position: "",
        resume: { documents: [{ title: "Tailored résumé for Kestrel, platform engineer", versionNo: 2 }], sent: false },
      }),
    ]);
    const kestrel = within(await screen.findByRole("link", { name: "Open Kestrel, platform engineer" }));
    expect(kestrel.getByText("Position not filled in")).toBeTruthy();
    expect(kestrel.getByText("Tailored résumé for Kestrel, platform engineer v2, not sent")).toBeTruthy();
  });

  it("opens an application from its row", async () => {
    const { user, pathname } = openList();
    await user.click(await screen.findByRole("link", { name: "Open Fernhill Robotics" }));
    await waitFor(() => expect(pathname()).toBe(`/applications/${ID}`));
  });

  it("offers only Add a job while there are none", async () => {
    openList([]);
    expect(await screen.findByRole("heading", { name: "No applications yet" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^All/ })).toBeNull();
    expect(screen.getAllByRole("link", { name: "Add a job" }).every((link) => link.getAttribute("href") === "/applications/new")).toBe(true);
  });

  it("is where the old Tailored résumés address leads", async () => {
    const { pathname } = mount("/tailored", { "GET /api/applications": { items: ROWS, today: TODAY }, ...SUMMARY });
    await screen.findByRole("link", { name: "Open Fernhill Robotics" });
    expect(pathname()).toBe("/applications");
  });
});

describe("where an application stands", () => {
  it("shows a date under each step reached, none after it, and the three figures", async () => {
    openOne();
    expect(await screen.findByRole("button", { name: "Second interview, 2026-10-02. Correct this date" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Not applied, 2026-09-01. Correct this date" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Final interview, / })).toBeNull();
    expect(figure("since the résumé passed")).toBe("28 dayssince the résumé passed");
    expect(figure("since the first interview")).toBe("16 dayssince the first interview");
    expect(figure("since the last change")).toBe("8 dayssince the last change. Gone quiet at 14");
  });

  it("moves to the next step with one write, and says the date it saved", async () => {
    const { api, user } = openOne();
    await user.click(await screen.findByRole("button", { name: "Move to Final interview" }));

    const said = await screen.findByText(/Moved to Final interview\./);
    expect(said.textContent).toBe(`Moved to Final interview. Date saved as ${TODAY}.`);
    expect(api.writes()).toEqual([`POST ${AT}/steps`]);
    expect(api.bodyOf("POST", `${AT}/steps`)).toEqual({ status: "interview_final" });
    expect(screen.getByRole("button", { name: `Final interview, ${TODAY}. Correct this date` })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Move to Offer" })).toBeTruthy();
  });

  it("undoes a move by putting back the standing from before it", async () => {
    const { api, user } = openOne();
    await user.click(await screen.findByRole("button", { name: "Move to Final interview" }));
    await user.click(await screen.findByRole("button", { name: "Undo" }));

    await screen.findByRole("button", { name: "Move to Final interview" });
    expect(api.writes()).toEqual([`POST ${AT}/steps`, `PUT ${AT}/standing`]);
    expect(api.bodyOf("PUT", `${AT}/standing`)).toEqual(FERNHILL);
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("says what an Undo froze, after its confirmation, and only then", async () => {
    const applied = at("applied", { not_applied: "2026-09-18", applied: "2026-09-20" });
    const { user } = openOne(applied, "2026-09-20", {
      [`PUT ${AT}/standing`]: ({ body }: Call) =>
        application(body as Standing, TODAY, { frozen: [{ title: "職務経歴書", versionNo: 3 }] }),
    });
    await user.selectOptions(await screen.findByLabelText("Set another step"), "not_applied");
    await user.click(await screen.findByRole("button", { name: "Undo" }));

    expect(await screen.findByText("Undone. 職務経歴書 v3 was frozen as sent.")).toBeTruthy();
  });

  it("says only that it was undone when the Undo froze nothing", async () => {
    const { user } = openOne();
    await user.click(await screen.findByRole("button", { name: "Move to Final interview" }));
    await user.click(await screen.findByRole("button", { name: "Undo" }));

    expect(await screen.findByText("Undone.")).toBeTruthy();
  });

  it("corrects a date with one write naming that step, and the figure follows", async () => {
    const { api, user } = openOne();
    await user.click(await screen.findByRole("button", { name: "First interview, 2026-09-24. Correct this date" }));
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-09-20" } });
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("button", { name: "First interview, 2026-09-20. Correct this date" })).toBeTruthy();
    expect(api.writes()).toEqual([`PATCH ${AT}/steps/interview_1`]);
    expect(api.bodyOf("PATCH", `${AT}/steps/interview_1`)).toEqual({ date: "2026-09-20" });
    expect(figure("since the first interview")).toBe("20 dayssince the first interview");
  });

  it("closes the date it was shown without a write when Save is pressed on the same day", async () => {
    const { api, user } = openOne();
    await user.click(await screen.findByRole("button", { name: "First interview, 2026-09-24. Correct this date" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("button", { name: "First interview, 2026-09-24. Correct this date" })).toBeTruthy();
    expect(screen.queryByLabelText("Date")).toBeNull();
    expect(screen.queryByText(/Date corrected/)).toBeNull();
    expect(api.writes()).toEqual([]);
  });

  it("keeps a date corrected after a move when the move is undone", async () => {
    const { api, user } = openOne();
    await user.click(await screen.findByRole("button", { name: "Move to Final interview" }));
    await user.click(await screen.findByRole("button", { name: "First interview, 2026-09-24. Correct this date" }));
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-09-20" } });
    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("button", { name: "First interview, 2026-09-20. Correct this date" });
    await user.click(screen.getByRole("button", { name: "Undo" }));

    await screen.findByRole("button", { name: "Move to Final interview" });
    expect(api.bodyOf("PUT", `${AT}/standing`)).toEqual({
      ...FERNHILL,
      dates: { ...FERNHILL.dates, interview_1: "2026-09-20" },
    });
  });

  it("leaves a step passed over without a date, and takes one when it is added", async () => {
    const { api, user } = openOne(at("not_applied", { not_applied: "2026-10-01" }), "2026-10-01");
    await user.selectOptions(await screen.findByLabelText("Set another step"), "First interview");

    await screen.findByText(/Moved to First interview\./);
    expect(api.bodyOf("POST", `${AT}/steps`)).toEqual({ status: "interview_1" });
    expect(screen.getAllByText("skipped")).toHaveLength(2);
    expect(figure("since the résumé passed")).toBe("–since the résumé passed: not reached, or no date");

    await user.click(screen.getAllByRole("button", { name: "add a date" })[0]!);
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-10-03" } });
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("button", { name: "Applied, 2026-10-03. Correct this date" })).toBeTruthy();
    expect(api.bodyOf("PATCH", `${AT}/steps/applied`)).toEqual({ date: "2026-10-03" });
    expect(screen.getAllByText("skipped")).toHaveLength(1);
  });

  it("closes it where it stands, offers no further step, and reopens at the same step", async () => {
    const { api, user } = openOne();
    await user.click(await screen.findByRole("button", { name: "Mark as rejected" }));

    expect(await screen.findByText(/after Second interview\./)).toBeTruthy();
    expect(api.bodyOf("POST", `${AT}/steps`)).toEqual({ status: "rejected" });
    expect(screen.queryByRole("button", { name: /^Move to/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Withdraw" })).toBeNull();
    expect(figure("since it was closed")).toBe("0 dayssince it was closed");

    await user.click(screen.getByRole("button", { name: "Reopen" }));
    expect(await screen.findByRole("button", { name: "Move to Final interview" })).toBeTruthy();
    expect(api.writes()).toEqual([`POST ${AT}/steps`, `POST ${AT}/reopen`]);
  });

  it("says it has gone quiet, and for how long", async () => {
    openOne(at("applied", { not_applied: "2026-09-18", applied: "2026-09-20" }), "2026-09-20");
    expect(await screen.findByText("Gone quiet · 20 days")).toBeTruthy();
    expect(screen.getByText(/nothing has changed for 20 days\. Follow up/)).toBeTruthy();
  });

  it("shows the server's words when a change is refused, and changes nothing", async () => {
    const { user } = openOne(FERNHILL, "2026-10-02", {
      [`POST ${AT}/steps`]: new Refusal(409, "conflict", "This application is closed. Reopen it first."),
    });
    await user.click(await screen.findByRole("button", { name: "Move to Final interview" }));

    expect((await screen.findByRole("alert")).textContent).toBe("This application is closed. Reopen it first.");
    expect(screen.getByRole("button", { name: "Move to Final interview" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("says so when there is no such application", async () => {
    mount("/applications/app-test-absent", { "GET /api/applications": { items: [], today: TODAY }, ...SUMMARY });
    expect(await screen.findByText("That application was not found.")).toBeTruthy();
  });
});

describe("the job an application is for", () => {
  it("corrects the company, position, link and requirements with one write", async () => {
    const { api, user } = openOne(FERNHILL, "2026-10-02", {
      [`PATCH ${AT}`]: ({ body }: Call) => application(FERNHILL, "2026-10-02", body as Partial<Application>),
    });
    await user.click(await screen.findByRole("button", { name: "Edit" }));
    const position = screen.getByLabelText("Position");
    await user.clear(position);
    await user.type(position, "Staff Backend Engineer");
    await user.click(screen.getByRole("button", { name: "Add a requirement" }));
    await user.type(screen.getByLabelText("Requirement 2"), "Mentors other engineers");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(api.writes()).toEqual([`PATCH ${AT}`]));
    expect(api.bodyOf("PATCH", AT)).toEqual({
      company: "Fernhill Robotics",
      position: "Staff Backend Engineer",
      postingUrl: "https://jobs.example.invalid/fernhill",
      requirements: ["Idempotent APIs and event streams", "Mentors other engineers"],
    });
    expect(await screen.findByText("Staff Backend Engineer", { selector: "dd" })).toBeTruthy();
  });

  it("asks for the position on an application carried over from a tailored résumé", async () => {
    mount(`/applications/${ID}`, {
      "GET /api/applications": { items: [], today: TODAY },
      [`GET ${AT}`]: application(at("not_applied", { not_applied: "2026-10-07" }), "2026-10-07", { position: "" }),
      ...SUMMARY,
    });
    expect(await screen.findByText(/add the position, and check that the company is right/)).toBeTruthy();
    expect(screen.getByText("Position not filled in")).toBeTruthy();
  });
});

describe("adding a job", () => {
  const CREATE = "POST /api/applications";
  const READ = "POST /api/applications/read-posting";
  const LINK = "Link to the posting, if you have one";
  const READING = {
    company: "Fernhill Robotics",
    position: "Senior Backend Engineer",
    requirements: ["Idempotent APIs and event streams", "Has run a warehouse cutover"],
  };
  const NOTHING = { company: "", position: "", requirements: [] };
  const open = (routes: Routes = {}) =>
    mount("/applications/new", { "GET /api/applications": { items: [], today: TODAY }, ...SUMMARY, ...routes });

  const value = (label: string) => (screen.getByLabelText(label) as HTMLInputElement).value;

  /** Pastes the posting and presses `Read it`. */
  async function readIt(user: ReturnType<typeof mount>["user"], text = POSTING) {
    await user.click(await screen.findByLabelText("Job description"));
    await user.paste(text);
    await user.click(screen.getByRole("button", { name: "Read it" }));
  }

  it("reads the pasted text and shows what was read to check, having saved nothing", async () => {
    const { api, user } = open({ [READ]: READING });
    expect(await screen.findByText(/you check them before anything is saved/)).toBeTruthy();
    await user.type(await screen.findByLabelText(LINK), "https://jobs.example.invalid/fernhill");
    await readIt(user);

    expect(await screen.findByRole("heading", { name: "Check what was read" })).toBeTruthy();
    expect(value("Company")).toBe("Fernhill Robotics");
    expect(value("Position")).toBe("Senior Backend Engineer");
    expect(value("Requirement 1")).toBe("Idempotent APIs and event streams");
    expect(value("Requirement 2")).toBe("Has run a warehouse cutover");
    expect(screen.getByText("Link: https://jobs.example.invalid/fernhill")).toBeTruthy();
    expect(screen.getByText(/check the three fields, then save the application/)).toBeTruthy();
    // The text and nothing else is sent to be read: the link is only stored.
    expect(api.writes()).toEqual([READ]);
    expect(api.bodyOf("POST", "/api/applications/read-posting")).toEqual({ jobDescription: POSTING });
  });

  it("saves what the author corrected, not what was read, and opens the application it made", async () => {
    const made = application(at("not_applied", { not_applied: TODAY }), TODAY);
    const { api, user, pathname } = open({ [READ]: READING, [CREATE]: made, [`GET ${AT}`]: made });
    await user.type(await screen.findByLabelText(LINK), "https://jobs.example.invalid/fernhill");
    await readIt(user);

    const position = await screen.findByLabelText("Position");
    await user.clear(position);
    await user.type(position, "Staff Backend Engineer");
    await user.click(screen.getAllByRole("button", { name: "Remove" })[0]!);
    await user.click(screen.getByRole("button", { name: "Add a requirement" }));
    await user.type(screen.getByLabelText("Requirement 2"), "On call one week in six");
    await user.click(screen.getByRole("button", { name: "Add a requirement" }));
    await user.click(screen.getByRole("button", { name: "Save application" }));

    await waitFor(() => expect(pathname()).toBe(`/applications/${ID}`));
    expect(api.writes()).toEqual([READ, CREATE]);
    expect(api.bodyOf("POST", "/api/applications")).toEqual({
      company: "Fernhill Robotics",
      position: "Staff Backend Engineer",
      postingUrl: "https://jobs.example.invalid/fernhill",
      // The last one was added and left empty; the server drops it.
      requirements: ["Has run a warehouse cutover", "On call one week in six", ""],
      jobDescription: POSTING,
    });
    expect(await screen.findByRole("button", { name: "Move to Applied" })).toBeTruthy();
  });

  it("says it is reading, and holds the text still while it does", async () => {
    let answer: (value: unknown) => void = () => {};
    const { api, user } = open({ [READ]: () => new Promise((resolve) => (answer = resolve)) });
    await readIt(user);

    expect((await screen.findByRole("status")).textContent).toBe(
      "Reading the job description. This takes a few seconds.",
    );
    expect((screen.getByLabelText("Job description") as HTMLTextAreaElement).readOnly).toBe(true);
    expect((screen.getByLabelText(LINK) as HTMLInputElement).readOnly).toBe(true);
    expect(screen.queryByRole("button", { name: "Read it" })).toBeNull();

    // Enter in the link field submits the form again; one reading is in flight at a time.
    fireEvent.submit(screen.getByLabelText(LINK).closest("form")!);

    answer(READING);
    expect(await screen.findByRole("heading", { name: "Check what was read" })).toBeTruthy();
    expect(api.writes()).toEqual([READ]);
  });

  it("opens the fields empty to type in when the reading fails, and saves what is typed", async () => {
    const made = application(at("not_applied", { not_applied: TODAY }), TODAY);
    const { api, user, pathname } = open({
      [READ]: new Refusal(503, "upstream_unavailable", "The job description could not be read just now."),
      [CREATE]: made,
      [`GET ${AT}`]: made,
    });
    await readIt(user);

    expect((await screen.findByRole("status")).textContent).toBe(
      "The job description could not be read just now. Type the fields in; your text is kept.",
    );
    expect(value("Company")).toBe("");
    expect(screen.getByText(/None found\. Add the ones that matter to you/)).toBeTruthy();
    await user.type(screen.getByLabelText("Company"), "Fernhill Robotics");
    await user.type(screen.getByLabelText("Position"), "Senior Backend Engineer");
    await user.click(screen.getByRole("button", { name: "Save application" }));

    await waitFor(() => expect(pathname()).toBe(`/applications/${ID}`));
    expect(api.bodyOf("POST", "/api/applications")).toEqual({
      company: "Fernhill Robotics",
      position: "Senior Backend Engineer",
      postingUrl: "",
      requirements: [],
      jobDescription: POSTING,
    });
  });

  it("opens the fields empty when the server cannot be reached at all", async () => {
    const { user } = open({
      [READ]: () => {
        throw new TypeError("Failed to fetch");
      },
    });
    await readIt(user);
    expect(await screen.findByText(/could not be read just now\. Type the fields in; your text is kept/)).toBeTruthy();
    expect(value("Position")).toBe("");
  });

  it("says so when the company and the position were not found, and asks for them before saving", async () => {
    const { api, user } = open({ [READ]: NOTHING });
    await readIt(user);

    expect(await screen.findByText(/the company and the position could not be found in the text/)).toBeTruthy();
    expect((screen.getByLabelText("Company") as HTMLInputElement).placeholder).toBe("Not found in the text. Type it in.");
    expect(screen.queryByText(/could not be read just now/)).toBeNull();

    await user.click(screen.getByRole("button", { name: "Save application" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Give it a company and a position first.");
    expect(toneOf(alert)).toBe("removed");
    expect(api.writes()).toEqual([READ]);
  });

  it("names the one that was not found when the other was", async () => {
    const { user } = open({ [READ]: { ...READING, position: "" } });
    await readIt(user);
    expect(await screen.findByText(/the position could not be found in the text\. Type it in, then save/)).toBeTruthy();
  });

  it("reads nothing from text that is missing, too short or too long, and says which", async () => {
    const { api, user } = open({ [READ]: READING });
    await user.click(await screen.findByRole("button", { name: "Read it" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Paste the job description first. A few lines is enough.");

    // The refusal is about the text as it was: typing takes it down.
    await user.type(screen.getByLabelText("Job description"), "B");
    expect(screen.queryByRole("alert")).toBeNull();
    await readIt(user, "ackend engineer.");
    expect(screen.getByRole("alert").textContent).toBe("Paste the job description first. A few lines is enough.");

    await user.click(screen.getByLabelText("Job description"));
    await user.paste("x".repeat(20_010));
    await user.click(screen.getByRole("button", { name: "Read it" }));
    expect(screen.getByRole("alert").textContent).toBe(
      "A job description can be at most 20,000 characters. This one is 20,027.",
    );
    expect(api.writes()).toEqual([]);
  });

  it("refuses a link that is not a web address before anything is read", async () => {
    const { api, user } = open({ [READ]: READING });
    await user.type(await screen.findByLabelText(LINK), "jobs.example.invalid/fernhill");
    await readIt(user);
    expect((await screen.findByRole("alert")).textContent).toBe("A link to the posting starts with https://");
    expect(api.writes()).toEqual([]);
  });

  it("goes back to the text with it kept, and reads it again over what was corrected", async () => {
    const { api, user } = open({ [READ]: READING });
    await readIt(user);
    const company = await screen.findByLabelText("Company");
    await user.clear(company);
    await user.type(company, "Fernhill Robotics K.K.");

    await user.click(screen.getByRole("button", { name: "Back to the text" }));
    expect(((await screen.findByLabelText("Job description")) as HTMLTextAreaElement).value).toBe(POSTING);
    await user.click(screen.getByRole("button", { name: "Read it" }));

    expect(((await screen.findByLabelText("Company")) as HTMLInputElement).value).toBe("Fernhill Robotics");
    expect(api.writes()).toEqual([READ, READ]);
  });

  it("empties the fields of an earlier reading when a later one fails", async () => {
    const answers: unknown[] = [
      READING,
      new Refusal(503, "upstream_unavailable", "The job description could not be read just now."),
    ];
    const { user } = open({ [READ]: () => answers.shift() });
    await readIt(user);
    expect(((await screen.findByLabelText("Company")) as HTMLInputElement).value).toBe("Fernhill Robotics");

    await user.click(screen.getByRole("button", { name: "Back to the text" }));
    await readIt(user, " It is based in Osaka.");

    expect(await screen.findByText(/could not be read just now\. Type the fields in; your text is kept/)).toBeTruthy();
    expect(value("Company")).toBe("");
    expect(value("Position")).toBe("");
    expect(screen.getByText(/None found\. Add the ones that matter to you/)).toBeTruthy();
    expect(screen.getByText(/type in the company and the position, then save/)).toBeTruthy();
  });

  it("reads again when the text was changed, and shows the new reading", async () => {
    const readings = [READING, { ...READING, company: "Fernhill Robotics K.K." }];
    const { api, user } = open({ [READ]: () => readings.shift() });
    await readIt(user);
    await user.click(await screen.findByRole("button", { name: "Back to the text" }));
    await readIt(user, " It is based in Osaka.");

    expect(((await screen.findByLabelText("Company")) as HTMLInputElement).value).toBe("Fernhill Robotics K.K.");
    expect(api.writes()).toEqual([READ, READ]);
  });

  it("keeps what was typed and shows the server's words when saving is refused", async () => {
    const { user, pathname } = open({
      [READ]: READING,
      [CREATE]: new Refusal(422, "validation_failed", "Keep the company under 200 characters."),
    });
    await readIt(user);
    await user.click(await screen.findByRole("button", { name: "Save application" }));

    expect((await screen.findByRole("alert")).textContent).toBe("Keep the company under 200 characters.");
    expect(pathname()).toBe("/applications/new");
    expect(value("Company")).toBe("Fernhill Robotics");
  });
});
