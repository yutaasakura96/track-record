/**
 * Screen 4, Career timeline (`docs/10-screen-specifications.md`, S7 and S13).
 *
 * Four writes start here: creating a row, editing one, deleting one, and
 * setting which renders an entry appears in. What matters is that each write
 * names the row it was made from and sends the whole form, that a refusal the
 * server explains is shown in the server's words (a `409` names what is still
 * attached, a `422` names the fields), and that a write which never reached
 * the server says so rather than leaving the screen as if nothing happened.
 *
 * Then what the timeline reads beside the rows (issue #113): the counts from
 * `/api/career-timeline`, the 履歴書's gaps between the cards they fall
 * between, and expiry on certifications. All fixtures are invented.
 */
import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { Certification, Education, Employer, Project, RenderInclusion, Role } from "~/client/api";
import type { CareerTimeline } from "~/shared/career-timeline";
import { currentMonth } from "~/shared/calendar";
import { mount, Refusal, toneOf, type Routes } from "./harness";

const UNREACHABLE = () => {
  throw new TypeError("Failed to fetch");
};
const NOT_REACHED = "The server could not be reached. Try again.";

const QORVANE: Employer = {
  id: "emp-test-qorvane",
  nameJa: "株式会社クオーヴェイン",
  nameLatin: "Qorvane KK",
  industryJa: null, city: null,
  businessDescription: null,
  capitalYen: null,
  headcount: null,
  employmentType: "full_time",
  startedOn: "2021-04-01",
  endedOn: null,
  leavingReasonJa: null,
  sortOrder: 0,
};

const BRISTEL: Employer = {
  ...QORVANE,
  id: "emp-test-bristel",
  nameJa: "ブリステル株式会社",
  nameLatin: "Bristel Inc.",
  industryJa: "ソフトウェア",
  headcount: 140,
  employmentType: "contract",
  startedOn: "2015-04-01",
  endedOn: "2017-03-01",
  sortOrder: 1,
};

const LEAD: Role = {
  id: "role-test-lead",
  employerId: QORVANE.id,
  titleJa: null,
  titleLatin: "Platform Lead",
  shokushuJa: null,
  startedOn: "2023-04-01",
  endedOn: null,
};

const LEDGER: Project = {
  id: "proj-test-ledger",
  name: "Ledger rebuild",
  nameJa: null,
  employerId: QORVANE.id,
  summary: null,
  startedOn: "2022-01-01",
  endedOn: "2023-06-01",
  clientIsNamed: false,
};

const PROFILE = {
  id: "profile-test-1",
  nameLatin: "Rin Tamaki",
  familyNameKanji: "玉木",
  givenNameKanji: "凛",
  email: "rin@example.invalid",
  resumeHeadline: "Platform Engineer",
  resumeCity: "Sapporo",
  resumeCountry: "Japan",
};

const NO_COUNTS: CareerTimeline = { employers: [], projects: [], gaps: [] };

const open = (
  routes: Routes = {},
  employers: Employer[] = [QORVANE],
  inclusions: RenderInclusion[] = [],
  rows: { roles?: Role[]; projects?: Project[]; educations?: Education[]; certifications?: Certification[] } = {},
) =>
  mount("/record", {
    "GET /api/profile": PROFILE,
    "GET /api/employers": { items: employers },
    "GET /api/roles": { items: rows.roles ?? [] },
    "GET /api/projects": { items: rows.projects ?? [] },
    "GET /api/educations": { items: rows.educations ?? [] },
    "GET /api/certifications": { items: rows.certifications ?? [] },
    "GET /api/render-inclusions": { items: inclusions },
    "GET /api/career-timeline": NO_COUNTS,
    ...routes,
  });

const panel = async (heading: string) =>
  (await screen.findByRole("heading", { name: heading, level: 2 })).closest("section")!;

/** One employer's card on the timeline, named by its Latin name. */
const card = (name = "Qorvane KK") => screen.findByRole("article", { name });

/** The row inside a card or panel that carries `text`. */
const rowOf = async (text: string) => (await screen.findByText(text)).closest("li")!;

