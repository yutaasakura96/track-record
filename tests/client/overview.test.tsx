/**
 * Screen 3, Record Overview (`docs/10-screen-specifications.md`).
 *
 * One write starts here: Generate, which asks the server for a proposal and
 * opens it. What matters is that the write names the document it was made
 * from, that a document which cannot be generated offers no write at all, that
 * a refusal the server explains is shown in the server's words, and that a
 * write which never reached the server says so. All fixtures are invented.
 */
import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import type { Overview, RenderRow } from "~/client/api";
import { mount, Refusal, type Routes } from "./harness";

const UNREACHABLE = () => {
  throw new TypeError("Failed to fetch");
};
const NOT_REACHED = "The server could not be reached. Try again.";
/** A read has a Retry beside it, so its line does not also say to try again. */
const NOT_READ = "The server could not be reached.";

const row = (over: Partial<RenderRow> = {}): RenderRow => ({
  id: null,
  kind: "english_resume",
  language: "en",
  title: "English résumé",
  buildable: true,
  currentVersionId: null,
  currentVersionNo: null,
  generatedAt: null,
  status: "never_generated",
  newFactsSince: null,
  pendingProposalId: null,
  ...over,
});

const overview = (documents: RenderRow[], canGenerate = true): Overview => ({
  lastImportAt: null,
  activeImport: null,
  tiles: {
    employers: { count: 1, note: null },
    roles: { count: 1, note: null },
    projects: { count: 0, note: null },
    credentials: { count: 0, note: null },
  },
  factsByProvenance: { measured: 3, attested: 1, generated: 0 },
  documents,
  canGenerate,
  isEmpty: false,
});

const open = (documents: RenderRow[], routes: Routes = {}, canGenerate = true) =>
  mount("/", {
    "GET /api/overview": overview(documents, canGenerate),
    "GET /api/imports/summary": { openCandidates: 0, running: false },
    ...routes,
  });

const documentRow = async (title = "English résumé") => (await screen.findByText(title)).closest("li")!;

describe("generating a document", () => {
  const POST = "POST /api/renders/english_resume/generate";

  it("asks for the row's document and opens the proposal it made", async () => {
    const { api, user, pathname } = open([row()], { [POST]: { proposalId: "prop-test-plinth" } });
    await user.click(within(await documentRow()).getByRole("button", { name: "Generate" }));

    await waitFor(() => expect(pathname()).toBe("/proposals/prop-test-plinth"));
    expect(api.writes()).toEqual([POST]);
  });

  it("shows the server's refusal and stays on the overview", async () => {
    const { api, user, pathname } = open([row()], {
      [POST]: new Refusal(409, "proposal_pending", "A proposal for this document is already waiting."),
    });
    await user.click(within(await documentRow()).getByRole("button", { name: "Generate" }));

    expect((await screen.findByRole("alert")).textContent).toBe("A proposal for this document is already waiting.");
    expect(pathname()).toBe("/");
    expect(api.writes()).toEqual([POST]);
  });

  it("says so when the server could not be reached", async () => {
    const { api, user, pathname } = open([row()], { [POST]: UNREACHABLE });
    await user.click(within(await documentRow()).getByRole("button", { name: "Generate" }));

    expect((await screen.findByRole("alert")).textContent).toBe(NOT_REACHED);
    expect(pathname()).toBe("/");
    expect(api.writes()).toEqual([POST]);
  });

  it("clears the last failure when Generate is pressed again", async () => {
    let attempt = 0;
    const { user, pathname } = open([row()], {
      [POST]: () => (++attempt === 1 ? UNREACHABLE() : { proposalId: "prop-test-quillset" }),
    });
    const button = within(await documentRow()).getByRole("button", { name: "Generate" });
    await user.click(button);
    await screen.findByRole("alert");

    await user.click(button);
    await waitFor(() => expect(pathname()).toBe("/proposals/prop-test-quillset"));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("offers no write when no fact can be used, and says why", async () => {
    const { api } = open([row()], {}, false);
    const button = within(await documentRow()).getByRole("button", { name: "Generate" });

    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.title).toBe("No accepted facts can be used in a document yet.");
    expect(api.writes()).toEqual([]);
  });

  it("offers no write for a document that is not built, and says why", async () => {
    open([row({ buildable: false })]);
    const button = within(await documentRow()).getByRole("button", { name: "Generate" });

    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.title).toBe("This document is not built yet.");
  });

  it("opens the waiting proposal instead of asking for another", async () => {
    const { api, user, pathname } = open([
      row({ status: "proposal_pending", pendingProposalId: "prop-test-zentrel" }),
    ]);
    await user.click(within(await documentRow()).getByRole("button", { name: "Review proposal" }));

    await waitFor(() => expect(pathname()).toBe("/proposals/prop-test-zentrel"));
    expect(api.writes()).toEqual([]);
  });
});

describe("an overview that could not be read", () => {
  it("says so rather than loading forever", async () => {
    open([], { "GET /api/overview": UNREACHABLE });

    expect((await screen.findByRole("alert")).textContent).toBe(NOT_READ);
    expect(screen.queryByText("Loading your record…")).toBeNull();
  });

  it("reads it again on Retry and shows it once it arrives", async () => {
    let attempt = 0;
    const { api, user } = open([], {
      "GET /api/overview": () => (++attempt === 1 ? UNREACHABLE() : overview([row()])),
    });
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: "Retry" }));

    await documentRow();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(api.writes()).toEqual([]);
  });

  it("shows the loading state again while Retry reads", async () => {
    let attempt = 0;
    const { user } = open([], {
      "GET /api/overview": () => (++attempt === 1 ? UNREACHABLE() : new Promise(() => {})),
    });
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: "Retry" }));

    await screen.findByText("Loading your record…");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("keeps the sidebar, so the author can leave for another screen", async () => {
    open([], { "GET /api/overview": UNREACHABLE });

    await screen.findByRole("alert");
    const nav = screen.getByRole("navigation");
    expect(within(nav).getByRole("link", { name: "Record" }).getAttribute("href")).toBe("/record");
  });

  it("keeps the sidebar while the overview is loading", async () => {
    open([], { "GET /api/overview": () => new Promise(() => {}) });

    await screen.findByText("Loading your record…");
    expect(within(screen.getByRole("navigation")).getByRole("link", { name: "Documents" })).toBeTruthy();
  });
});
