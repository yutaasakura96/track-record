/**
 * Screen 17, reading a document (`docs/10-screen-specifications.md`, issue
 * #106).
 *
 * What matters is that the page reads the version it says it reads, that the
 * header offers a control only where its route would accept it, and that a
 * download the server would refuse is said in place of a page it would not
 * produce. All fixtures are invented.
 */
import { afterEach, describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import type { RenderPage, RenderRow } from "~/client/api";
import { mount, Refusal, type Routes } from "./harness";

const KIND = "english_resume";
const PAGE = `GET /api/renders/${KIND}/page`;

const DOCUMENT: RenderRow = {
  id: "rnd-test-1",
  ref: KIND,
  tailored: null,
  kind: KIND,
  language: "en",
  title: "Résumé (English)",
  buildable: true,
  currentVersionId: "ver-test-3",
  currentVersionNo: 3,
  generatedAt: "2026-09-03T00:00:00.000Z",
  status: "up_to_date",
  newFactsSince: 0,
  withdrawnFactsSince: 0,
  pendingProposalId: null,
};

const view = (over: Partial<RenderPage> = {}): RenderPage => ({
  renderKind: KIND,
  renderRef: KIND,
  title: "Résumé (English)",
  language: "en",
  tailored: false,
  applicationId: null,
  document: DOCUMENT,
  canGenerate: true,
  version: { id: "ver-test-3", versionNo: 3, origin: "accepted", acceptedAt: "2026-09-03T00:00:00.000Z", isCurrent: true },
  page: {
    title: "Résumé (English)",
    stamp: null,
    name: "Ryo Tanabe",
    contact: ["ryo@example.invalid"],
    sections: [
      {
        heading: "Experience",
        blocks: [
          { kind: "bullet", text: "Moved the Qorvane quillset to zentrel" },
          { kind: "bullet", text: "Cut the plinth build from nine minutes to two" },
        ],
      },
    ],
  },
  ...over,
});

const open = (path = `/renders/${KIND}/view`, routes: Routes = {}) =>
  mount(path, { [PAGE]: view(), ...routes });

const notice = async () => within((await screen.findByText("v3")).parentElement!);

describe("the page", () => {
  it("shows the document as its download holds it, under its version and date", async () => {
    open();

    const page = await screen.findByRole("article");
    const title = within(page).getByRole("heading", { name: "Résumé (English)" });
    const name = within(page).getByText("Ryo Tanabe");
    const section = within(page).getByRole("heading", { name: "Experience" });
    expect(title.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(name.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(page).getByText("ryo@example.invalid")).toBeTruthy();
    expect(within(page).getByRole("heading", { name: "Experience" })).toBeTruthy();
    expect(within(page).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Moved the Qorvane quillset to zentrel",
      "Cut the plinth build from nine minutes to two",
    ]);
    const bar = await notice();
    expect(bar.getByText("Current")).toBeTruthy();
    expect(bar.getByText(/This is the document as its download holds it today/)).toBeTruthy();
  });

  it("offers Download, History, Edit and Regenerate on the current version", async () => {
    open();
    const bar = await notice();

    expect(bar.getByRole("button", { name: "Download" })).toBeTruthy();
    expect(bar.getByRole("link", { name: "History" }).getAttribute("href")).toBe(`/renders/${KIND}/history`);
    expect(bar.getByRole("link", { name: "Edit" }).getAttribute("href")).toBe(`/renders/${KIND}/edit`);
    expect(bar.getByRole("button", { name: "Regenerate" })).toBeTruthy();
  });

  it("regenerates, and opens the proposal it started", async () => {
    const { api, user, pathname } = open(undefined, {
      [`POST /api/renders/${KIND}/generate`]: { proposalId: "prop-test-new" },
    });
    await user.click((await notice()).getByRole("button", { name: "Regenerate" }));

    await waitFor(() => expect(pathname()).toBe("/proposals/prop-test-new"));
    expect(api.writes()).toEqual([`POST /api/renders/${KIND}/generate`]);
  });

  it("leads to the waiting proposal instead of writing a second", async () => {
    open(undefined, {
      [PAGE]: view({ document: { ...DOCUMENT, status: "proposal_pending", pendingProposalId: "prop-test-wait" } }),
    });
    const bar = await notice();

    expect(bar.getByRole("link", { name: "Review changes" }).getAttribute("href")).toBe("/proposals/prop-test-wait");
    expect(bar.queryByRole("button", { name: "Regenerate" })).toBeNull();
    expect(screen.getByText(/A new version is waiting for you/)).toBeTruthy();
  });

  it("reads an earlier version by id, without Edit or a new version, and leads to the current one", async () => {
    const { api } = open(`/renders/${KIND}/view?version=ver-test-1`, {
      [`${PAGE}?versionId=ver-test-1`]: view({
        version: { id: "ver-test-1", versionNo: 1, origin: "edited", acceptedAt: "2026-09-01T00:00:00.000Z", isCurrent: false },
      }),
    });
    const bar = within((await screen.findByText("v1")).parentElement!);

    expect(bar.queryByText("Current")).toBeNull();
    expect(bar.getByText(/Edited by hand/)).toBeTruthy();
    expect(bar.queryByRole("link", { name: "Edit" })).toBeNull();
    expect(bar.queryByRole("button", { name: "Regenerate" })).toBeNull();
    expect(bar.getByRole("link", { name: "Read the current version" }).getAttribute("href")).toBe(
      `/renders/${KIND}/view`,
    );
    expect(api.calls.map((call) => call.path)).toContain(`/api/renders/${KIND}/page?versionId=ver-test-1`);
  });

  it("says the download's refusal in place of a page, with the way out", async () => {
    open(undefined, {
      [PAGE]: new Refusal(409, "conflict", "fct-test-a is Private and never reaches a document.", {
        facts: [{ factId: "fct-test-a", problem: "private" }],
      }),
    });

    expect((await screen.findByRole("alert")).textContent).toBe("fct-test-a is Private and never reaches a document.");
    expect(screen.queryByRole("article")).toBeNull();
    expect(screen.getByRole("link", { name: "Edit" }).getAttribute("href")).toBe(`/renders/${KIND}/edit`);
  });

  it("replaces a cached page when a later read is refused", async () => {
    let withheld = false;
    const { queryClient } = open(undefined, {
      [PAGE]: () => withheld
        ? new Refusal(409, "conflict", "A cited fact is Private.")
        : view(),
    });
    expect(await screen.findByRole("article")).toBeTruthy();

    withheld = true;
    await queryClient.invalidateQueries({ queryKey: ["renders", KIND] });

    expect((await screen.findByRole("alert")).textContent).toBe("A cited fact is Private.");
    expect(screen.queryByRole("article")).toBeNull();
  });

  it("is not found for a document with no version", async () => {
    open(undefined, { [PAGE]: new Refusal(404, "not_found", "A version of that document was not found.") });
    expect(await screen.findByText("That document or version was not found.")).toBeTruthy();
  });

  it("leads a tailored résumé back to its application", async () => {
    const ref = "rnd-test-tailored";
    open(`/renders/${ref}/view`, {
      [`GET /api/renders/${ref}/page`]: view({
        renderRef: ref,
        title: "Résumé for Quillset Ltd",
        tailored: true,
        applicationId: "app-test-1",
        document: { ...DOCUMENT, ref, tailored: { label: "Quillset Ltd", createdAt: "2026-09-01T00:00:00.000Z" } },
      }),
    });
    const bar = await notice();

    expect(bar.getByRole("link", { name: "Back to the application" }).getAttribute("href")).toBe(
      "/applications/app-test-1",
    );
    expect(bar.getByRole("link", { name: "History" }).getAttribute("href")).toBe(`/renders/${ref}/history`);
  });
});

describe("at phone width", () => {
  const WIDER = /needs a window at least 1280/;
  const width = window.innerWidth;
  const setWidth = (next: number) =>
    Object.defineProperty(window, "innerWidth", { value: next, configurable: true, writable: true });
  afterEach(() => setWidth(width));

  it("keeps all reader header actions available at 390px", async () => {
    setWidth(390);
    open();
    const bar = await notice();

    expect(screen.queryByText(WIDER)).toBeNull();
    expect(screen.getByRole("article")).toBeTruthy();
    expect(bar.getByRole("button", { name: "Download" })).toBeTruthy();
    expect(bar.getByRole("link", { name: "History" })).toBeTruthy();
    expect(bar.getByRole("link", { name: "Edit" })).toBeTruthy();
    expect(bar.getByRole("button", { name: "Regenerate" })).toBeTruthy();
  });

  it("still shows the message on the document's other screens", async () => {
    setWidth(390);
    mount(`/renders/${KIND}/history`, {});
    expect(await screen.findByText(WIDER)).toBeTruthy();
  });
});
