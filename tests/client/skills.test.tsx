/**
 * Screen 7, Skills (S9, issue #114, `docs/10-screen-specifications.md`).
 *
 * Every change on this screen is one write, `PUT /api/skills/curation`, and it
 * carries the whole list. What matters is that the list sent is the list the
 * author made (the right group, the right order, an emptied group dropped)
 * whether it was made by dragging, by the keyboard or by the bar a tap opens;
 * that a move is written once, when it is placed, and the preview follows it
 * before then; that a group added here writes nothing until its first skill
 * arrives; that a refusal is shown in the panel where the change was made and
 * the screen re-reads what is stored; and that a write which never reached the
 * server says so. All fixtures are invented.
 */
import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { CuratedSkill, SkillCandidate, SkillCuration, SkillCurationInput } from "~/client/api";
import { mount, Refusal, toneOf, type Call, type Routes } from "./harness";

const UNREACHABLE = () => {
  throw new TypeError("Failed to fetch");
};
const NOT_REACHED = "The server could not be reached. Try again.";
/** A read has a Retry beside it, so its line does not also say to try again. */
const NOT_READ = "The server could not be reached.";
const PUT = "PUT /api/skills/curation";
const GROUPS = "Your groups";
const SUGGESTIONS = "Found in your record, not listed yet";

const skill = (name: string, factCount = 2, lastUsed: CuratedSkill["lastUsed"] = 2024): CuratedSkill => ({
  name,
  factCount,
  certificationCount: 0,
  lastUsed,
  stale: false,
});

const candidate = (
  name: string,
  factCount: number,
  curated: boolean,
  suggestedGroup: string | null = null,
  lastUsed: SkillCandidate["lastUsed"] = "now",
): SkillCandidate => ({ name, factCount, certificationCount: 0, lastUsed, curated, suggestedGroup });

const STORED: SkillCuration = {
  groups: [
    { name: "Qorvane stack", nameJa: null, skills: [skill("Plinth"), skill("Quillset", 1, "now")] },
    { name: "Zentrel tools", nameJa: null, skills: [skill("Zentrel CLI")] },
  ],
  candidates: [
    candidate("Vorbit", 3, false),
    candidate("Plinth", 2, true),
    candidate("Zentrel CLI", 2, true),
    candidate("Halvane", 1, false, "Zentrel tools"),
    candidate("Quillset", 1, true),
    candidate("Ostrum", 1, false, "Qorvane stack", 2015),
  ],
  printable: ["Vorbit", "Plinth", "Zentrel CLI", "Halvane", "Quillset", "Ostrum"],
};

/** What the server answers a save with: the list it was sent, stored. */
const stored = (call: Call): SkillCuration => {
  const groups = (call.body as { groups: SkillCurationInput }).groups;
  return {
    groups: groups.map((g) => ({ name: g.name, nameJa: g.nameJa, skills: g.skills.map((s) => skill(s)) })),
    candidates: STORED.candidates.map((c) => ({
      ...c,
      curated: groups.some((g) => g.skills.includes(c.name)),
    })),
    printable: STORED.printable,
  };
};

const open = (routes: Routes = {}, curation: SkillCuration = STORED) =>
  mount("/skills", {
    "GET /api/skills/curation": curation,
    "GET /api/imports/summary": { openCandidates: 0, running: false },
    ...routes,
  });

/** A panel once the list has arrived; the loading state draws the same headings. */
const panel = async (heading: string) => {
  await screen.findByRole("region", { name: "Résumé preview" });
  return screen.getByRole("heading", { name: heading, level: 2 }).closest("section")!;
};

const group = async (name: string) => screen.findByRole("region", { name });

const chip = async (name: string) => screen.findByRole("button", { name: new RegExp(`^${name}: `) });

const preview = async () =>
  [...(await screen.findByRole("region", { name: "Résumé preview" })).querySelectorAll("p")].map((p) => p.textContent);

