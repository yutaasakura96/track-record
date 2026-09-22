/**
 * Screen 7, Skills (S9, `docs/10-screen-specifications.md`).
 *
 * Every change on this screen is one write, `PUT /api/skills/curation`, and it
 * carries the whole list. What matters is that the list sent is the list the
 * author made (the right group, the right order, an emptied group dropped),
 * that a group added here writes nothing until its first skill arrives, that a
 * refusal is shown in the panel where the change was made and the screen
 * re-reads what is stored, and that a write which never reached the server
 * says so. All fixtures are invented.
 */
import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { SkillCuration, SkillCurationInput } from "~/client/api";
import { mount, Refusal, type Call, type Routes } from "./harness";

const UNREACHABLE = () => {
  throw new TypeError("Failed to fetch");
};
const NOT_REACHED = "The server could not be reached. Try again.";
const PUT = "PUT /api/skills/curation";

const skill = (name: string, factCount = 2) => ({ name, factCount, certificationCount: 0, stale: false });

const STORED: SkillCuration = {
  groups: [
    { name: "Qorvane stack", skills: [skill("Plinth"), skill("Quillset", 1)] },
    { name: "Zentrel tools", skills: [skill("Zentrel CLI")] },
  ],
  candidates: [
    { name: "Plinth", factCount: 2, certificationCount: 0, curated: true },
    { name: "Quillset", factCount: 1, certificationCount: 0, curated: true },
    { name: "Zentrel CLI", factCount: 2, certificationCount: 0, curated: true },
    { name: "Vorbit", factCount: 3, certificationCount: 0, curated: false },
  ],
};

/** What the server answers a save with: the list it was sent, stored. */
const stored = (call: Call): SkillCuration => {
  const groups = (call.body as { groups: SkillCurationInput }).groups;
  return {
    groups: groups.map((g) => ({ name: g.name, skills: g.skills.map((s) => skill(s)) })),
    candidates: STORED.candidates.map((c) => ({
      ...c,
      curated: groups.some((g) => g.skills.includes(c.name)),
    })),
  };
};

const open = (routes: Routes = {}, curation: SkillCuration = STORED) =>
  mount("/skills", {
    "GET /api/skills/curation": curation,
    "GET /api/imports/summary": { openCandidates: 0, running: false },
    ...routes,
  });

const panel = async (heading: string) =>
  (await screen.findByRole("heading", { name: heading, level: 2 })).closest("section")!;

const group = async (name: string) => screen.findByRole("region", { name });

const sent = (api: ReturnType<typeof open>["api"]) =>
  (api.bodyOf("PUT", "/api/skills/curation") as { groups: SkillCurationInput }).groups;

const readsOfCuration = (api: ReturnType<typeof open>["api"]) =>
  api.calls.filter((c) => c.method === "GET" && c.path === "/api/skills/curation").length;

/* ------------------------------------------------------------------ writes */

describe("changing the curated list", () => {
  it("adds a candidate to the end of the group chosen", async () => {
    const { api, user } = open({ [PUT]: stored });
    await user.selectOptions(await screen.findByLabelText("Add Vorbit to"), "Zentrel tools");

    await waitFor(() => expect(api.writes()).toEqual([PUT]));
    expect(sent(api)).toEqual([
      { name: "Qorvane stack", skills: ["Plinth", "Quillset"] },
      { name: "Zentrel tools", skills: ["Zentrel CLI", "Vorbit"] },
    ]);
  });

  it("writes nothing for a new group until its first skill arrives", async () => {
    const { api, user } = open({ [PUT]: stored });
    await group("Qorvane stack");
    const curated = await panel("Curated");
    await user.type(within(curated).getByLabelText("New group name"), "Plinthworks");
    await user.click(within(curated).getByRole("button", { name: "Add group" }));

    expect(await group("Plinthworks")).toBeTruthy();
    expect(api.writes()).toEqual([]);

    await user.selectOptions(screen.getByLabelText("Add Vorbit to"), "Plinthworks");
    await waitFor(() => expect(api.writes()).toEqual([PUT]));
    expect(sent(api)).toEqual([
      { name: "Qorvane stack", skills: ["Plinth", "Quillset"] },
      { name: "Zentrel tools", skills: ["Zentrel CLI"] },
      { name: "Plinthworks", skills: ["Vorbit"] },
    ]);
  });

  it("drops a group whose last skill is removed", async () => {
    const { api, user } = open({ [PUT]: stored });
    await user.click(within(await group("Zentrel tools")).getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(api.writes()).toEqual([PUT]));
    expect(sent(api)).toEqual([{ name: "Qorvane stack", skills: ["Plinth", "Quillset"] }]);
  });

  it("moves a skill within its group", async () => {
    const { api, user } = open({ [PUT]: stored });
    const qorvane = await group("Qorvane stack");
    await user.click(within(qorvane).getAllByRole("button", { name: "Move skill down" })[0]!);

    await waitFor(() => expect(api.writes()).toEqual([PUT]));
    expect(sent(api)[0]).toEqual({ name: "Qorvane stack", skills: ["Quillset", "Plinth"] });
  });

  it("moves a group", async () => {
    const { api, user } = open({ [PUT]: stored });
    await user.click(within(await group("Qorvane stack")).getByRole("button", { name: "Move group down" }));

    await waitFor(() => expect(api.writes()).toEqual([PUT]));
    expect(sent(api).map((g) => g.name)).toEqual(["Zentrel tools", "Qorvane stack"]);
  });

  it("renames a group when the name field loses focus, and not for an unchanged name", async () => {
    const { api } = open({ [PUT]: stored });
    const name = within(await group("Zentrel tools")).getByLabelText("Group name");

    fireEvent.blur(name);
    expect(api.writes()).toEqual([]);

    fireEvent.change(name, { target: { value: "Zentrel utilities" } });
    fireEvent.blur(name);
    await waitFor(() => expect(api.writes()).toEqual([PUT]));
    expect(sent(api)[1]).toEqual({ name: "Zentrel utilities", skills: ["Zentrel CLI"] });
  });
});

/* ---------------------------------------------------------------- failures */

describe("a change that is not saved", () => {
  it("shows the server's refusal in the panel where the change was made, and re-reads", async () => {
    const { api } = open({
      [PUT]: new Refusal(422, "validation_failed", "Two groups share a name.", { fields: ["groups"] }),
    });
    const name = within(await group("Zentrel tools")).getByLabelText("Group name");
    fireEvent.change(name, { target: { value: "Qorvane stack" } });
    fireEvent.blur(name);

    const alert = await within(await panel("Curated")).findByRole("alert");
    expect(alert.textContent).toBe("That change was not saved. Two groups share a name.");
    expect(within(await panel("Candidates")).queryByRole("alert")).toBeNull();
    await waitFor(() => expect(readsOfCuration(api)).toBe(2));
  });

  it("says so when the server could not be reached", async () => {
    const { api, user } = open({ [PUT]: UNREACHABLE });
    await user.selectOptions(await screen.findByLabelText("Add Vorbit to"), "Zentrel tools");

    const alert = await within(await panel("Candidates")).findByRole("alert");
    expect(alert.textContent).toBe(`That change was not saved. ${NOT_REACHED}`);
    expect(api.writes()).toEqual([PUT]);
  });
});

describe("a list that could not be read", () => {
  it("says so rather than loading forever", async () => {
    open({ "GET /api/skills/curation": UNREACHABLE });

    expect((await screen.findByRole("alert")).textContent).toBe(NOT_REACHED);
    expect(screen.queryByText("Loading…")).toBeNull();
  });
});
