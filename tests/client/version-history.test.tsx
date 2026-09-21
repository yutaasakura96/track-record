/**
 * Screen 5, Version History (`docs/10-screen-specifications.md`).
 *
 * Restore replaces the document the author sends out, so what matters is that
 * the commit names the version the preview showed, that nothing but the
 * preview's own button commits, and that a refused restore leaves the author on
 * the preview with the reason and the way out.
 * All fixtures are invented.
 */
import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import type { ProposalRow, RenderDiff, RenderVersion, VersionHistory } from "~/client/api";
import { mount, Refusal, type Routes } from "./harness";

const KIND = "english_resume";
const PATH = `/renders/${KIND}/history`;

function version(versionNo: number, overrides: Partial<RenderVersion> = {}): RenderVersion {
  return {
    id: `ver-test-${versionNo}`,
    versionNo,
    origin: "accepted",
    sourceVersionId: null,
    sourceVersionNo: null,
    acceptedAt: `2026-09-0${versionNo}T00:00:00.000Z`,
    isCurrent: false,
    ...overrides,
  };
}

const V1 = version(1);
const V2 = version(2, { origin: "edited", sourceVersionId: V1.id, sourceVersionNo: 1 });
const V3 = version(3, { isCurrent: true });

const history = (items: RenderVersion[]): VersionHistory => ({
  renderKind: KIND,
  currentVersionId: items.find((v) => v.isCurrent)?.id ?? null,
  currentVersionNo: items.find((v) => v.isCurrent)?.versionNo ?? null,
  items,
});

const DISMISSED: ProposalRow = {
  id: "prop-test-9",
  status: "dismissed",
  generationStatus: "ready",
  generatedAt: "2026-09-05T00:00:00.000Z",
  decidedAt: "2026-09-05T01:00:00.000Z",
  reason: null,
};

const DIFF: RenderDiff = {
  additions: 1,
  removals: 1,
  changes: [
    {
      changeId: "chg-test-1",
      sectionKey: "experience",
      currentBlockId: "blk-test-3",
      proposedBlockId: "blk-test-1",
      tokens: [
        { op: "equal", text: "Moved the Qorvane quillset to " },
        { op: "remove", text: "plinth" },
        { op: "add", text: "zentrel" },
        { op: "equal", text: "." },
      ],
      rationale: { kind: "restore", text: "Restoring an earlier version.", factIds: [] },
    },
  ],
};

const RESTORE_V1 = `POST /api/renders/${KIND}/versions/${V1.id}/restore`;

const open = (routes: Routes = {}, items = [V3, V2, V1]) =>
  mount(PATH, {
    [`GET /api/renders/${KIND}/versions`]: history(items),
    [`GET /api/proposals?kind=${KIND}`]: { items: [DISMISSED] },
    [`GET /api/renders/${KIND}/diff?from=${V3.id}&to=${V1.id}`]: DIFF,
    ...routes,
  });

const row = (name: string) => screen.findByRole("listitem", { name });

async function compareV1(user: ReturnType<typeof open>["user"]) {
  const v1 = await row("v1, accepted · from a proposal");
  await user.click(within(v1).getByRole("button", { name: "Compare" }));
  return screen.findByRole("dialog");
}

describe("the history", () => {
  it("offers Compare on every version but the current one, which offers Edit", async () => {
    open();

    const current = await row("v3, accepted · from a proposal");
    expect(within(current).queryByRole("button", { name: "Compare" })).toBeNull();
    expect(within(current).getByRole("link", { name: "Edit" })).toBeTruthy();

    for (const name of ["v2, edited by hand", "v1, accepted · from a proposal"]) {
      const earlier = await row(name);
      expect(within(earlier).getByRole("button", { name: "Compare" })).toBeTruthy();
      expect(within(earlier).queryByRole("link", { name: "Edit" })).toBeNull();
    }
  });

  it("says what an edited version came from, and lists a dismissed proposal as not a version", async () => {
    open();

    expect(within(await row("v2, edited by hand")).getByText("Edited from v1")).toBeTruthy();
    expect(screen.getByText("DISMISSED · not a version")).toBeTruthy();
    expect(screen.getByText("3 versions · current v3")).toBeTruthy();
  });

  it("opens the preview on Enter from a row, without restoring", async () => {
    const { api, user } = open();

    (await row("v1, accepted · from a proposal")).focus();
    await user.keyboard("{Enter}");

    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(api.writes()).toEqual([]);
  });
});