const sent = (api: ReturnType<typeof open>["api"]) =>
  (api.bodyOf("PUT", "/api/skills/curation") as { groups: SkillCurationInput }).groups;

const readsOfCuration = (api: ReturnType<typeof open>["api"]) =>
  api.calls.filter((c) => c.method === "GET" && c.path === "/api/skills/curation").length;

/** A drag the way a browser sends one: start on the chip, over the target, drop on it. */
function drag(from: HTMLElement, to: HTMLElement) {
  const dataTransfer = { setData: () => {}, effectAllowed: "", dropEffect: "" };
  fireEvent.dragStart(from, { dataTransfer });
  fireEvent.dragOver(to, { dataTransfer });
  fireEvent.drop(to, { dataTransfer });
  fireEvent.dragEnd(from, { dataTransfer });
}

/* ----------------------------------------------------------------- preview */

describe("the preview of the printed section", () => {
  it("shows the Skills section the résumé prints, a group per line in order", async () => {
    open();
    expect(await screen.findByRole("heading", { name: "How it reads on your résumé" })).toBeTruthy();
    expect(await preview()).toEqual(["Qorvane stack: Plinth, Quillset", "Zentrel tools: Zentrel CLI"]);
  });

  it("leaves out a listed skill the résumé may not name, and the chip says so", async () => {
    open({}, { ...STORED, printable: STORED.printable.filter((name) => name !== "Quillset") });
    expect(await preview()).toEqual(["Qorvane stack: Plinth", "Zentrel tools: Zentrel CLI"]);
    expect((await chip("Quillset")).getAttribute("aria-label")).toMatch(/left off the résumé$/);
  });

  it("shows the one uncurated line the résumé prints while nothing is curated", async () => {
    open({}, { ...STORED, groups: [], candidates: STORED.candidates.map((c) => ({ ...c, curated: false })) });
    expect(await preview()).toEqual(["Vorbit, Plinth, Zentrel CLI, Halvane, Quillset, Ostrum"]);
  });
});

/* -------------------------------------------------------------------- chips */

describe("a chip", () => {
  it("says how much backs it and when it was last used", async () => {
    open();
    const plinth = await chip("Plinth");
    expect(plinth.getAttribute("aria-label")).toBe("Plinth: 2 achievements, last used 2024");
    expect(plinth.textContent).toBe("Plinth2 · 2024");
    expect((await chip("Quillset")).getAttribute("aria-label")).toBe("Quillset: 1 achievement, in use now");
  });

  it("counts the certifications behind it too", async () => {
    const certified = (name: string, factCount: number, certificationCount: number, lastUsed: CuratedSkill["lastUsed"]) => ({
      ...skill(name, factCount, lastUsed),
      certificationCount,
    });
    open({}, {
      ...STORED,
      groups: [
        {
          name: "Qorvane stack",
          nameJa: null,
          skills: [certified("Plinth", 0, 2, 2023), certified("Quillset", 1, 2, "now"), certified("Vorbit", 0, 1, 2023)],
        },
      ],
    });
    expect((await chip("Plinth")).textContent).toBe("Plinth2 certs · 2023");
    expect((await chip("Plinth")).getAttribute("aria-label")).toBe("Plinth: 2 certifications, last used 2023");
    expect((await chip("Quillset")).textContent).toBe("Quillset1 + 2 certs · now");
    expect((await chip("Vorbit")).textContent).toBe("Vorbit1 cert · 2023");
  });
});

/* ------------------------------------------------------------- stale skill */

