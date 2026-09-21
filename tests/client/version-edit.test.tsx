/**
 * Screen 6, Edit a version (`docs/10-screen-specifications.md`).
 *
 * The only place the author's own sentence enters a render, so what matters is
 * the body of the one write: that it is based on the current version, that it
 * carries exactly the edit made and no more, and that a refused save keeps the
 * draft on screen with the reason rather than losing it.
 * All fixtures are invented.
 */
import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import type { EditResult, StoredVersion, VersionHistory } from "~/client/api";
import type { RenderContent } from "~/shared/render-content";
import { mount, Refusal, type Routes } from "./harness";

const KIND = "english_resume";
const PATH = `/renders/${KIND}/edit`;
const CURRENT = "ver-test-3";
const SAVE = `POST /api/renders/${KIND}/versions`;

const QUILLSET = "Moved the Qorvane quillset to zentrel.";
const REVIEW = "Ran the plinth review weekly.";

const CONTENT: RenderContent = {
  sections: [
    {
      key: "experience",
      heading: "Experience",
      blocks: [
        { id: "blk-test-1", kind: "bullet", text: QUILLSET, factIds: ["fct-test-1", "fct-test-2"] },
        { id: "blk-test-2", kind: "bullet", text: REVIEW, factIds: ["fct-test-3"] },
      ],
    },
  ],
};

const HISTORY: VersionHistory = {
  renderKind: KIND,
  currentVersionId: CURRENT,
  currentVersionNo: 3,
  items: [],
};

const STORED: StoredVersion = {
  id: CURRENT,
  renderKind: KIND,
  versionNo: 3,
  origin: "accepted",
  sourceVersionId: null,
  acceptedAt: "2026-09-03T00:00:00.000Z",
  content: CONTENT,
};

const saved = (warnings: string[] = []): EditResult => ({
  renderKind: KIND,
  newVersionNo: 4,
  origin: "edited",
  sourceVersionId: CURRENT,
  acceptedAt: "2026-09-04T00:00:00.000Z",
  warnings,
});

const open = (routes: Routes = {}) =>
  mount(PATH, {
    [`GET /api/renders/${KIND}/versions`]: HISTORY,
    [`GET /api/renders/${KIND}/versions/${CURRENT}`]: STORED,
    ...routes,
  });

/** The row holding a block, found by the text the author reads. */
const block = async (text: string) => (await screen.findByText(text)).closest("li")!;

const saveButton = () => screen.getByRole("button", { name: "Save as v4" }) as HTMLButtonElement;

/** The content the save should have sent: the stored version with one change. */
const without = (blockId: string): RenderContent => ({
  sections: CONTENT.sections.map((s) => ({ ...s, blocks: s.blocks.filter((b) => b.id !== blockId) })),
});

describe("an edit", () => {
  it("cannot be saved until something has changed", async () => {
    open();

    await block(QUILLSET);
    expect(saveButton().disabled).toBe(true);
    expect(saveButton().title).toBe("Nothing has changed yet.");
  });

  it("saves against the current version, sends only the edit made, and returns to the history", async () => {
    const { api, user, pathname } = open({ [SAVE]: saved() });

    await user.click(within(await block(REVIEW)).getByRole("button", { name: "Delete" }));
    await user.click(saveButton());

    await waitFor(() => expect(pathname()).toBe(`/renders/${KIND}/history`));
    expect(api.writes()).toEqual([SAVE]);
    expect(api.bodyOf("POST", `/api/renders/${KIND}/versions`)).toEqual({
      basedOnVersionId: CURRENT,
      content: without("blk-test-2"),
    });
  });

  it("removes one citation from one block and leaves the others", async () => {
    const { api, user } = open({ [SAVE]: saved() });

    await user.click(await screen.findByRole("button", { name: "Remove citation fct-test-1" }));
    await user.click(saveButton());

    await waitFor(() => expect(api.writes()).toEqual([SAVE]));
    const body = api.bodyOf("POST", `/api/renders/${KIND}/versions`) as { content: RenderContent };
    expect(body.content.sections[0]!.blocks.map((b) => [b.id, b.factIds])).toEqual([
      ["blk-test-1", ["fct-test-2"]],
      ["blk-test-2", ["fct-test-3"]],
    ]);
  });

  it("does not count an empty added block as a change", async () => {
    const { user } = open();

    await user.click(await screen.findByRole("button", { name: "Add paragraph" }));

    expect(saveButton().disabled).toBe(true);
  });

  it("cannot empty the document", async () => {
    const { user } = open();

    await user.click(within(await block(QUILLSET)).getByRole("button", { name: "Delete" }));
    await user.click(within(await block(REVIEW)).getByRole("button", { name: "Delete" }));

    expect(saveButton().disabled).toBe(true);
    expect(saveButton().title).toBe("An edit cannot empty the document.");
  });
});

