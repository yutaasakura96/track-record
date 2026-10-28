/**
 * Applications at phone width (`docs/10-screen-specifications.md`, Responsive
 * behaviour; issue #75).
 *
 * What can go wrong without looking wrong: the wider-window message lifted for
 * a screen that is not under Applications, or kept on one that is; a menu that
 * leads with the wrong row or cannot be closed; and a control left on a phone
 * that opens a screen asking for a wider window.
 *
 * jsdom lays nothing out, so the phone layout itself is checked in a browser.
 * What is checked here is what the window's width decides in code. All
 * fixtures are invented.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import type { Application, ApplicationDocument } from "~/client/api";
import { figures, type Standing } from "~/shared/application";
import { mount } from "./harness";

const TODAY = "2026-10-10";
const ID = "app-test-kestrel";
const AT = `/api/applications/${ID}`;
const WIDER = /needs a window at least 1024/;
const HELD_BACK = /need a wider window, so they are not shown here/;

const NOT_APPLIED: Standing = { step: "not_applied", closedAs: null, dates: { not_applied: "2026-10-01" } };

const TAILORED: ApplicationDocument = {
  ref: "rnd-test-kestrel",
  kind: "english_resume",
  tailored: true,
  title: "Tailored résumé for 株式会社ケストレル",
  language: "en",
  currentVersionId: "rvr-test-kestrel-2",
  currentVersionNo: 2,
  status: "up_to_date",
  newFactsSince: 0,
  withdrawnFactsSince: 0,
  pendingProposalId: null,
};

const application = (over: Partial<Application> = {}): Application => ({
  id: ID,
  company: "株式会社ケストレル",
  position: "バックエンドエンジニア",
  postingUrl: null,
  lastActivityAt: "2026-10-01T03:00:00.000Z",
  ...NOT_APPLIED,
  ...figures(NOT_APPLIED, "2026-10-01", TODAY),
  requirements: [],
  jobDescription: "An invented posting for a backend engineer.",
  motivationNote: null,
  kibouNote: null,
  documents: [],
  choices: [],
  sentCopies: [],
  canGenerate: true,
  interviews: [],
  today: TODAY,
  ...over,
});

const ROUTES = {
  "GET /api/applications": { items: [], today: TODAY },
  "GET /api/imports/summary": { openCandidates: 0, openFlags: 0, running: false },
};

let width = 0;
const setWidth = (next: number) =>
  Object.defineProperty(window, "innerWidth", { value: next, configurable: true, writable: true });

beforeEach(() => {
  width = window.innerWidth;
  setWidth(390);
});
afterEach(() => setWidth(width));

describe("the wider-window message at phone width", () => {
  it("is not shown on the Applications screens", async () => {
    mount("/applications", ROUTES);
    expect(await screen.findByRole("heading", { name: "No applications yet" })).toBeTruthy();
    expect(screen.queryByText(WIDER)).toBeNull();
  });

  it("is not shown on an application or on Add a job", async () => {
    mount(`/applications/${ID}`, { ...ROUTES, [`GET ${AT}`]: application() });
    expect(await screen.findByRole("heading", { name: "Where it stands" })).toBeTruthy();
    expect(screen.queryByText(WIDER)).toBeNull();
  });

  it("is not shown on Skills, which opens with the menu in its header", async () => {
    mount("/skills", {
      ...ROUTES,
      "GET /api/skills/curation": { groups: [], candidates: [], printable: [] },
    });
    expect(await screen.findByRole("heading", { name: "Skills", level: 1 })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Menu" })).toBeTruthy();
    expect(screen.queryByText(WIDER)).toBeNull();
  });

  it("names the real minimum and links to the screens that do work", async () => {
    mount("/", { ...ROUTES, "GET /api/overview": { isEmpty: false } });
    expect(await screen.findByText(WIDER)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Applications" }).getAttribute("href")).toBe("/applications");
    expect(screen.getByRole("link", { name: "Skills" }).getAttribute("href")).toBe("/skills");
    expect(await screen.findByRole("link", { name: "Quick capture" })).toBeTruthy();
  });

  it("holds Quick capture back while the record is empty, as the menu does", async () => {
    mount("/", { ...ROUTES, "GET /api/overview": { isEmpty: true } });
    expect(await screen.findByText(WIDER)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Applications" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Quick capture" })).toBeNull();
  });

  it("is still shown on every other screen", async () => {
    // What these would read is not stubbed: the message stands in front of it.
    for (const path of ["/", "/record", "/documents", "/proposals/prop-test-1", "/applicationsx"]) {
      mount(path, ROUTES);
      expect(await screen.findByText(WIDER)).toBeTruthy();
      cleanup();
    }
  });
});

describe("the menu at phone width", () => {
  it("opens under the header with Applications first and current, says what works, and holds the theme", async () => {
    const { user } = mount("/applications", ROUTES);
    const toggle = await screen.findByRole("button", { name: "Menu" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    await user.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const menu = within(screen.getByRole("navigation", { name: "Menu" }));
    const rows = menu.getAllByRole("link").map((link) => link.textContent);
    expect(rows).toEqual(["Applications", "Home", "Career timeline", "Skills", "Documents", "Flagged", "Career record"]);
    expect(menu.getByRole("link", { name: "Applications" }).getAttribute("aria-current")).toBe("page");
    expect(
      menu.getByText(
        "On a phone, Applications, Quick capture and Skills are the parts that work. The other screens still ask for a wider window.",
      ),
    ).toBeTruthy();
    expect(menu.getByRole("radiogroup", { name: "Theme" })).toBeTruthy();
  });

  it("closes on Menu, on Escape with focus back on Menu, and when a row is followed", async () => {
    const { user, pathname } = mount("/applications", ROUTES);
    const toggle = await screen.findByRole("button", { name: "Menu" });

    await user.click(toggle);
    await user.click(toggle);
    expect(screen.queryByRole("navigation", { name: "Menu" })).toBeNull();

    await user.click(toggle);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("navigation", { name: "Menu" })).toBeNull();
    expect(document.activeElement).toBe(toggle);

    await user.click(toggle);
    await user.click(within(screen.getByRole("navigation", { name: "Menu" })).getByRole("link", { name: "Home" }));
    await waitFor(() => expect(pathname()).toBe("/"));
    expect(await screen.findByText(WIDER)).toBeTruthy();
  });
});

describe("the résumé for a job in a window too narrow for every screen", () => {
  const panel = async () =>
    within((await screen.findByRole("heading", { name: "Résumé for this job" })).closest("section")!);

  it("holds back making a tailored résumé, and says why", async () => {
    mount(`/applications/${ID}`, { ...ROUTES, [`GET ${AT}`]: application() });
    const resume = await panel();
    expect(resume.queryByRole("button", { name: "Make a tailored résumé" })).toBeNull();
    expect(resume.getByText(HELD_BACK)).toBeTruthy();
    // Choosing a document already there opens no other screen, so it stays.
    expect(resume.getByRole("heading", { name: "Use a document you already have" })).toBeTruthy();
  });

  it("holds back History, Regenerate and Review changes on a document's row, and keeps Download and Take off", async () => {
    const waiting = { ...TAILORED, ref: "rnd-test-kestrel-b", title: "Second tailored résumé", pendingProposalId: "prop-test-k" };
    mount(`/applications/${ID}`, {
      ...ROUTES,
      [`GET ${AT}`]: application({ documents: [TAILORED, waiting] }),
    });
    const resume = await panel();
    expect(resume.getAllByRole("button", { name: "Download" })).toHaveLength(2);
    expect(resume.getByRole("button", { name: `Take off ${TAILORED.title}` })).toBeTruthy();
    expect(resume.queryByRole("link", { name: "History" })).toBeNull();
    expect(resume.queryByRole("button", { name: "Regenerate" })).toBeNull();
    expect(resume.queryByRole("link", { name: "Review changes" })).toBeNull();
    expect(resume.getByText(HELD_BACK)).toBeTruthy();
  });

  it("offers them all again once the window is wide enough", async () => {
    setWidth(1280);
    mount(`/applications/${ID}`, { ...ROUTES, [`GET ${AT}`]: application({ documents: [TAILORED] }) });
    const resume = await panel();
    expect(resume.getByRole("link", { name: "History" })).toBeTruthy();
    expect(resume.getByRole("button", { name: "Regenerate" })).toBeTruthy();
    expect(resume.queryByText(HELD_BACK)).toBeNull();
  });
});
