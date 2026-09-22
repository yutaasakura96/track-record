/**
 * Screen 2, Diff Review (`docs/10-screen-specifications.md`).
 *
 * The gate that makes generation safe, so what matters is which decision a
 * button sends and in what order: an accept sent as a dismiss, a failed
 * proposal left pending, or a retry that dismisses before it knows the new
 * generation started would all leave the screen looking normal.
 * All fixtures are invented.
 */
import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import type { Proposal, RenderDiff } from "~/client/api";
import { mount, Refusal, toneOf, type Routes } from "./harness";

const PROPOSAL = "prop-test-1";

function proposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    id: PROPOSAL,
    renderKind: "english_resume",
    status: "pending",
    generationStatus: "ready",
    error: null,
    basedOnVersionNo: 3,
    proposedVersionNo: 4,
    generatedAt: "2026-09-01T00:00:00.000Z",
    reason: null,
    warnings: [],
    unchanged: false,
    withheld: { privateFactCount: 0, generatedFactCount: 0 },
    ...overrides,
  };
}

const DIFF: RenderDiff = {
  additions: 1,
  removals: 1,
  changes: [
    {
      changeId: "chg-test-1",
      sectionKey: "experience",
      currentBlockId: "blk-test-1",
      proposedBlockId: "blk-test-2",
      tokens: [
        { op: "equal", text: "Cut the zentrel batch to " },
        { op: "remove", text: "12" },
        { op: "add", text: "9" },
        { op: "equal", text: " minutes." },
      ],
      rationale: { kind: "fact_changed", text: "A fact was edited.", factIds: ["f-test-1"] },
    },
  ],
};

const open = (p: Proposal, routes: Routes = {}) =>
  mount(`/proposals/${PROPOSAL}`, {
    [`GET /api/proposals/${PROPOSAL}`]: p,
    [`GET /api/proposals/${PROPOSAL}/diff`]: DIFF,
    ...routes,
  });

const accepted = { newVersionNo: 4 };
const dismissed = { status: "dismissed" };

describe("a pending proposal", () => {
  it("accepts, and sends nothing else", async () => {
    const { api, user, pathname } = open(proposal(), {
      [`POST /api/proposals/${PROPOSAL}/accept`]: accepted,
    });

    await user.click(await screen.findByRole("button", { name: "Accept proposed version" }));

    await waitFor(() => expect(pathname()).toBe("/"));
    expect(api.writes()).toEqual([`POST /api/proposals/${PROPOSAL}/accept`]);
  });

  it("keeps the current version by dismissing, and sends nothing else", async () => {
    const { api, user, pathname } = open(proposal(), {
      [`POST /api/proposals/${PROPOSAL}/dismiss`]: dismissed,
    });

    await user.click(await screen.findByRole("button", { name: "Keep current version" }));

    await waitFor(() => expect(pathname()).toBe("/"));
    expect(api.writes()).toEqual([`POST /api/proposals/${PROPOSAL}/dismiss`]);
  });

  it.each([
    ["Accept proposed version", "accept"],
    ["Keep current version", "dismiss"],
  ])("says so and stays when %s is refused", async (button, decision) => {
    const { api, user, pathname } = open(proposal(), {
      [`POST /api/proposals/${PROPOSAL}/${decision}`]: new Refusal(409, "conflict", "A newer proposal exists."),
    });

    await user.click(await screen.findByRole("button", { name: button }));

    expect((await screen.findByRole("alert")).textContent).toBe("A newer proposal exists.");
    expect(toneOf(screen.getByRole("alert"))).toBe("removed");
    expect(api.writes()).toEqual([`POST /api/proposals/${PROPOSAL}/${decision}`]);
    expect(pathname()).toBe(`/proposals/${PROPOSAL}`);
  });

  it("names the versions and what was withheld, in the right number", async () => {
    open(proposal({ withheld: { privateFactCount: 1, generatedFactCount: 2 } }));

    expect(await screen.findByText("Accepting replaces your Résumé (English) with v4.")).toBeTruthy();
    expect(
      screen.getByText(
        "v3 and every earlier version stay restorable. 1 private fact in your record was not used. 2 unverified facts were left out until promoted.",
      ),
    ).toBeTruthy();
  });

  it("opens on the first change rather than on an empty rationale", async () => {
    open(proposal());

    expect(await screen.findByText("Change 1 of 1")).toBeTruthy();
    expect(screen.getByText("A fact was edited.")).toBeTruthy();
  });
});