/**
 * Whether the save failure is reported after every field, beside Save. jsdom has
 * no layout, so document order stands in for position: the form is taller than
 * a laptop window, and a line above the fields is out of view when Save is
 * clicked.
 */
const reportedBesideSave = (form: HTMLElement, alert: HTMLElement) =>
  [...form.querySelectorAll("input, select, textarea")].every(
    (field) => field.compareDocumentPosition(alert) & Node.DOCUMENT_POSITION_FOLLOWING,
  );

/* ------------------------------------------------------------------ layout */

describe("the timeline", () => {
  it("is titled Career timeline and links to the profile form", async () => {
    open();

    await screen.findByRole("heading", { name: "Career timeline", level: 1 });
    const profile = await screen.findByRole("region", { name: "Profile" });
    expect(within(profile).getByText("Rin Tamaki")).toBeTruthy();
    expect(profile.textContent).toContain("玉木 凛");
    expect(profile.textContent).toContain("Platform Engineer · Sapporo, Japan · rin@example.invalid");
    expect(profile.textContent).toContain("Address and birth date: 履歴書 only");
    expect(within(profile).getByRole("link", { name: "Edit profile" }).getAttribute("href")).toBe("/profile");
  });

  it("lists employers newest first, each with its dates, duration, type, industry and size", async () => {
    open({}, [BRISTEL, QORVANE]);

    await card();
    const cards = screen.getAllByRole("article").map((a) => a.getAttribute("aria-label"));
    expect(cards).toEqual(["Qorvane KK", "Bristel Inc."]);
    expect((await card("Bristel Inc.")).textContent).toContain(
      "2015-04 – 2017-03 · 2 yrs · Contract · ソフトウェア · 140 people",
    );
  });

  it("files roles and projects inside their employer's card, with achievement counts", async () => {
    open(
      {
        "GET /api/career-timeline": {
          employers: [{ id: QORVANE.id, achievements: 12, unfiled: 3, documents: 2 }],
          projects: [{ id: LEDGER.id, achievements: 9 }],
          gaps: [],
        },
      },
      [QORVANE, BRISTEL],
      [],
      { roles: [LEAD], projects: [LEDGER] },
    );

    const qorvane = await card();
    await within(qorvane).findByText("From 2 imported documents");
    expect(within(qorvane).getByText("Platform Lead")).toBeTruthy();
    expect((await rowOf("Ledger rebuild")).textContent).toContain("9 achievements");
    expect(within(qorvane).getByText("Not filed under a project").closest("li")!.textContent).toContain(
      "3 achievements",
    );
    expect(within(qorvane).getByText("12 achievements")).toBeTruthy();

    const bristel = await card("Bristel Inc.");
    expect(within(bristel).queryByText("Platform Lead")).toBeNull();
    expect(within(bristel).getByText("Nothing imported yet")).toBeTruthy();
  });

  it("shows no count while the counts are being read", async () => {
    open({ "GET /api/career-timeline": () => new Promise(() => {}) }, [QORVANE], [], { projects: [LEDGER] });

    const qorvane = await card();
    await waitFor(() => expect(within(qorvane).getAllByText("In all 5 documents")).toHaveLength(2));
    expect(qorvane.textContent).not.toMatch(/\d+ achievements?|Nothing imported yet|No projects or achievements/);
  });

  it("shows the 履歴書's gap between the two cards it falls between", async () => {
    const gap = { after: "2017-03", before: "2021-04", months: 48 };
    open({ "GET /api/career-timeline": { ...NO_COUNTS, gaps: [gap] } }, [BRISTEL, QORVANE]);

    const text = await screen.findByText(
      "48 months between 2017-03 and 2021-04 are covered by no 学歴・職歴 entry. The 履歴書 will warn about it.",
    );
    const qorvane = await card();
    const bristel = await card("Bristel Inc.");
    expect(qorvane.compareDocumentPosition(text) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(text.compareDocumentPosition(bristel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(toneOf(text)).toBe("text-dim");
  });

  it("shows the 履歴書's gap when education is recorded without an employer", async () => {
    const gap = { after: "2011-03", before: "2015-04", months: 48 };
    const school: Education = {
      id: "edu-test-school", institution: "Kitamachi High School", institutionJa: null,
      faculty: null, degree: null, fieldOfStudy: null, startedOn: "2008-04-01",
      endedOn: "2011-03-01", outcome: "graduated", level: "secondary_upper",
    };
    open({ "GET /api/career-timeline": { ...NO_COUNTS, gaps: [gap] } }, [], [], {
      educations: [school, { ...school, id: "edu-test-college", institution: "Cedar College",
        startedOn: "2015-04-01", endedOn: "2019-03-01", level: "tertiary" }],
    });

    const work = await panel("Work");
    expect(within(work).getByText(/No jobs yet/)).toBeTruthy();
    expect(await within(work).findByText(
      "48 months between 2011-03 and 2015-04 are covered by no 学歴・職歴 entry. The 履歴書 will warn about it.",
    )).toBeTruthy();
  });

  it("calls out expired certifications and each education rung's render exclusions", async () => {
    open({}, [QORVANE], [], {
      certifications: [
        {
          id: "cert-test-old",
          name: "Hollow Cloud Associate",
          nameJa: null,
          issuingOrganization: "Hollow Cloud",
          issuedOn: "2019-04-01",
          expiresOn: "2022-04-01",
          credentialId: null,
          credentialUrl: null,
          technologies: [],
        },
        {
          id: "cert-test-held",
          name: "Quill Engineer",
          nameJa: null,
          issuingOrganization: "Quill Board",
          issuedOn: "2020-04-01",
          expiresOn: currentMonth(),
          credentialId: null,
          credentialUrl: null,
          technologies: [],
        },
      ],
      educations: [
        {
          id: "edu-test-high",
          institution: "Kitamachi High School",
          institutionJa: null,
          faculty: null,
          degree: null,
          fieldOfStudy: null,
          startedOn: "2008-04-01",
          endedOn: "2011-03-01",
          outcome: "graduated",
          level: "secondary_upper",
        },
        {
          id: "edu-test-middle",
          institution: "Kitamachi Middle School",
          institutionJa: null,
          faculty: null,
          degree: null,
          fieldOfStudy: null,
          startedOn: "2005-04-01",
          endedOn: "2008-03-01",
          outcome: "graduated",
          level: "secondary_lower",
        },
      ],
    });

    expect((await rowOf("Hollow Cloud Associate")).textContent).toContain("expired 2022-04");
    expect((await rowOf("Quill Engineer")).textContent).toContain("expires this month");
    expect((await rowOf("Kitamachi High School")).textContent).toContain("Left out of: Résumé (English)");
    expect((await rowOf("Kitamachi Middle School")).textContent).toContain(
      "Left out of: Résumé (English), 職務経歴書",
    );
  });
});

/* ------------------------------------------------------------------ create */

describe("adding a job", () => {
  const POST = "POST /api/employers";

  async function fillAndSave(user: ReturnType<typeof open>["user"]) {
    const work = await panel("Work");
    await user.click(within(work).getByRole("button", { name: "Add a job" }));
    const form = work.querySelector("form")!;
    await user.type(within(form).getByLabelText("会社名 · Employer name"), "株式会社ゼントレル");
    await user.selectOptions(within(form).getByLabelText("雇用形態 · Employment type"), "contract");
    fireEvent.change(within(form).getByLabelText("入社 · Started"), { target: { value: "2019-10" } });
    await user.click(within(form).getByRole("button", { name: "Save" }));
    return { work, form };
  }

  it("sends the whole row, the day pinned to 01, and closes the form", async () => {
    const { api, user } = open({ [POST]: { id: "emp-test-zentrel" } }, []);
    const { work } = await fillAndSave(user);

    await waitFor(() => expect(work.querySelector("form")).toBeNull());
    expect(api.writes()).toEqual([POST]);
    expect(api.bodyOf("POST", "/api/employers")).toEqual({
      nameJa: "株式会社ゼントレル",
      nameLatin: null,
      employmentType: "contract",
      industryJa: null, city: null,
      startedOn: "2019-10-01",
      endedOn: null,
      capitalYen: null,
      headcount: null,
      businessDescription: null,
      leavingReasonJa: null,
    });
    expect(within(work).queryByRole("alert")).toBeNull();
  });

  it("names the refused fields in the server's words and keeps the form open", async () => {
    const { api, user } = open(
      { [POST]: new Refusal(422, "validation_failed", "The end month is before the start month.", { fields: ["endedOn"] }) },
      [],
    );
    const { form } = await fillAndSave(user);

    const alert = await within(form).findByRole("alert");
    expect(toneOf(alert)).toBe("removed");
    expect(alert.textContent).toBe("The end month is before the start month. Nothing was saved.");
    expect(reportedBesideSave(form, alert)).toBe(true);
    expect(within(form).getByLabelText(/退職 · Ended/).getAttribute("aria-invalid")).toBe("true");
    expect(within(form).getByLabelText("入社 · Started").getAttribute("aria-invalid")).toBe("false");
    expect(api.writes()).toEqual([POST]);
  });

  it("says the server could not be reached and keeps the form open", async () => {
    const { api, user } = open({ [POST]: UNREACHABLE }, []);
    const { work, form } = await fillAndSave(user);

    const alert = await within(form).findByRole("alert");
    expect(alert.textContent).toBe(`${NOT_REACHED} Nothing was saved.`);
    expect(reportedBesideSave(form, alert)).toBe(true);
    expect(work.querySelector("form")).toBe(form);
    expect(within(form).getByLabelText("会社名 · Employer name")).toHaveProperty("value", "株式会社ゼントレル");
    expect(api.writes()).toEqual([POST]);
  });
});

describe("adding inside a card", () => {
  it("starts a role under the employer whose card it was added from", async () => {
    const POST = "POST /api/roles";
    const { api, user } = open({ [POST]: { id: "role-test-new" } }, [QORVANE, BRISTEL]);
    const bristel = await card("Bristel Inc.");

    await user.click(within(bristel).getByRole("button", { name: "Add a role" }));
    const form = bristel.querySelector("form")!;
    expect(within(form).getByLabelText("Employer")).toHaveProperty("value", BRISTEL.id);
    await user.type(within(form).getByLabelText(/^Title/), "Analyst");
    fireEvent.change(within(form).getByLabelText("Started"), { target: { value: "2015-04" } });
    await user.click(within(form).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(bristel.querySelector("form")).toBeNull());
    expect(api.bodyOf("POST", "/api/roles")).toMatchObject({
      employerId: BRISTEL.id,
      titleLatin: "Analyst",
      startedOn: "2015-04-01",
    });
  });

  it("starts a project under the employer whose card it was added from", async () => {
    const POST = "POST /api/projects";
    const { api, user } = open({ [POST]: { id: "proj-test-new" } });
    const qorvane = await card();

    await user.click(within(qorvane).getByRole("button", { name: "Add a project" }));
    const form = qorvane.querySelector("form")!;
    await user.type(within(form).getByLabelText("Project name"), "Search revamp");
    await user.click(within(form).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(api.writes()).toEqual([POST]));
    expect(api.bodyOf("POST", "/api/projects")).toMatchObject({ name: "Search revamp", employerId: QORVANE.id });
  });

  it("adds an independent project with no employer", async () => {
    const POST = "POST /api/projects";
    const { api, user } = open({ [POST]: { id: "proj-test-new" } });
    const independent = await panel("Independent projects");

    await user.click(within(independent).getByRole("button", { name: "Add a project" }));
    const form = independent.querySelector("form")!;
    await user.type(within(form).getByLabelText("Project name"), "Typeface tool");
    await user.click(within(form).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(api.writes()).toEqual([POST]));
    expect(api.bodyOf("POST", "/api/projects")).toMatchObject({ name: "Typeface tool", employerId: null });
  });
});

/* --------------------------------------------------------- required choices */

describe("a new row's required choices", () => {
  // The first option is not an answer: a row saved without the select ever
  // being touched must carry nothing, which the server refuses, rather than a
  // value nobody chose. A withdrawal saved as 卒業 is the case that matters.
  it.each([
    ["Work", "Add a job", "雇用形態 · Employment type", "POST /api/employers", "employmentType"],
    ["Education", "Add education", "Outcome", "POST /api/educations", "outcome"],
  ])("%s: %s starts unchosen and is sent as nothing when left alone", async (heading, add, label, POST, name) => {
    const { api, user } = open({
      [POST]: new Refusal(422, "validation_failed", "A choice is missing.", { fields: [name] }),
    });
    const section = await panel(heading);
    await user.click(within(section).getByRole("button", { name: add }));
    const form = section.querySelector("form")!;

    expect(within(form).getByLabelText(label)).toHaveProperty("value", "");
    await user.click(within(form).getByRole("button", { name: "Save" }));

    await within(form).findByRole("alert");
    const [path] = POST.split(" ").slice(1);
    expect((api.bodyOf("POST", path!) as Record<string, unknown>)[name]).toBeNull();
  });

  it("does not call an education's end month optional", async () => {
    const { user } = open();
    const section = await panel("Education");
    await user.click(within(section).getByRole("button", { name: "Add education" }));
    const form = section.querySelector("form")!;

    const ended = [...form.querySelectorAll("label")].find((l) => l.textContent!.startsWith("卒業・修了・中退 · Ended"))!;
    expect(ended.textContent).not.toMatch(/optional/);
    expect(ended.textContent).toMatch(/Required unless the outcome is 卒業見込\./);
  });
});

/* -------------------------------------------------------------------- edit */

describe("editing an employer", () => {
  const PATCH = "PATCH /api/employers/emp-test-qorvane";

  it("sends the row it was opened from, with the stored values it did not change", async () => {
    const { api, user } = open({ [PATCH]: { id: QORVANE.id } });
    const qorvane = await card();

    await user.click(within(qorvane).getByRole("button", { name: "Edit Qorvane KK" }));
    const form = qorvane.querySelector("form")!;
    const industry = within(form).getByLabelText(/業種 · Industry/);
    await user.type(industry, "情報通信業");
    await user.click(within(form).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(qorvane.querySelector("form")).toBeNull());
    expect(api.writes()).toEqual([PATCH]);
    expect(api.bodyOf("PATCH", "/api/employers/emp-test-qorvane")).toMatchObject({
      nameJa: QORVANE.nameJa,
      nameLatin: "Qorvane KK",
      employmentType: "full_time",
      industryJa: "情報通信業",
      startedOn: "2021-04-01",
      endedOn: null,
    });
  });

  it("says the server could not be reached and keeps the edit open", async () => {
    const { api, user } = open({ [PATCH]: UNREACHABLE });
    const qorvane = await card();

    await user.click(within(qorvane).getByRole("button", { name: "Edit Qorvane KK" }));
    const form = qorvane.querySelector("form")!;
    await user.click(within(form).getByRole("button", { name: "Save" }));

    const alert = await within(form).findByRole("alert");
    expect(alert.textContent).toBe(`${NOT_REACHED} Nothing was saved.`);
    expect(reportedBesideSave(form, alert)).toBe(true);
    expect(qorvane.querySelector("form")).toBe(form);
    expect(api.writes()).toEqual([PATCH]);
  });

  it("writes nothing on Cancel", async () => {
    const { api, user } = open();
    const qorvane = await card();

    await user.click(within(qorvane).getByRole("button", { name: "Edit Qorvane KK" }));
    await user.click(within(qorvane).getByRole("button", { name: "Cancel" }));

    expect(qorvane.querySelector("form")).toBeNull();
    expect(api.writes()).toEqual([]);
  });

  it("edits a role from its own row", async () => {
    const PATCH_ROLE = "PATCH /api/roles/role-test-lead";
    const { api, user } = open({ [PATCH_ROLE]: { id: LEAD.id } }, [QORVANE], [], { roles: [LEAD] });
    const qorvane = await card();

    await user.click(within(qorvane).getByRole("button", { name: "Edit Platform Lead" }));
    const form = qorvane.querySelector("form")!;
    expect(within(form).getByLabelText(/^Title/)).toHaveProperty("value", "Platform Lead");
    await user.click(within(form).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(api.writes()).toEqual([PATCH_ROLE]));
    expect(api.bodyOf("PATCH", "/api/roles/role-test-lead")).toMatchObject({ employerId: QORVANE.id, startedOn: "2023-04-01" });
  });
});

/* ------------------------------------------------------------------ delete */

describe("deleting an employer", () => {
  const DELETE = "DELETE /api/employers/emp-test-qorvane";

  it("deletes the card it was clicked on", async () => {
    const { api, user } = open({ [DELETE]: undefined });
    const qorvane = await card();

    await user.click(within(qorvane).getByRole("button", { name: "Delete Qorvane KK" }));

    await waitFor(() => expect(api.writes()).toEqual([DELETE]));
    expect(within(qorvane).queryByRole("alert")).toBeNull();
  });

  it("shows the counts refusal in the server's words, in the card", async () => {
    const message = "This employer has 3 facts and 1 role attached. Reassign them before deleting.";
    const { api, user } = open({
      [DELETE]: new Refusal(409, "conflict", message, { facts: 3, roles: 1, projects: 0 }),
    });
    const qorvane = await card();

    await user.click(within(qorvane).getByRole("button", { name: "Delete Qorvane KK" }));

    const alert = await within(qorvane).findByRole("alert");
    expect(toneOf(alert)).toBe("text-secondary");
    expect(alert.textContent).toBe(message);
    expect(api.writes()).toEqual([DELETE]);
  });

  it("says the server could not be reached", async () => {
    const { api, user } = open({ [DELETE]: UNREACHABLE });
    const qorvane = await card();

    await user.click(within(qorvane).getByRole("button", { name: "Delete Qorvane KK" }));

    const alert = await within(qorvane).findByRole("alert");
    expect(alert.textContent).toBe(NOT_REACHED);
    expect(api.writes()).toEqual([DELETE]);
  });

  it("clears the refusal when the next delete is tried", async () => {
    let answer: unknown = new Refusal(409, "conflict", "This employer has 1 fact attached. Reassign them before deleting.");
    const { user } = open({ [DELETE]: () => answer });
    const qorvane = await card();

    await user.click(within(qorvane).getByRole("button", { name: "Delete Qorvane KK" }));
    await within(qorvane).findByRole("alert");

    answer = undefined;
    await user.click(within(qorvane).getByRole("button", { name: "Delete Qorvane KK" }));

    await waitFor(() => expect(within(qorvane).queryByRole("alert")).toBeNull());
  });
});

describe("deleting inside a card", () => {
  it("shows a project's refusal in its employer's card", async () => {
    const DELETE = "DELETE /api/projects/proj-test-ledger";
    const message = "This project has 9 facts attached. Reassign them before deleting.";
    const { api, user } = open({ [DELETE]: new Refusal(409, "conflict", message) }, [QORVANE], [], {
      projects: [LEDGER],
    });
    const qorvane = await card();

    await user.click(within(qorvane).getByRole("button", { name: "Delete Ledger rebuild" }));

    expect((await within(qorvane).findByRole("alert")).textContent).toBe(message);
    expect(api.writes()).toEqual([DELETE]);
  });

  it("deletes a role from its own row", async () => {
    const DELETE = "DELETE /api/roles/role-test-lead";
    const { api, user } = open({ [DELETE]: undefined }, [QORVANE], [], { roles: [LEAD] });
    const qorvane = await card();

    await user.click(within(qorvane).getByRole("button", { name: "Delete Platform Lead" }));

    await waitFor(() => expect(api.writes()).toEqual([DELETE]));
    expect(within(qorvane).queryByRole("alert")).toBeNull();
  });
});

/* -------------------------------------------------------------- appears in */

describe("choosing which renders an employer appears in", () => {
  const PUT = "PUT /api/render-inclusions";
  const CHANGE = "Change where Qorvane KK appears";

  async function popover(user: ReturnType<typeof open>["user"]) {
    const qorvane = await card();
    await user.click(await within(qorvane).findByRole("button", { name: CHANGE }));
    return { qorvane, group: within(qorvane).getByRole("group", { name: "Appears in" }) };
  }

  it("summarises the setting in one line, with the boxes closed", async () => {
    open();
    const qorvane = await card();

    await within(qorvane).findByText("In all 5 documents");
    expect(within(qorvane).getByRole("button", { name: CHANGE }).getAttribute("aria-expanded")).toBe("false");
    expect(within(qorvane).queryByRole("group", { name: "Appears in" })).toBeNull();
  });

  it("unchecks one render for the card it belongs to", async () => {
    const { api, user } = open({
      [PUT]: { entityType: "employer", entityId: QORVANE.id, kind: "rirekisho", included: false },
    });
    const { qorvane, group } = await popover(user);

    await user.click(within(group).getByRole("checkbox", { name: "履歴書" }));

    await waitFor(() => expect(api.writes()).toEqual([PUT]));
    expect(api.bodyOf("PUT", "/api/render-inclusions")).toEqual({
      entityType: "employer",
      entityId: QORVANE.id,
      kind: "rirekisho",
      included: false,
    });
    expect(within(qorvane).queryByRole("alert")).toBeNull();
  });

  it("names an excluded render in the line and reads it unchecked", async () => {
    const { user } = open({}, [QORVANE], [
      { entityType: "employer", entityId: QORVANE.id, kind: "rirekisho", included: false },
    ]);
    const { qorvane, group } = await popover(user);

    expect(within(qorvane).getByText("Left out of: 履歴書")).toBeTruthy();
    expect(within(group).getByRole("checkbox", { name: "履歴書" })).toHaveProperty("checked", false);
    expect(within(group).getByRole("checkbox", { name: "Résumé (English)" })).toHaveProperty("checked", true);
  });

  it("lists every excluded document when only one remains included", async () => {
    open({}, [QORVANE], [
      "english_resume", "shokumu_keirekisho", "career_story_en", "career_story_ja",
    ].map((kind) => ({
      entityType: "employer", entityId: QORVANE.id, kind, included: false,
    })) as RenderInclusion[]);

    const qorvane = await card();
    expect(await within(qorvane).findByText(
      "Left out of: Résumé (English), 職務経歴書, Career story (English), 職務経歴ストーリー",
    )).toBeTruthy();
  });

  it("closes on Escape and returns focus to Change", async () => {
    const { user } = open();
    const { qorvane } = await popover(user);
    const change = within(qorvane).getByRole("button", { name: CHANGE });
    expect(change.getAttribute("aria-expanded")).toBe("true");

    await user.keyboard("{Escape}");

    expect(within(qorvane).queryByRole("group", { name: "Appears in" })).toBeNull();
    expect(document.activeElement).toBe(change);
  });

  it("says the setting was not saved, in the server's words", async () => {
    const { user } = open({ [PUT]: new Refusal(404, "not_found", "That employer no longer exists.") });
    const { qorvane, group } = await popover(user);

    await user.click(within(group).getByRole("checkbox", { name: "履歴書" }));

    const alert = await within(qorvane).findByRole("alert");
    expect(toneOf(alert)).toBe("removed");
    expect(alert.textContent).toBe("That setting was not saved. That employer no longer exists.");
  });

  it("says the setting was not saved because the server could not be reached", async () => {
    const { user } = open({ [PUT]: UNREACHABLE });
    const { qorvane, group } = await popover(user);

    await user.click(within(group).getByRole("checkbox", { name: "履歴書" }));

    const alert = await within(qorvane).findByRole("alert");
    expect(alert.textContent).toBe(`That setting was not saved. ${NOT_REACHED}`);
    expect(within(group).getByRole("checkbox", { name: "履歴書" })).toHaveProperty("checked", true);
  });
});