describe("a saved edit with warnings", () => {
  it("stays to show them, since they have nowhere else to land", async () => {
    const warning = "A bullet under Qorvane cites a fact filed under another employer.";
    const { api, user, pathname } = open({ [SAVE]: saved([warning]) });

    await user.click(within(await block(REVIEW)).getByRole("button", { name: "Delete" }));
    await user.click(saveButton());

    expect(await screen.findByText("Saved as v4.")).toBeTruthy();
    expect(screen.getByText(warning)).toBeTruthy();
    expect(api.writes()).toEqual([SAVE]);
    expect(pathname()).toBe(PATH);
  });
});

describe("a refused save", () => {
  it("names the facts, keeps the draft, and stays", async () => {
    const { api, user, pathname } = open({
      [SAVE]: new Refusal(422, "unrenderable", "fct-test-1 is Private and never reaches a document (and 1 other).", {
        facts: [
          { factId: "fct-test-1", problem: "private" },
          { factId: "fct-test-2", problem: "generated" },
        ],
      }),
    });

    await user.click(within(await block(REVIEW)).getByRole("button", { name: "Delete" }));
    await user.click(saveButton());

    expect((await screen.findByRole("alert")).textContent).toBe(
      "fct-test-1 is Private and never reaches a document (and 1 other).",
    );
    expect(screen.getByText("Remove the citation, or delete the block, and save again.")).toBeTruthy();
    // The draft survived the refusal: the deleted block is still gone.
    expect(screen.queryByText(REVIEW)).toBeNull();
    expect(saveButton().disabled).toBe(false);
    expect(api.writes()).toEqual([SAVE]);
    expect(pathname()).toBe(PATH);
  });

  it("offers a reload when the version was replaced underneath the editor", async () => {
    const { user } = open({
      [SAVE]: new Refusal(409, "conflict", "This is no longer the current version.", {
        currentVersionId: "ver-test-4",
      }),
    });

    await user.click(within(await block(REVIEW)).getByRole("button", { name: "Delete" }));
    await user.click(saveButton());

    expect((await screen.findByRole("alert")).textContent).toBe("This is no longer the current version.");
    expect(screen.getByRole("button", { name: "Reload and edit again" })).toBeTruthy();
  });

  it("says so and keeps the draft when the server cannot be reached", async () => {
    const { api, user, pathname } = open({
      [SAVE]: () => {
        throw new TypeError("Failed to fetch");
      },
    });

    await user.click(within(await block(REVIEW)).getByRole("button", { name: "Delete" }));
    await user.click(saveButton());

    expect((await screen.findByRole("alert")).textContent).toBe(
      "The server could not be reached. Try again.",
    );
    expect(screen.queryByText(REVIEW)).toBeNull();
    expect(api.writes()).toEqual([SAVE]);
    expect(pathname()).toBe(PATH);
  });
});

describe("cancelling", () => {
  it("leaves at once when nothing has changed", async () => {
    const { api, user, pathname } = open();

    await block(QUILLSET);
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(pathname()).toBe(`/renders/${KIND}/history`));
    expect(api.writes()).toEqual([]);
  });

  it("asks before discarding a change, and keeps it on Keep editing", async () => {
    const { api, user, pathname } = open();

    await user.click(within(await block(REVIEW)).getByRole("button", { name: "Delete" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Keep editing" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText(REVIEW)).toBeNull();
    expect(pathname()).toBe(PATH);

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Discard" }));

    await waitFor(() => expect(pathname()).toBe(`/renders/${KIND}/history`));
    expect(api.writes()).toEqual([]);
  });
});
