/**
 * Screen 4, Your record (`docs/10-screen-specifications.md`, S7 and S13).
 *
 * Four writes start here: creating a row, editing one, deleting one, and
 * setting which renders an entry appears in. What matters is that each write
 * names the row it was made from and sends the whole form, that a refusal the
 * server explains is shown in the server's words (a `409` names what is still
 * attached, a `422` names the fields), and that a write which never reached
 * the server says so rather than leaving the screen as if nothing happened.
 * All fixtures are invented.
 */
import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { Employer, RenderInclusion } from "~/client/api";
import { mount, Refusal, type Routes } from "./harness";

const UNREACHABLE = () => {
  throw new TypeError("Failed to fetch");
};
const NOT_REACHED = "The server could not be reached. Try again.";

const QORVANE: Employer = {
  id: "emp-test-qorvane",
  nameJa: "株式会社クオーヴェイン",
  nameLatin: "Qorvane KK",
  industryJa: null,
  businessDescription: null,
  capitalYen: null,
  headcount: null,
  employmentType: "full_time",
  startedOn: "2021-04-01",
  endedOn: null,
  leavingReasonJa: null,
  sortOrder: 0,
};

const open = (routes: Routes = {}, employers: Employer[] = [QORVANE], inclusions: RenderInclusion[] = []) =>
  mount("/record", {
    "GET /api/employers": { items: employers },
    "GET /api/roles": { items: [] },
    "GET /api/projects": { items: [] },
    "GET /api/educations": { items: [] },
    "GET /api/certifications": { items: [] },
    "GET /api/render-inclusions": { items: inclusions },
    ...routes,
  });

const panel = async (heading: string) =>
  (await screen.findByRole("heading", { name: heading, level: 2 })).closest("section")!;

const employerRow = async () => (await screen.findByText("株式会社クオーヴェイン · Qorvane KK")).closest("li")!;

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

/* ------------------------------------------------------------------ create */

describe("adding an employer", () => {
  const POST = "POST /api/employers";

  async function fillAndSave(user: ReturnType<typeof open>["user"]) {
    const employers = await panel("Employers");
    await user.click(within(employers).getByRole("button", { name: "Add" }));
    const form = employers.querySelector("form")!;
    await user.type(within(form).getByLabelText("会社名 · Employer name"), "株式会社ゼントレル");
    await user.selectOptions(within(form).getByLabelText("雇用形態 · Employment type"), "contract");
    fireEvent.change(within(form).getByLabelText("入社 · Started"), { target: { value: "2019-10" } });
    await user.click(within(form).getByRole("button", { name: "Save" }));
    return { employers, form };
  }

  it("sends the whole row, the day pinned to 01, and closes the form", async () => {
    const { api, user } = open({ [POST]: { id: "emp-test-zentrel" } }, []);
    const { employers } = await fillAndSave(user);

    await waitFor(() => expect(employers.querySelector("form")).toBeNull());
    expect(api.writes()).toEqual([POST]);
    expect(api.bodyOf("POST", "/api/employers")).toEqual({
      nameJa: "株式会社ゼントレル",
      nameLatin: null,
      employmentType: "contract",
      industryJa: null,
      startedOn: "2019-10-01",
      endedOn: null,
      capitalYen: null,
      headcount: null,
      businessDescription: null,
      leavingReasonJa: null,
    });
    expect(within(employers).queryByRole("alert")).toBeNull();
  });

  it("names the refused fields in the server's words and keeps the form open", async () => {
    const { api, user } = open(
      { [POST]: new Refusal(422, "validation_failed", "The end month is before the start month.", { fields: ["endedOn"] }) },
      [],
    );
    const { form } = await fillAndSave(user);

    const alert = await within(form).findByRole("alert");
    expect(alert.textContent).toBe("The end month is before the start month. Nothing was saved.");
    expect(reportedBesideSave(form, alert)).toBe(true);
    expect(within(form).getByLabelText(/退職 · Ended/).getAttribute("aria-invalid")).toBe("true");
    expect(within(form).getByLabelText("入社 · Started").getAttribute("aria-invalid")).toBe("false");
    expect(api.writes()).toEqual([POST]);
  });

  it("says the server could not be reached and keeps the form open", async () => {
    const { api, user } = open({ [POST]: UNREACHABLE }, []);
    const { employers, form } = await fillAndSave(user);

    const alert = await within(form).findByRole("alert");
    expect(alert.textContent).toBe(`${NOT_REACHED} Nothing was saved.`);
    expect(reportedBesideSave(form, alert)).toBe(true);
    expect(employers.querySelector("form")).toBe(form);
    expect(within(form).getByLabelText("会社名 · Employer name")).toHaveProperty("value", "株式会社ゼントレル");
    expect(api.writes()).toEqual([POST]);
  });

  it("offers no Add for a role until an employer exists", async () => {
    open({}, []);
    const roles = await panel("Roles");

    const add = within(roles).getByRole("button", { name: "Add" });
    expect(add.getAttribute("title")).toBe("Add an employer first — a role belongs to one.");
  });
});

/* -------------------------------------------------------------------- edit */