describe("a stale skill", () => {
  const WITH_STALE: SkillCuration = {
    ...STORED,
    groups: [
      { name: "Qorvane stack", nameJa: null, skills: [skill("Plinth"), { ...skill("Brennic", 0, null), stale: true }, skill("Quillset")] },
      STORED.groups[1]!,
    ],
  };

  it("is flagged amber and kept in its place, and the résumé does not print it", async () => {
    open({}, WITH_STALE);
    const brennic = await chip("Brennic");
    expect(brennic.getAttribute("aria-label")).toBe("Brennic: named by no achievement or certification any more");
    expect(brennic.textContent).toBe("Brennicin no fact");
    expect(brennic.className).toContain("text-generated-text");
    const order = within(await group("Qorvane stack"))
      .getAllByRole("button", { name: /: / })
      .map((b) => b.getAttribute("aria-label")!.split(":")[0]);
    expect(order).toEqual(["Plinth", "Brennic", "Quillset"]);
    expect(await preview()).toEqual(["Qorvane stack: Plinth, Quillset", "Zentrel tools: Zentrel CLI"]);
  });

  it("stays in the list a save sends, until it is removed", async () => {
    const { api, user } = open({ [PUT]: stored }, WITH_STALE);
    await user.click(await chip("Zentrel CLI"));
    await user.click(screen.getByRole("button", { name: "↑ Group above" }));
    await user.click(screen.getByRole("button", { name: "Place" }));

    await waitFor(() => expect(api.writes()).toEqual([PUT]));
    expect(sent(api)).toEqual([{ name: "Qorvane stack", nameJa: null, skills: ["Plinth", "Brennic", "Quillset", "Zentrel CLI"] }]);
  });
});

/* ------------------------------------------------------------- suggestions */

describe("the suggestions", () => {
  it("lists the most used first, each with the group it is named beside", async () => {
    open();
    const suggestions = within(await panel(SUGGESTIONS));
    const names = suggestions.getAllByRole("button", { name: /^Add / }).map((b) => b.getAttribute("aria-label"));
    expect(names).toEqual([
      "Add Vorbit, choosing a group: 3 achievements, in use now",
      "Add Halvane to Zentrel tools: 1 achievement, in use now",
    ]);
  });

  it("folds a skill named once and not in the last five years, and shows it on request", async () => {
    const { user } = open();
    const suggestions = within(await panel(SUGGESTIONS));
    expect(suggestions.queryByRole("button", { name: /^Add Ostrum/ })).toBeNull();
    expect(suggestions.getByText(/1 more, each named once and not in the last 5 years\./)).toBeTruthy();

    await user.click(suggestions.getByRole("button", { name: "Show them" }));
    expect(suggestions.getByRole("button", { name: /^Add Ostrum to Qorvane stack/ })).toBeTruthy();
  });

  it("adds one to its suggested group with one press", async () => {
    const { api, user } = open({ [PUT]: stored });
    await user.click(await screen.findByRole("button", { name: /^Add Halvane to Zentrel tools/ }));

    await waitFor(() => expect(api.writes()).toEqual([PUT]));
    expect(sent(api)).toEqual([
      { name: "Qorvane stack", nameJa: null, skills: ["Plinth", "Quillset"] },
      { name: "Zentrel tools", nameJa: null, skills: ["Zentrel CLI", "Halvane"] },
    ]);
  });

  it("asks which group for one with no suggestion, and adds it to the end of the one chosen", async () => {
    const { api, user } = open({ [PUT]: stored });
    await user.click(await screen.findByRole("button", { name: /^Add Vorbit, choosing a group/ }));
    const choose = screen.getByRole("group", { name: "Add Vorbit to" });
    await user.click(within(choose).getByRole("button", { name: "Qorvane stack" }));

    await waitFor(() => expect(api.writes()).toEqual([PUT]));
    expect(sent(api)[0]).toEqual({ name: "Qorvane stack", nameJa: null, skills: ["Plinth", "Quillset", "Vorbit"] });
  });
});

/* ------------------------------------------------------------------ writes */

