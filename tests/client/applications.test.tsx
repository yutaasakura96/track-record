/**
 * Applications: the list, one application, and Add a job
 * (`docs/10-screen-specifications.md`, issue #70).
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
import { mount, Refusal, type Call, type Routes } from "./harness";

const TODAY = "2026-10-10";
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
  jobDescription: "Senior backend engineer for the fernhill warehouse fleet.",
  resume: null,
  canGenerate: true,
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
  resume: null,
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
        resume: { title: "Résumé for Kestrel, platform engineer", versionNo: 2 },
      }),
    ]);
    const kestrel = within(await screen.findByRole("link", { name: "Open Kestrel, platform engineer" }));
    expect(kestrel.getByText("Position not filled in")).toBeTruthy();
    expect(kestrel.getByText("Résumé for Kestrel, platform engineer v2, not sent")).toBeTruthy();
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
  const open = (routes: Routes = {}) =>
    mount("/applications/new", { "GET /api/applications": { items: [], today: TODAY }, ...SUMMARY, ...routes });

  async function fill(user: ReturnType<typeof mount>["user"]) {
    await user.type(await screen.findByLabelText("Company"), "Fernhill Robotics");
    await user.type(screen.getByLabelText("Position"), "Senior Backend Engineer");
    await user.type(screen.getByLabelText("Job description"), "Senior backend engineer for the fernhill warehouse fleet.");
  }

  it("saves what was typed and opens the application it made", async () => {
    const made = application(at("not_applied", { not_applied: TODAY }), TODAY);
    const { api, user, pathname } = open({ [CREATE]: made, [`GET ${AT}`]: made });
    await fill(user);
    await user.type(screen.getByLabelText("Link to the posting, if you have one"), "https://jobs.example.invalid/fernhill");
    await user.click(screen.getByRole("button", { name: "Save application" }));

    await waitFor(() => expect(pathname()).toBe(`/applications/${ID}`));
    expect(api.writes()).toEqual([CREATE]);
    expect(api.bodyOf("POST", "/api/applications")).toEqual({
      company: "Fernhill Robotics",
      position: "Senior Backend Engineer",
      postingUrl: "https://jobs.example.invalid/fernhill",
      requirements: [],
      jobDescription: "Senior backend engineer for the fernhill warehouse fleet.",
    });
    expect(await screen.findByRole("button", { name: "Move to Applied" })).toBeTruthy();
  });

  it("writes nothing until it has a company, a position and a job description", async () => {
    const { api, user } = open();
    await user.type(await screen.findByLabelText("Company"), "Fernhill Robotics");
    await user.click(screen.getByRole("button", { name: "Save application" }));
    expect(api.writes()).toEqual([]);
  });

  it("keeps what was typed and shows the server's words when it is refused", async () => {
    const { user, pathname } = open({
      [CREATE]: new Refusal(422, "validation_failed", "A link to the posting must start with http:// or https://."),
    });
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Save application" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "A link to the posting must start with http:// or https://.",
    );
    expect(pathname()).toBe("/applications/new");
    expect((screen.getByLabelText("Company") as HTMLInputElement).value).toBe("Fernhill Robotics");
  });
});