describe("editing an employer", () => {
  const PATCH = "PATCH /api/employers/emp-test-qorvane";

  it("sends the row it was opened from, with the stored values it did not change", async () => {
    const { api, user } = open({ [PATCH]: { id: QORVANE.id } });
    const row = await employerRow();

    await user.click(within(row).getByRole("button", { name: "Edit" }));
    const form = row.querySelector("form")!;
    const industry = within(form).getByLabelText(/業種 · Industry/);
    await user.type(industry, "情報通信業");
    await user.click(within(form).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(row.querySelector("form")).toBeNull());
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
    const row = await employerRow();

    await user.click(within(row).getByRole("button", { name: "Edit" }));
    const form = row.querySelector("form")!;
    await user.click(within(form).getByRole("button", { name: "Save" }));

    const alert = await within(form).findByRole("alert");
    expect(alert.textContent).toBe(`${NOT_REACHED} Nothing was saved.`);
    expect(reportedBesideSave(form, alert)).toBe(true);
    expect(row.querySelector("form")).toBe(form);
    expect(api.writes()).toEqual([PATCH]);
  });

  it("writes nothing on Cancel", async () => {
    const { api, user } = open();
    const row = await employerRow();

    await user.click(within(row).getByRole("button", { name: "Edit" }));
    await user.click(within(row).getByRole("button", { name: "Cancel" }));

    expect(row.querySelector("form")).toBeNull();
    expect(api.writes()).toEqual([]);
  });
});

/* ------------------------------------------------------------------ delete */

describe("deleting an employer", () => {
  const DELETE = "DELETE /api/employers/emp-test-qorvane";

  it("deletes the row it was clicked on", async () => {
    const { api, user } = open({ [DELETE]: undefined });
    const row = await employerRow();

    await user.click(within(row).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(api.writes()).toEqual([DELETE]));
    expect(within(await panel("Employers")).queryByRole("alert")).toBeNull();
  });

  it("shows the counts refusal in the server's words", async () => {
    const message = "This employer has 3 facts and 1 role attached. Reassign them before deleting.";
    const { api, user } = open({
      [DELETE]: new Refusal(409, "conflict", message, { facts: 3, roles: 1, projects: 0 }),
    });
    const row = await employerRow();

    await user.click(within(row).getByRole("button", { name: "Delete" }));

    const alert = await within(await panel("Employers")).findByRole("alert");
    expect(alert.textContent).toBe(message);
    expect(api.writes()).toEqual([DELETE]);
  });

  it("says the server could not be reached", async () => {
    const { api, user } = open({ [DELETE]: UNREACHABLE });
    const row = await employerRow();

    await user.click(within(row).getByRole("button", { name: "Delete" }));

    const alert = await within(await panel("Employers")).findByRole("alert");
    expect(alert.textContent).toBe(NOT_REACHED);
    expect(api.writes()).toEqual([DELETE]);
  });

  it("clears the refusal when the next delete is tried", async () => {
    let answer: unknown = new Refusal(409, "conflict", "This employer has 1 fact attached. Reassign them before deleting.");
    const { user } = open({ [DELETE]: () => answer });
    const row = await employerRow();

    await user.click(within(row).getByRole("button", { name: "Delete" }));
    await within(await panel("Employers")).findByRole("alert");

    answer = undefined;
    await user.click(within(row).getByRole("button", { name: "Delete" }));

    await waitFor(async () => expect(within(await panel("Employers")).queryByRole("alert")).toBeNull());
  });
});

/* -------------------------------------------------------------- appears in */

describe("choosing which renders an employer appears in", () => {
  const PUT = "PUT /api/render-inclusions";

  it("unchecks one render for the row it belongs to", async () => {
    const { api, user } = open({
      [PUT]: { entityType: "employer", entityId: QORVANE.id, kind: "rirekisho", included: false },
    });
    const group = await within(await employerRow()).findByRole("group", { name: "Appears in" });

    await user.click(within(group).getByRole("checkbox", { name: "履歴書" }));

    await waitFor(() => expect(api.writes()).toEqual([PUT]));
    expect(api.bodyOf("PUT", "/api/render-inclusions")).toEqual({
      entityType: "employer",
      entityId: QORVANE.id,
      kind: "rirekisho",
      included: false,
    });
    expect(within(group).queryByRole("alert")).toBeNull();
  });

  it("reads an excluded render as unchecked", async () => {
    open({}, [QORVANE], [{ entityType: "employer", entityId: QORVANE.id, kind: "rirekisho", included: false }]);
    const group = await within(await employerRow()).findByRole("group", { name: "Appears in" });

    expect(within(group).getByRole("checkbox", { name: "履歴書" })).toHaveProperty("checked", false);
    expect(within(group).getByRole("checkbox", { name: "Résumé (English)" })).toHaveProperty("checked", true);
  });

  it("says the setting was not saved, in the server's words", async () => {
    const { user } = open({ [PUT]: new Refusal(404, "not_found", "That employer no longer exists.") });
    const group = await within(await employerRow()).findByRole("group", { name: "Appears in" });

    await user.click(within(group).getByRole("checkbox", { name: "履歴書" }));

    const alert = await within(group).findByRole("alert");
    expect(alert.textContent).toBe("That setting was not saved. That employer no longer exists.");
  });

  it("says the setting was not saved because the server could not be reached", async () => {
    const { user } = open({ [PUT]: UNREACHABLE });
    const group = await within(await employerRow()).findByRole("group", { name: "Appears in" });

    await user.click(within(group).getByRole("checkbox", { name: "履歴書" }));

    const alert = await within(group).findByRole("alert");
    expect(alert.textContent).toBe(`That setting was not saved. ${NOT_REACHED}`);
    expect(within(group).getByRole("checkbox", { name: "履歴書" })).toHaveProperty("checked", true);
  });
});