describe("changing the list", () => {
  it("writes nothing for a new group until its first skill arrives", async () => {
    const { api, user } = open({ [PUT]: stored });
    await group("Qorvane stack");
    const groups = await panel(GROUPS);
    await user.type(within(groups).getByLabelText("New group name"), "Plinthworks");
    await user.click(within(groups).getByRole("button", { name: "Add group" }));

    expect(await group("Plinthworks")).toBeTruthy();
    expect(api.writes()).toEqual([]);

    await user.click(screen.getByRole("button", { name: /^Add Vorbit, choosing a group/ }));
    await user.click(within(screen.getByRole("group", { name: "Add Vorbit to" })).getByRole("button", { name: "Plinthworks" }));
    await waitFor(() => expect(api.writes()).toEqual([PUT]));
    expect(sent(api)).toEqual([
      { name: "Qorvane stack", nameJa: null, skills: ["Plinth", "Quillset"] },
      { name: "Zentrel tools", nameJa: null, skills: ["Zentrel CLI"] },
      { name: "Plinthworks", nameJa: null, skills: ["Vorbit"] },
    ]);
  });

  it("drops a group whose last skill is removed", async () => {
    const { api, user } = open({ [PUT]: stored });
    await user.click(await chip("Zentrel CLI"));
    await user.click(within(screen.getByRole("group", { name: "Move Zentrel CLI" })).getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(api.writes()).toEqual([PUT]));
    expect(sent(api)).toEqual([{ name: "Qorvane stack", nameJa: null, skills: ["Plinth", "Quillset"] }]);
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
    expect(sent(api)[1]).toEqual({ name: "Zentrel utilities", nameJa: null, skills: ["Zentrel CLI"] });
  });

  it("saves the group's 職務経歴書 name when its field loses focus, and clears it when blanked", async () => {
    const { api } = open({ [PUT]: stored });
    const nameJa = within(await group("Zentrel tools")).getByLabelText(/^Name in the 職務経歴書/);

    fireEvent.blur(nameJa);
    expect(api.writes()).toEqual([]);

    fireEvent.change(nameJa, { target: { value: " 開発ツール " } });
    fireEvent.blur(nameJa);
    await waitFor(() => expect(api.writes()).toEqual([PUT]));
    expect(sent(api)[1]).toEqual({ name: "Zentrel tools", nameJa: "開発ツール", skills: ["Zentrel CLI"] });

    const after = within(await group("Zentrel tools")).getByLabelText(/^Name in the 職務経歴書/) as HTMLInputElement;
    expect(after.value).toBe("開発ツール");
    fireEvent.change(after, { target: { value: "  " } });
    fireEvent.blur(after);
    await waitFor(() => expect(api.writes()).toEqual([PUT, PUT]));
    const last = api.calls.filter((c) => c.method === "PUT").at(-1)!.body as { groups: SkillCurationInput };
    expect(last.groups[1]).toEqual({ name: "Zentrel tools", nameJa: null, skills: ["Zentrel CLI"] });
  });
});

/* ---------------------------------------------------------------- keyboard */

