/**
 * Screen 6 on a waiting draft (`docs/06`, 2026-11-04), and the ways into it.
 *
 * Fixing one line of a fresh draft must not push the author to a paid
 * regeneration. What matters is the one write: it carries exactly the edit
 * made, it goes to the draft's own route (which accepts the draft and saves the
 * edit on top), and nothing is sent while a drafted part still waits.
 * All fixtures are invented.
 */
import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import type { DraftEditResult, Proposal, ProposalContent, RenderDiff } from "~/client/api";
import type { RenderContent } from "~/shared/render-content";
import { mount, type Routes } from "./harness";

const PROPOSAL = "prop-test-7";
const PATH = `/proposals/${PROPOSAL}/edit`;
const SAVE = `POST /api/proposals/${PROPOSAL}/edit`;

const QUILLSET = "Moved the Qorvane quillset to zentrel.";
const REVIEW = "Ran the plinth review weekly.";

const CONTENT: RenderContent = {
  sections: [
    {
      key: "experience",
      heading: "Experience",
      blocks: [
        { id: "blk-test-1", kind: "bullet", text: QUILLSET, factIds: ["fct-test-1"] },
        { id: "blk-test-2", kind: "bullet", text: REVIEW, factIds: ["fct-test-2"] },
      ],
    },
  ],
};

function proposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    id: PROPOSAL,
    renderKind: "english_resume",
    renderRef: "english_resume",
    title: "Résumé (English)",
    applicationId: null,
    status: "pending",
    generationStatus: "ready",
    error: null,
    basedOnVersionNo: 3,
    proposedVersionNo: 4,
    generatedAt: "2026-09-01T00:00:00.000Z",
    progressAt: null,
    reason: null,
    warnings: [],
    drafts: [],
    unchanged: false,
    withheld: { privateFactCount: 0, generatedFactCount: 0 },
    ...overrides,
  };
}

const READ: ProposalContent = {
  id: PROPOSAL,
  renderKind: "english_resume",
  renderRef: "english_resume",
  status: "pending",
  content: CONTENT,
};

const saved = (warnings: string[] = []): DraftEditResult => ({
  renderKind: "english_resume",
  acceptedVersionNo: 4,
  newVersionNo: 5,
  origin: "edited",
  sourceVersionId: "ver-test-4",
  acceptedAt: "2026-09-04T00:00:00.000Z",
  warnings,
});

const open = (p: Proposal = proposal(), routes: Routes = {}) =>
  mount(PATH, {
    [`GET /api/proposals/${PROPOSAL}`]: p,
    [`GET /api/proposals/${PROPOSAL}/content`]: READ,
    ...routes,
  });

const block = async (text: string) => (await screen.findByText(text)).closest("li")!;
const saveButton = () => screen.getByRole("button", { name: "Accept with my edits as v5" }) as HTMLButtonElement;