describe("the restore preview", () => {
  it("restores the version it previewed, sends nothing else, and closes", async () => {
    const { api, user, pathname } = open({ [RESTORE_V1]: { newVersionNo: 4, sourceVersionNo: 1 } });

    const dialog = await compareV1(user);
    expect(within(dialog).getByText("Restoring v1 saves it as a new version v4. v3 stays readable and downloadable.")).toBeTruthy();
    // Opening the preview wrote nothing. A comparison is not a proposal.
    expect(api.writes()).toEqual([]);

    await user.click(within(dialog).getByRole("button", { name: "Restore v1" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.writes()).toEqual([RESTORE_V1]);
    expect(pathname()).toBe(PATH);
  });

  it.each([
    ["Cancel", (user: ReturnType<typeof open>["user"], dialog: HTMLElement) =>
      user.click(within(dialog).getByRole("button", { name: "Cancel" }))],
    ["Escape", (user: ReturnType<typeof open>["user"]) => user.keyboard("{Escape}")],
  ])("closes on %s and sends nothing", async (_, close) => {
    const { api, user } = open();

    const dialog = await compareV1(user);
    await close(user, dialog);

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.writes()).toEqual([]);
  });

  it("says so and stays when a pending proposal is in the way, with the way to it", async () => {
    const { api, user } = open({
      [RESTORE_V1]: new Refusal(409, "conflict", "A proposal is waiting for your decision.", {
        proposalId: "prop-test-3",
      }),
    });

    const dialog = await compareV1(user);
    await user.click(within(dialog).getByRole("button", { name: "Restore v1" }));

    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toContain("A proposal is waiting for your decision.");
    expect(within(alert).getByRole("link", { name: "Open the proposal" }).getAttribute("href")).toBe(
      "/proposals/prop-test-3",
    );
    expect(api.writes()).toEqual([RESTORE_V1]);
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("names every fact that cannot be rendered, and stays", async () => {
    const { api, user } = open({
      [RESTORE_V1]: new Refusal(422, "unrenderable", "fct-test-1 is Private and never reaches a document (and 1 other).", {
        facts: [
          { factId: "fct-test-1", problem: "private" },
          { factId: "fct-test-2", problem: "generated" },
        ],
      }),
    });

    const dialog = await compareV1(user);
    await user.click(within(dialog).getByRole("button", { name: "Restore v1" }));

    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toContain("Change the fact in your record, or restore a different version.");
    expect(within(dialog).getByText("fct-test-1")).toBeTruthy();
    expect(within(dialog).getByText("fct-test-2")).toBeTruthy();
    expect(api.writes()).toEqual([RESTORE_V1]);
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("says so and stays when the server cannot be reached", async () => {
    const { api, user } = open({
      [RESTORE_V1]: () => {
        throw new TypeError("Failed to fetch");
      },
    });

    const dialog = await compareV1(user);
    await user.click(within(dialog).getByRole("button", { name: "Restore v1" }));

    expect((await within(dialog).findByRole("alert")).textContent?.trim()).toBe(
      "The server could not be reached. Try again.",
    );
    expect(api.writes()).toEqual([RESTORE_V1]);
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});

describe("a download", () => {
  const DOWNLOAD_V1 = `GET /api/renders/${KIND}/download?format=docx&versionId=${V1.id}`;

  it.each([
    [
      "refused",
      new Refusal(409, "unrenderable", "fct-test-1 is Private and never reaches a document (and 1 other).", {
        facts: [
          { factId: "fct-test-1", problem: "private" },
          { factId: "fct-test-2", problem: "private" },
        ],
      }),
      "fct-test-1 is Private and never reaches a document (and 1 other).",
    ],
    [
      "unreachable",
      () => {
        throw new TypeError("Failed to fetch");
      },
      "The server could not be reached. Try again.",
    ],
  ])("says why when it is %s, and writes nothing", async (_, answer, said) => {
    const { api, user } = open({ [DOWNLOAD_V1]: answer });

    const v1 = await row("v1, accepted · from a proposal");
    await user.click(within(v1).getByRole("button", { name: "Download" }));

    expect((await screen.findByRole("alert")).textContent).toBe(said);
    expect(api.calls.some((c) => `${c.method} ${c.path}` === DOWNLOAD_V1)).toBe(true);
    expect(api.writes()).toEqual([]);
    // The control is usable again rather than stuck on "Preparing…".
    expect(within(v1).getByRole("button", { name: "Download" })).toBeTruthy();
  });
});

describe("a document with no versions", () => {
  const empty = (routes: Routes) =>
    open(
      {
        "GET /api/renders": {
          items: [{ kind: KIND, buildable: true }],
        },
        ...routes,
      },
      [],
    );

  it("generates, and opens the proposal it started", async () => {
    const { api, user, pathname } = empty({
      [`POST /api/renders/${KIND}/generate`]: { proposalId: "prop-test-2" },
    });

    await user.click(await screen.findByRole("button", { name: "Generate" }));

    await waitFor(() => expect(pathname()).toBe("/proposals/prop-test-2"));
    expect(api.writes()).toEqual([`POST /api/renders/${KIND}/generate`]);
  });

  it("says so and stays when generation is refused", async () => {
    const { api, user, pathname } = empty({
      [`POST /api/renders/${KIND}/generate`]: new Refusal(409, "conflict", "A generation is already running."),
    });

    await user.click(await screen.findByRole("button", { name: "Generate" }));

    expect((await screen.findByRole("alert")).textContent).toBe("A generation is already running.");
    expect(api.writes()).toEqual([`POST /api/renders/${KIND}/generate`]);
    expect(pathname()).toBe(PATH);
  });
});