describe("a failed generation", () => {
  const failed = (overrides: Partial<Proposal> = {}) =>
    proposal({
      status: "failed",
      generationStatus: "failed",
      error: { code: "model_unavailable", message: "The model stopped answering." },
      ...overrides,
    });

  it("tries again by generating first, then dismissing, then opening the new proposal", async () => {
    const { api, user, pathname } = open(failed(), {
      "POST /api/renders/english_resume/generate": { proposalId: "prop-test-2" },
      [`POST /api/proposals/${PROPOSAL}/dismiss`]: dismissed,
    });

    await user.click(await screen.findByRole("button", { name: "Try again" }));

    await waitFor(() => expect(pathname()).toBe("/proposals/prop-test-2"));
    expect(api.writes()).toEqual([
      "POST /api/renders/english_resume/generate",
      `POST /api/proposals/${PROPOSAL}/dismiss`,
    ]);
  });

  it("leaves the failed proposal alone when the new generation cannot start", async () => {
    const { api, user, pathname } = open(failed(), {
      "POST /api/renders/english_resume/generate": new Refusal(409, "conflict", "A generation is already running."),
    });

    await user.click(await screen.findByRole("button", { name: "Try again" }));

    expect((await screen.findByRole("alert")).textContent).toBe("A generation is already running.");
    expect(toneOf(screen.getByRole("alert"))).toBe("text-secondary");
    expect(api.writes()).toEqual(["POST /api/renders/english_resume/generate"]);
    expect(pathname()).toBe(`/proposals/${PROPOSAL}`);
  });

  it("goes back even when the dismiss is refused", async () => {
    const { api, user, pathname } = open(failed(), {
      [`POST /api/proposals/${PROPOSAL}/dismiss`]: new Refusal(409, "conflict", "Already decided."),
    });

    await user.click(await screen.findByRole("button", { name: "Back to your record" }));

    await waitFor(() => expect(pathname()).toBe("/"));
    expect(api.writes()).toEqual([`POST /api/proposals/${PROPOSAL}/dismiss`]);
  });

  it("offers the current version when there is one", async () => {
    open(failed());

    expect(await screen.findByText(/Your current version is unchanged and still readable\./)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Download the current version" })).toBeTruthy();
  });

  it("promises no current version on a first generation", async () => {
    open(failed({ basedOnVersionNo: null, proposedVersionNo: 1 }));

    expect(await screen.findByText(/Nothing was saved, and your record is unchanged\./)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Download the current version" })).toBeNull();
    expect(screen.queryByText(/still readable/)).toBeNull();
  });
});

describe("the other states", () => {
  it("dismisses an unchanged proposal on the way back", async () => {
    const { api, user, pathname } = open(proposal({ unchanged: true }), {
      [`POST /api/proposals/${PROPOSAL}/dismiss`]: dismissed,
    });

    expect(await screen.findByText("Already up to date with your record.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Back to your record" }));

    await waitFor(() => expect(pathname()).toBe("/"));
    expect(api.writes()).toEqual([`POST /api/proposals/${PROPOSAL}/dismiss`]);
  });

  it("says so and stays when dismissing an unchanged proposal is refused", async () => {
    const { user, pathname } = open(proposal({ unchanged: true }), {
      [`POST /api/proposals/${PROPOSAL}/dismiss`]: new Refusal(409, "conflict", "Already decided."),
    });

    await user.click(await screen.findByRole("button", { name: "Back to your record" }));

    expect((await screen.findByRole("alert")).textContent).toBe("Already decided.");
    expect(toneOf(screen.getByRole("alert"))).toBe("text-secondary");
    expect(pathname()).toBe(`/proposals/${PROPOSAL}`);
  });

  it("does not promise a current version while writing the first one", async () => {
    open(proposal({ status: "generating", generationStatus: "generating", basedOnVersionNo: null, proposedVersionNo: 1 }));

    expect(await screen.findByText("Writing the first version. Nothing is saved until you accept it.")).toBeTruthy();
  });

  it("reassures about the current version while writing a later one", async () => {
    open(proposal({ status: "generating", generationStatus: "generating" }));

    expect(
      await screen.findByText("Writing the proposed version. Your current version is untouched and still downloadable."),
    ).toBeTruthy();
  });

  it("shows a decided proposal as decided, and sends nothing", async () => {
    const { api } = open(proposal({ status: "dismissed" }));

    expect(await screen.findByText("Proposal dismissed — v3 kept")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Accept proposed version" })).toBeNull();
    expect(api.writes()).toEqual([]);
  });

  it("titles the header with the proposal's own render kind", async () => {
    open(proposal({ renderKind: "rirekisho" }));

    expect(await screen.findByText("履歴書")).toBeTruthy();
    expect(screen.queryByText("Résumé (English)")).toBeNull();
  });
});
