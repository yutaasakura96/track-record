/**
 * Quick capture (`docs/09` Flow 6, `docs/10` Quick capture, issue #95).
 *
 * What can go wrong without looking wrong: a save that sends a claim the
 * author did not confirm, or files it somewhere they did not choose; a failed
 * reading that loses the text; a draft lost on leaving the screen, or a write
 * made before save; the way in shown on an empty record; and the wider-window
 * message lifted anywhere but here and Applications.
 *
 * jsdom lays nothing out, so the layout at 390px is checked in a browser. All
 * fixtures are invented.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import type { CapturedClaim, Employer, Fact, Overview } from "~/client/api";
import { mount, Refusal, type Routes } from "./harness";

const WIDER = /needs a window at least 1280/;
const DRAFT_KEY = "track-record:capture-draft";

const QORVANE: Employer = {
  id: "emp-test-qorvane",
  nameJa: "株式会社コルヴァーン",
  nameLatin: "Qorvane K.K.",
  industryJa: null,
  businessDescription: null,
  capitalYen: null,
  headcount: null,
  employmentType: "full_time",
  startedOn: "2022-04-01",
  endedOn: null,
} as Employer;

const TYPED = "先月、夜間の受注集計をキュー処理に切り替えた。朝の帳票が7時までに届くようになった。";

const CLAIMS: CapturedClaim[] = [
  {
    claim: "夜間の受注集計をキュー処理に切り替えた。",
    month: "2026-09",
    employerId: null,
    projectId: null,
    technologies: [],
    missing: ["employer", "change"],
  },
  {
    claim: "朝の帳票が7時までに届くようになった。",
    month: "2026-09",
    employerId: QORVANE.id,
    projectId: null,
    technologies: [],
    missing: [],
  },
];

const saved = (over: Partial<Fact>): Fact => ({
  id: "fct-test-1",
  claim: "A claim.",
  provenance: "attested",
  disclosure: "restricted",
  status: "accepted",
  employerId: null,
  employerSetByHand: false,
  projectId: null,
  month: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  evidence: null,
  technologies: [],
  isClientIdentifying: false,
  graded: true,
  autoAccepted: false,
  gradedBy: "author",
  flags: [],
  likelyMatches: [],
  ...over,
});

const OVERVIEW = { isEmpty: false } as Overview;

const routes = (over: Routes = {}): Routes => ({
  "GET /api/imports/summary": { openCandidates: 0, openFlags: 0, running: false },
  "GET /api/applications": { items: [], today: "2026-10-16" },
  "GET /api/overview": OVERVIEW,
  "GET /api/employers": { items: [QORVANE] },
  "GET /api/projects": { items: [] },
  "GET /api/facts?captured=true": { items: [], nextCursor: null },
  ...over,
});

const typeIt = async (user: ReturnType<typeof mount>["user"], text = TYPED) => {
  const box = await screen.findByRole("textbox", { name: "In your own words" });
  await user.click(box);
  await user.paste(text);
};

let width = 0;
const setWidth = (next: number) =>
  Object.defineProperty(window, "innerWidth", { value: next, configurable: true, writable: true });

beforeEach(() => {
  localStorage.clear();
  width = window.innerWidth;
});
afterEach(() => setWidth(width));

describe("reading what was typed", () => {
  it("shows each claim to check, asks only what the text left out, and saves what was confirmed", async () => {
    const { api, user } = mount(
      "/capture",
      routes({
        "POST /api/capture/read": { claims: CLAIMS },
        "POST /api/capture": { items: [saved({}), saved({ id: "fct-test-2" })] },
      }),
    );
    await typeIt(user);
    await user.click(screen.getByRole("button", { name: "Read it" }));

    expect(await screen.findByRole("heading", { name: "Check the 2 claims" })).toBeTruthy();
    expect(api.bodyOf("POST", "/api/capture/read")).toEqual({ text: TYPED, today: expect.stringMatching(/^\d{4}-\d{2}$/) });

    const first = within(screen.getByRole("group", { name: "Claim 1" }));
    const second = within(screen.getByRole("group", { name: "Claim 2" }));
    // The first did not say where, or what changed; the second said everything.
    expect(first.getByText("Which employer, or which project?")).toBeTruthy();
    expect(first.getByText("What changed as a result? Say it in the claim.")).toBeTruthy();
    expect(first.queryByText("When was this?")).toBeNull();
    expect(second.getByText("Employer or project")).toBeTruthy();
    expect(second.queryByText(/What changed/)).toBeNull();
    expect((second.getByRole("combobox") as unknown as HTMLSelectElement).value).toBe(`employer:${QORVANE.id}`);

    // The author corrects the first claim and files it.
    const claim = first.getByRole("textbox", { name: "Claim 1" });
    await user.clear(claim);
    await user.type(claim, "夜間の受注集計をキュー処理に切り替え、朝の帳票が早く届くようになった。");
    await user.selectOptions(first.getByRole("combobox"), `employer:${QORVANE.id}`);
    expect(api.writes()).toEqual(["POST /api/capture/read"]);

    await user.click(screen.getByRole("button", { name: "Save 2 facts" }));
    await screen.findByText("Saved 2 facts into your record.");
    expect(api.bodyOf("POST", "/api/capture")).toEqual({
      claims: [
        { claim: "夜間の受注集計をキュー処理に切り替え、朝の帳票が早く届くようになった。", month: "2026-09", employerId: QORVANE.id, technologies: [] },
        { claim: "朝の帳票が7時までに届くようになった。", month: "2026-09", employerId: QORVANE.id, technologies: [] },
      ],
    });
    // Saved, so the draft is gone and the screen is ready for the next one.
    expect(await screen.findByRole("textbox", { name: "In your own words" })).toBeTruthy();
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  it("opens the plain form with the text kept when the reading fails, and a fact can still be saved", async () => {
    const { api, user } = mount(
      "/capture",
      routes({
        "POST /api/capture/read": new Refusal(503, "upstream_unavailable", "Unavailable."),
        "POST /api/capture": { items: [saved({})] },
      }),
    );
    await typeIt(user, "Moved the nightly export onto a queue.");
    await user.click(screen.getByRole("button", { name: "Read it" }));

    expect(
      await screen.findByText("What you typed could not be read just now. Fill the claim in yourself; your text is kept."),
    ).toBeTruthy();
    const form = within(screen.getByRole("group", { name: "Claim" }));
    expect((form.getByRole("textbox", { name: "Claim" }) as HTMLTextAreaElement).value).toBe(
      "Moved the nightly export onto a queue.",
    );
    expect(form.getByText("When was this?")).toBeTruthy();
    expect(form.getByText("Which employer, or which project?")).toBeTruthy();
    await user.type(form.getByLabelText("Claim: month"), "2026-08");
    await user.selectOptions(form.getByRole("combobox"), "none");

    await user.click(screen.getByRole("button", { name: "Save the fact" }));
    await screen.findByText("Saved 1 fact into your record.");
    expect(api.bodyOf("POST", "/api/capture")).toEqual({
      claims: [{ claim: "Moved the nightly export onto a queue.", month: "2026-08", employerId: null, technologies: [] }],
    });
  });

  it("opens the same form when the reading finds nothing", async () => {
    const { user } = mount("/capture", routes({ "POST /api/capture/read": { claims: [] } }));
    await typeIt(user, "Tired today.");
    await user.click(screen.getByRole("button", { name: "Read it" }));
    expect(await screen.findByText("No claim could be found in what you typed. Fill it in yourself; your text is kept.")).toBeTruthy();
    expect((screen.getByRole("textbox", { name: "Claim" }) as HTMLTextAreaElement).value).toBe("Tired today.");
  });
});

describe("arriving from Home's monthly prompt", () => {
  it("files the text under the employer it named, wherever the reading names none", async () => {
    const { api, user } = mount(
      `/capture?employer=${QORVANE.id}`,
      routes({
        "POST /api/capture/read": { claims: [CLAIMS[0]] },
        "POST /api/capture": { items: [saved({})] },
      }),
    );
    await typeIt(user);
    const where = (await screen.findByRole("combobox", { name: "Where it was: employer or project" })) as unknown as HTMLSelectElement;
    await waitFor(() => expect(where.value).toBe(`employer:${QORVANE.id}`));

    await user.click(screen.getByRole("button", { name: "Read it" }));
    const form = within(await screen.findByRole("group", { name: "Claim" }));
    expect((form.getByRole("combobox") as unknown as HTMLSelectElement).value).toBe(`employer:${QORVANE.id}`);
    // Where it was is said, so the step does not ask it again.
    expect(form.queryByText("Which employer, or which project?")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Save the fact" }));
    await screen.findByText("Saved 1 fact into your record.");
    expect(api.bodyOf("POST", "/api/capture")).toEqual({
      claims: [{ claim: CLAIMS[0]!.claim, month: "2026-09", employerId: QORVANE.id, technologies: [] }],
    });
  });

  it("leaves a kept draft filed where the author said", async () => {
    localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({ step: "text", text: TYPED, filed: "none", claims: [], reading: "read" }),
    );
    mount(`/capture?employer=${QORVANE.id}`, routes());
    const where = (await screen.findByRole("combobox", { name: "Where it was: employer or project" })) as unknown as HTMLSelectElement;
    expect(where.value).toBe("none");
  });

  it("files nothing when it was opened without an employer", async () => {
    mount("/capture", routes());
    const where = (await screen.findByRole("combobox", { name: "Where it was: employer or project" })) as unknown as HTMLSelectElement;
    expect(where.value).toBe("");
  });
});

describe("the draft", () => {
  it("survives leaving the screen, and nothing is written before save", async () => {
    const first = mount("/capture", routes({ "POST /api/capture/read": { claims: CLAIMS } }));
    await typeIt(first.user);
    await first.user.click(screen.getByRole("button", { name: "Read it" }));
    await screen.findByRole("heading", { name: "Check the 2 claims" });
    expect(first.api.writes()).toEqual(["POST /api/capture/read"]);
    cleanup();

    // A reload: a fresh tree over the same browser storage.
    const again = mount("/capture", routes());
    expect(await screen.findByRole("heading", { name: "Check the 2 claims" })).toBeTruthy();
    expect((screen.getByRole("textbox", { name: "Claim 2" }) as HTMLTextAreaElement).value).toBe(CLAIMS[1]!.claim);
    await again.user.click(screen.getByRole("button", { name: "Back to the text" }));
    expect((screen.getByRole("textbox", { name: "In your own words" }) as HTMLTextAreaElement).value).toBe(TYPED);
    expect(again.api.writes()).toEqual([]);
  });

  it("is dropped by Discard", async () => {
    const { user } = mount("/capture", routes());
    await typeIt(user);
    await user.click(screen.getByRole("button", { name: "Fill it in yourself" }));
    await user.click(await screen.findByRole("button", { name: "Discard" }));
    expect((await screen.findByRole("textbox", { name: "In your own words" }) as HTMLTextAreaElement).value).toBe("");
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
  });
});

describe("a captured fact's card", () => {
  it("rejects on its card, and the master document's link opens it there", async () => {
    const fact = saved({ id: "fct-test-9", claim: "Ran the weekly plinth review.", month: "2026-07", employerId: QORVANE.id, employerSetByHand: true });
    const { api, user } = mount(
      `/capture?fact=${fact.id}`,
      routes({
        "GET /api/facts?captured=true": { items: [fact], nextCursor: null },
        [`POST /api/facts/${fact.id}/reject`]: { ...fact, status: "rejected" },
      }),
    );
    const card = within((await screen.findAllByText("Ran the weekly plinth review."))[0]!.closest("li")!);
    expect(card.getByText("2026-07")).toBeTruthy();
    expect((await card.findAllByText("Qorvane K.K.")).length).toBeGreaterThan(0);
    // Opened from a link, so its controls are already open.
    await user.click(card.getByRole("button", { name: "Reject" }));
    await waitFor(() => expect(api.writes()).toEqual([`POST /api/facts/${fact.id}/reject`]));
  });
});

describe("the way in", () => {
  it("is Home's header on a record that holds something", async () => {
    const { user, pathname } = mount("/", routes({ "GET /api/overview": { ...OVERVIEW_FULL } }));
    await user.click(await screen.findByRole("link", { name: "Quick capture" }));
    await waitFor(() => expect(pathname()).toBe("/capture"));
  });

  it("is the menu at phone width, second after Applications, and the sentence names both", async () => {
    setWidth(390);
    const { user, pathname } = mount("/applications", routes());
    await user.click(await screen.findByRole("button", { name: "Menu" }));
    const menu = within(screen.getByRole("navigation", { name: "Menu" }));
    await waitFor(() =>
      expect(menu.getAllByRole("link").map((link) => link.textContent).slice(0, 2)).toEqual(["Applications", "Quick capture"]),
    );
    expect(
      menu.getByText(
        "On a phone, Applications, Quick capture and Skills are the parts that work. The other screens still ask for a wider window.",
      ),
    ).toBeTruthy();
    await user.click(menu.getByRole("link", { name: "Quick capture" }));
    await waitFor(() => expect(pathname()).toBe("/capture"));
    expect(await screen.findByRole("textbox", { name: "In your own words" })).toBeTruthy();
    expect(screen.queryByText(WIDER)).toBeNull();
  });

  it("is not in the menu while the record is empty", async () => {
    setWidth(390);
    const { user } = mount("/applications", routes({ "GET /api/overview": { isEmpty: true } }));
    await user.click(await screen.findByRole("button", { name: "Menu" }));
    const menu = within(screen.getByRole("navigation", { name: "Menu" }));
    await menu.findByRole("link", { name: "Home" });
    expect(menu.queryByRole("link", { name: "Quick capture" })).toBeNull();
  });
});

describe("the wider-window message at phone width", () => {
  it("is not in front of Quick capture, and is still in front of Home", async () => {
    setWidth(390);
    mount("/capture", routes());
    expect(await screen.findByRole("textbox", { name: "In your own words" })).toBeTruthy();
    expect(screen.queryByText(WIDER)).toBeNull();
    cleanup();

    for (const path of ["/", "/capturex", "/record"]) {
      mount(path, routes());
      expect(await screen.findByText(WIDER)).toBeTruthy();
      cleanup();
    }
  });
});

const OVERVIEW_FULL: Overview = {
  lastImportAt: null,
  activeImport: null,
  waitingImports: [],
  tiles: {
    employers: { count: 1, note: null },
    roles: { count: 1, note: null },
    projects: { count: 0, note: null },
    credentials: { count: 0, note: null },
  },
  factsByProvenance: { measured: 0, attested: 2, generated: 0 },
  flagged: 0,
  review: null,
  unconfirmed: null,
  documents: [],
  canGenerate: true,
  isEmpty: false,
};