describe("moving a skill by keyboard", () => {
  it("picks it up with Enter, moves it with the arrows, and writes once when Enter places it", async () => {
    const { api, user } = open({ [PUT]: stored });
    (await chip("Plinth")).focus();
    await user.keyboard("{Enter}");
    expect((await chip("Plinth")).getAttribute("aria-pressed")).toBe("true");

    await user.keyboard("{ArrowRight}");
    expect(api.writes()).toEqual([]);
    // The preview follows the move before anything is written.
    expect(await preview()).toEqual(["Qorvane stack: Quillset, Plinth", "Zentrel tools: Zentrel CLI"]);
    expect(document.activeElement).toBe(await chip("Plinth"));

    await user.keyboard("{Enter}");
    await waitFor(() => expect(api.writes()).toEqual([PUT]));
    expect(sent(api)[0]).toEqual({ name: "Qorvane stack", nameJa: null, skills: ["Quillset", "Plinth"] });
  });

  it("carries it to another group with the down arrow, keeping focus on it", async () => {
    const { api, user } = open({ [PUT]: stored });
    (await chip("Plinth")).focus();
    await user.keyboard("{Enter}{ArrowDown}");

    expect(document.activeElement).toBe(await chip("Plinth"));
    expect(within(await group("Zentrel tools")).getByRole("button", { name: /^Plinth: / })).toBeTruthy();
    expect(screen.getByText("Plinth: Zentrel tools, 2 of 2.")).toBeTruthy();

    await user.keyboard("{Enter}");
    await waitFor(() => expect(api.writes()).toEqual([PUT]));
    expect(sent(api)).toEqual([
      { name: "Qorvane stack", nameJa: null, skills: ["Quillset"] },
      { name: "Zentrel tools", nameJa: null, skills: ["Zentrel CLI", "Plinth"] },
    ]);
  });

  it("says when a step goes nowhere, and moves nothing", async () => {
    const { user } = open({ [PUT]: stored });
    (await chip("Plinth")).focus();
    await user.keyboard("{Enter}{ArrowLeft}{ArrowUp}");

    expect(screen.getByText("Plinth cannot move further that way. Plinth: Qorvane stack, 1 of 2.")).toBeTruthy();
  });

  it("puts it back with Escape and writes nothing", async () => {
    const { api, user } = open({ [PUT]: stored });
    (await chip("Plinth")).focus();
    await user.keyboard("{Enter}{ArrowDown}{Escape}");

    expect(within(await group("Qorvane stack")).getByRole("button", { name: /^Plinth: / })).toBeTruthy();
    expect(document.activeElement).toBe(await chip("Plinth"));
    expect((await chip("Plinth")).getAttribute("aria-pressed")).toBe("false");
    expect(await preview()).toEqual(["Qorvane stack: Plinth, Quillset", "Zentrel tools: Zentrel CLI"]);
    expect(api.writes()).toEqual([]);
  });

  it("offers the same steps as buttons, for a tap", async () => {
    const { api, user } = open({ [PUT]: stored });
    await user.click(await chip("Quillset"));
    const bar = within(screen.getByRole("group", { name: "Move Quillset" }));
    expect((bar.getByRole("button", { name: "Later →" }) as HTMLButtonElement).disabled).toBe(true);
    expect(bar.getByRole("button", { name: "Later →" }).getAttribute("title")).toBe("It is already last in its group.");

    await user.click(bar.getByRole("button", { name: "← Earlier" }));
    await user.click(bar.getByRole("button", { name: "Place" }));
    await waitFor(() => expect(api.writes()).toEqual([PUT]));
    expect(sent(api)[0]).toEqual({ name: "Qorvane stack", nameJa: null, skills: ["Quillset", "Plinth"] });
  });
});