describe("a draft edited by hand", () => {
  it("says that saving accepts the draft and saves the edit on top of it", async () => {
    open();
    await block(QUILLSET);
    expect(screen.getByText(/editing the v4 draft/)).toBeTruthy();
    expect(screen.getByText("Saving accepts the draft as v4 and saves your edit as v5. Nothing is saved until then.")).toBeTruthy();
    expect(saveButton().disabled).toBe(true);
    expect(saveButton().title).toBe("Nothing has changed yet.");
  });

  it("sends only the edit made, to the draft's own route, and opens the history", async () => {
    const { api, user, pathname } = open(proposal(), { [SAVE]: saved() });

    await user.click(within(await block(REVIEW)).getByRole("button", { name: "Delete" }));
    await user.click(saveButton());

    await waitFor(() => expect(pathname()).toBe("/renders/english_resume/history"));
    expect(api.writes()).toEqual([SAVE]);
    expect(api.bodyOf("POST", `/api/proposals/${PROPOSAL}/edit`)).toEqual({
      content: { sections: [{ ...CONTENT.sections[0], blocks: [CONTENT.sections[0]!.blocks[0]] }] },
    });
  });

  it("stays on a saved panel when the save comes back with warnings, though the proposal is now accepted", async () => {
    let decided = false;
    const { user } = open(proposal(), {
      // Saving accepts it, and the refreshed read says so.
      [`GET /api/proposals/${PROPOSAL}`]: () => proposal(decided ? { status: "accepted" } : {}),
      [SAVE]: () => {
        decided = true;
        return saved(["blk-test-1 sits under a heading naming no employer."]);
      },
    });
    await user.click(within(await block(REVIEW)).getByRole("button", { name: "Delete" }));
    await user.click(saveButton());
    expect(await screen.findByText("Saved as v5.")).toBeTruthy();
    expect(screen.getByText("blk-test-1 sits under a heading naming no employer.")).toBeTruthy();
    // Still there once the refreshed proposal has answered.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByText("Saved as v5.")).toBeTruthy();
    expect(screen.queryByText(/already been decided/)).toBeNull();
  });

  it("goes back to the review on Cancel, having sent nothing", async () => {
    const { api, user, pathname } = open(proposal(), { [`GET /api/proposals/${PROPOSAL}/diff`]: { additions: 0, removals: 0, changes: [], preview: null } });
    await block(QUILLSET);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(pathname()).toBe(`/proposals/${PROPOSAL}`));
    expect(api.writes()).toEqual([]);
  });

  it("sends a draft with a drafted part to confirm back to the review, and never reads its content", async () => {
    const { api } = open(
      proposal({ drafts: [{ blockId: "blk-test-1", sectionKey: "motivation", heading: "志望動機", text: "貴社の…" }] }),
    );
    expect(await screen.findByText(/One part was drafted for you and is not confirmed yet/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Go to the review" })).toBeTruthy();
    expect(api.calls.map((c) => c.path)).not.toContain(`/api/proposals/${PROPOSAL}/content`);
  });

  it("offers the current version instead once the draft is decided", async () => {
    open(proposal({ status: "accepted" }));
    expect(await screen.findByText(/already been decided/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Edit the current version" }).getAttribute("href")).toBe(
      "/renders/english_resume/edit",
    );
  });
});

describe("the review", () => {
  const DIFF: RenderDiff = { additions: 0, removals: 0, changes: [] };
  const review = (p: Proposal) =>
    mount(`/proposals/${PROPOSAL}`, {
      [`GET /api/proposals/${PROPOSAL}`]: p,
      [`GET /api/proposals/${PROPOSAL}/diff`]: { ...DIFF, preview: null },
      [`GET /api/proposals/${PROPOSAL}/content`]: READ,
    });

  it("offers Edit draft beside Accept, and opens the editor on the draft", async () => {
    const { user, pathname } = review(proposal());
    await user.click(await screen.findByRole("button", { name: "Edit draft" }));
    await waitFor(() => expect(pathname()).toBe(PATH));
    expect(await screen.findByText(QUILLSET)).toBeTruthy();
  });

  it("holds Edit draft while a drafted part waits, as Accept is held", async () => {
    review(proposal({ drafts: [{ blockId: "blk-test-1", sectionKey: "motivation", heading: "志望動機", text: "貴社の…" }] }));
    const edit = (await screen.findByRole("button", { name: "Edit draft" })) as HTMLButtonElement;
    expect(edit.disabled).toBe(true);
    expect(edit.title).toBe("Confirm or edit each drafted part first.");
  });

  it("says where names, contact details and dates come from, with links, so they are not regenerated", async () => {
    review(proposal());
    const line = (await screen.findByText(/Every download reads them again/)).closest("p")!;
    expect(line.textContent).toContain("Your name and contact details come from your Profile");
    expect(line.textContent).toContain("each job's employer, title and dates from your Career timeline");
    expect(within(line).getByRole("link", { name: "Profile" }).getAttribute("href")).toBe("/profile");
    expect(within(line).getByRole("link", { name: "Career timeline" }).getAttribute("href")).toBe("/record");
  });
});