describe("the group controls while a skill is held", () => {
  it("wait for the move, so placing it keeps the group order and names", async () => {
    const { api, user } = open({ [PUT]: stored });
    await user.click(await chip("Quillset"));

    const reason = "Place or cancel the move of Quillset first.";
    const first = within(await group("Qorvane stack"));
    const down = first.getByRole("button", { name: "Move group down" }) as HTMLButtonElement;
    expect(down.disabled).toBe(true);
    expect(down.getAttribute("title")).toBe(reason);
    expect((first.getByLabelText("Group name") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText("New group name") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Add group" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /^Add Halvane to Zentrel tools/ }) as HTMLButtonElement).disabled).toBe(
      true,
    );

    const bar = within(screen.getByRole("group", { name: "Move Quillset" }));
    await user.click(bar.getByRole("button", { name: "← Earlier" }));
    await user.click(bar.getByRole("button", { name: "Place" }));
    await waitFor(() => expect(api.writes()).toEqual([PUT]));
    expect(sent(api)).toEqual([
      { name: "Qorvane stack", nameJa: null, skills: ["Quillset", "Plinth"] },
      { name: "Zentrel tools", nameJa: null, skills: ["Zentrel CLI"] },
    ]);
    expect(down.disabled).toBe(false);
  });
});

describe("dragging while a skill is held", () => {
  it("starts no drag, so the held move is the one placed", async () => {
    const { api, user } = open({ [PUT]: stored });
    await user.click(await chip("Quillset"));
    await user.click(within(screen.getByRole("group", { name: "Move Quillset" })).getByRole("button", { name: "← Earlier" }));

    const listed = (await chip("Zentrel CLI")).closest("li")!;
    const suggested = (await screen.findByRole("button", { name: /^Add Halvane to Zentrel tools/ })).closest("li")!;
    expect(listed.getAttribute("draggable")).toBe("false");
    expect(suggested.getAttribute("draggable")).toBe("false");
    drag(listed, await group("Qorvane stack"));
    drag(suggested, await group("Qorvane stack"));
    expect(api.writes()).toEqual([]);

    await user.click(within(screen.getByRole("group", { name: "Move Quillset" })).getByRole("button", { name: "Place" }));
    await waitFor(() => expect(api.writes()).toEqual([PUT]));
    expect(sent(api)).toEqual([
      { name: "Qorvane stack", nameJa: null, skills: ["Quillset", "Plinth"] },
      { name: "Zentrel tools", nameJa: null, skills: ["Zentrel CLI"] },
    ]);
  });
});

/* -------------------------------------------------------------------- drag */

describe("dragging a skill", () => {
  it("drops a chip before the chip it lands on, in another group", async () => {
    const { api } = open({ [PUT]: stored });
    drag((await chip("Quillset")).closest("li")!, await chip("Zentrel CLI"));

    await waitFor(() => expect(api.writes()).toEqual([PUT]));
    expect(sent(api)).toEqual([
      { name: "Qorvane stack", nameJa: null, skills: ["Plinth"] },
      { name: "Zentrel tools", nameJa: null, skills: ["Quillset", "Zentrel CLI"] },
    ]);
  });

  it("adds a suggestion to the group it is dropped on, whatever was suggested", async () => {
    const { api } = open({ [PUT]: stored });
    drag(
      (await screen.findByRole("button", { name: /^Add Halvane to Zentrel tools/ })).closest("li")!,
      await group("Qorvane stack"),
    );

    await waitFor(() => expect(api.writes()).toEqual([PUT]));
    expect(sent(api)[0]).toEqual({ name: "Qorvane stack", nameJa: null, skills: ["Plinth", "Quillset", "Halvane"] });
  });

  it("puts the preview back when the chip leaves a group for somewhere it cannot land", async () => {
    const { api } = open({ [PUT]: stored });
    const from = (await chip("Plinth")).closest("li")!;
    const target = await group("Zentrel tools");
    const dataTransfer = { setData: () => {}, effectAllowed: "", dropEffect: "" };

    fireEvent.dragStart(from, { dataTransfer });
    fireEvent.dragOver(await chip("Zentrel CLI"), { dataTransfer });
    expect(await preview()).toEqual(["Qorvane stack: Quillset", "Zentrel tools: Plinth, Zentrel CLI"]);

    fireEvent.dragLeave(target, { dataTransfer, relatedTarget: document.body });
    expect(await preview()).toEqual(["Qorvane stack: Plinth, Quillset", "Zentrel tools: Zentrel CLI"]);
    expect(target.className).not.toContain("border-border-active");

    fireEvent.dragEnd(from, { dataTransfer });
    expect(api.writes()).toEqual([]);
  });

  it("takes a listed skill off the list when it is dropped on the suggestions", async () => {
    const { api } = open({ [PUT]: stored });
    drag((await chip("Plinth")).closest("li")!, await panel(SUGGESTIONS));

    await waitFor(() => expect(api.writes()).toEqual([PUT]));
    expect(sent(api)[0]).toEqual({ name: "Qorvane stack", nameJa: null, skills: ["Quillset"] });
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

    const alert = await within(await panel(GROUPS)).findByRole("alert");
    expect(toneOf(alert)).toBe("removed");
    expect(alert.textContent).toBe("That change was not saved. Two groups share a name.");
    expect(within(await panel(SUGGESTIONS)).queryByRole("alert")).toBeNull();
    await waitFor(() => expect(readsOfCuration(api)).toBe(2));
  });

  it("says so when the server could not be reached", async () => {
    const { api, user } = open({ [PUT]: UNREACHABLE });
    await user.click(await screen.findByRole("button", { name: /^Add Halvane to Zentrel tools/ }));

    const alert = await within(await panel(SUGGESTIONS)).findByRole("alert");
    expect(alert.textContent).toBe(`That change was not saved. ${NOT_REACHED}`);
    expect(api.writes()).toEqual([PUT]);
  });
});

/**
 * Loads the list, then makes a change the server refuses, so the list is read
 * again, and answers that second read with `second`. Any read after it gets
 * `third`.
 */
async function failLaterRead(second: () => unknown, third: () => unknown = second) {
  let attempt = 0;
  const mounted = open({
    "GET /api/skills/curation": () => (++attempt === 1 ? STORED : attempt === 2 ? second() : third()),
    [PUT]: new Refusal(422, "validation_failed", "Two groups share a name.", { fields: ["groups"] }),
  });
  const name = within(await group("Zentrel tools")).getByLabelText("Group name");
  fireEvent.change(name, { target: { value: "Qorvane stack" } });
  fireEvent.blur(name);
  await waitFor(() => expect(attempt).toBe(2));
  return { ...mounted, reads: () => attempt };
}

describe("a list that could not be read", () => {
  it("says so rather than loading forever", async () => {
    open({ "GET /api/skills/curation": UNREACHABLE });

    expect((await screen.findByRole("alert")).textContent).toBe(NOT_READ);
    expect(toneOf(screen.getByRole("alert"))).toBe("text-secondary");
    expect(screen.queryByText("Loading…")).toBeNull();
  });

  it("reads it again on Retry and shows the list once it arrives", async () => {
    let attempt = 0;
    const { api, user } = open({
      "GET /api/skills/curation": () => (++attempt === 1 ? UNREACHABLE() : STORED),
    });
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: "Retry" }));

    await group("Qorvane stack");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(api.writes()).toEqual([]);
  });

  it("keeps the list it has when a later read fails, and says it may be out of date", async () => {
    await failLaterRead(() => UNREACHABLE());

    expect(await group("Qorvane stack")).toBeTruthy();
    expect((await screen.findByRole("status")).textContent).toBe(
      `Could not refresh: ${NOT_READ} What is shown may be out of date.`,
    );
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("reads again on Retry after a later read fails, and the line goes once one arrives", async () => {
    const { api, user } = await failLaterRead(
      () => UNREACHABLE(),
      () => ({ ...STORED, groups: [...STORED.groups, { name: "Vorbit kit", nameJa: null, skills: [skill("Vorbit")] }] }),
    );
    await screen.findByRole("status");
    await user.click(screen.getByRole("button", { name: "Retry" }));

    await group("Vorbit kit");
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(api.writes()).toEqual([PUT]);
  });

  it("keeps the list and disables Retry while it reads again after a later read fails", async () => {
    const { user, reads } = await failLaterRead(
      () => UNREACHABLE(),
      () => new Promise(() => {}),
    );
    await screen.findByRole("status");
    await user.click(screen.getByRole("button", { name: "Retry" }));

    const retry = await screen.findByRole("button", { name: "Retry" });
    await waitFor(() => expect((retry as HTMLButtonElement).disabled).toBe(true));
    expect(retry.getAttribute("title")).toBe("Retrying…");
    expect(await group("Qorvane stack")).toBeTruthy();
    expect(reads()).toBe(3);
  });

  it("shows the loading state again while Retry reads", async () => {
    let attempt = 0;
    const { user } = open({
      "GET /api/skills/curation": () => (++attempt === 1 ? UNREACHABLE() : new Promise(() => {})),
    });
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect((await screen.findAllByText("Loading…")).length).toBe(3);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });
});
