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
    renderRef: "english_resume",
    title: "Résumé (English)",
    applicationId: null,
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
      target: "block",
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

const FIRST_DIFF = {
  additions: 3,
  removals: 0,
  changes: [],
  preview: {
    title: "Résumé (English)",
    page: {
      stamp: null,
      name: "Mika Tanaka",
      contact: ["mika@example.invalid"],
      sections: [
        {
          heading: "Experience",
          blocks: [{ kind: "paragraph", text: "Cut the zentrel batch to nine minutes." }],
        },
      ],
    },
  },
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

  it("titles the header with the proposal's own title", async () => {
    open(proposal({ renderKind: "rirekisho", renderRef: "rirekisho", title: "履歴書" }));

    expect(await screen.findByText("履歴書")).toBeTruthy();
    expect(screen.queryByText("Résumé (English)")).toBeNull();
  });
});

describe("a heading change", () => {
  it("is selectable like any other change and carries its own rationale", async () => {
    const heading: RenderDiff["changes"][number] = {
      changeId: "chg-test-h",
      target: "heading",
      sectionKey: "chapter-1",
      currentBlockId: null,
      proposedBlockId: null,
      tokens: [
        { op: "remove", text: "Where it started" },
        { op: "add", text: "Building the ledger" },
      ],
      rationale: { kind: "heading_changed", text: "Heading rewritten, not from a fact.", factIds: [] },
    };
    mount(`/proposals/${PROPOSAL}`, {
      [`GET /api/proposals/${PROPOSAL}`]: proposal(),
      [`GET /api/proposals/${PROPOSAL}/diff`]: { additions: 1, removals: 1, changes: [heading] },
    });

    expect(await screen.findByText("Where it started")).toBeTruthy();
    expect(screen.getByText("Building the ledger")).toBeTruthy();
    expect(screen.getByText("Heading rewritten, not from a fact.")).toBeTruthy();
    expect(screen.queryByText("no matching line")).toBeNull();
  });
});

describe("a first version", () => {
  const first = () => proposal({ basedOnVersionNo: null, proposedVersionNo: 1 });
  const openFirst = (routes: Routes = {}) =>
    mount(`/proposals/${PROPOSAL}`, {
      [`GET /api/proposals/${PROPOSAL}`]: first(),
      [`GET /api/proposals/${PROPOSAL}/diff`]: FIRST_DIFF,
      ...routes,
    });

  it("is a document with Accept and Discard, not two columns against nothing", async () => {
    openFirst();

    expect(await screen.findByText("Cut the zentrel batch to nine minutes.")).toBeTruthy();
    expect(screen.getByText("Experience")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Résumé (English)" })).toBeTruthy();
    expect(screen.getByText("Mika Tanaka")).toBeTruthy();
    expect(screen.getByText("mika@example.invalid")).toBeTruthy();
    expect(screen.getByText("Accepting saves this as v1 of your Résumé (English).")).toBeTruthy();
    expect(screen.queryByText("Current")).toBeNull();
    expect(screen.queryByText("no matching line")).toBeNull();
    expect(screen.getByRole("button", { name: "Accept as v1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Discard draft" })).toBeTruthy();
  });

  it("shows the 履歴書 identity cells and address lines", async () => {
    const address = "〒150-0001 東京都渋谷区神宮前0-0-0\n架空ビル404号室";
    mount(`/proposals/${PROPOSAL}`, {
      [`GET /api/proposals/${PROPOSAL}`]: proposal({ basedOnVersionNo: null, proposedVersionNo: 1, renderKind: "rirekisho", title: "履歴書" }),
      [`GET /api/proposals/${PROPOSAL}/diff`]: {
        ...FIRST_DIFF,
        preview: {
          title: "履歴書",
          page: {
            stamp: "2026年10月18日現在",
            name: "青木　陽介",
            contact: ["ふりがな あおき　ようすけ", "性別 男", "現住所ふりがな とうきょうと しぶやく", address, "連絡先 同上"],
            sections: [],
          },
        },
      },
    });

    expect(await screen.findByRole("heading", { name: "履歴書" })).toBeTruthy();
    expect(screen.getByText("ふりがな あおき　ようすけ")).toBeTruthy();
    expect(screen.getByText("性別 男")).toBeTruthy();
    expect(screen.getByText("現住所ふりがな とうきょうと しぶやく")).toBeTruthy();
    expect(screen.getByText("連絡先 同上")).toBeTruthy();
    const addressLine = screen.getByText((_, element) => element?.textContent === address);
    expect(addressLine.classList.contains("whitespace-pre-line")).toBe(true);
  });

  it("blocks acceptance until the document loads", async () => {
    let finish!: (value: typeof FIRST_DIFF) => void;
    const pending = new Promise<typeof FIRST_DIFF>((resolve) => { finish = resolve; });
    const { api } = openFirst({ [`GET /api/proposals/${PROPOSAL}/diff`]: () => pending });

    const accept = await screen.findByRole("button", { name: "Accept as v1" });
    expect((accept as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Loading the document…")).toBeTruthy();
    expect(api.writes()).toEqual([]);

    finish(FIRST_DIFF);
    await waitFor(() => expect((accept as HTMLButtonElement).disabled).toBe(false));
  });

  it("shows a failed document read and lets the author retry", async () => {
    let attempts = 0;
    const { api, user } = openFirst({
      [`GET /api/proposals/${PROPOSAL}/diff`]: () =>
        ++attempts === 1 ? new Refusal(503, "unavailable", "The document could not be loaded.") : FIRST_DIFF,
    });

    expect((await screen.findByRole("alert")).textContent).toBe("The document could not be loaded.");
    expect((screen.getByRole("button", { name: "Accept as v1" }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Mika Tanaka")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Accept as v1" }) as HTMLButtonElement).disabled).toBe(false);
    expect(api.writes()).toEqual([]);
  });

  it("accepts, and sends nothing else", async () => {
    const { api, user, pathname } = openFirst({
      [`POST /api/proposals/${PROPOSAL}/accept`]: { newVersionNo: 1 },
    });

    await screen.findByText("Mika Tanaka");
    await user.click(await screen.findByRole("button", { name: "Accept as v1" }));

    await waitFor(() => expect(pathname()).toBe("/"));
    expect(api.writes()).toEqual([`POST /api/proposals/${PROPOSAL}/accept`]);
  });

  it("discards by dismissing", async () => {
    const { api, user } = openFirst({ [`POST /api/proposals/${PROPOSAL}/dismiss`]: dismissed });

    await user.click(await screen.findByRole("button", { name: "Discard draft" }));

    await waitFor(() => expect(api.writes()).toEqual([`POST /api/proposals/${PROPOSAL}/dismiss`]));
  });

  it("says nothing was saved once it is discarded", async () => {
    mount(`/proposals/${PROPOSAL}`, {
      [`GET /api/proposals/${PROPOSAL}`]: { ...first(), status: "dismissed" },
    });

    expect(await screen.findByText("Draft discarded — nothing was saved")).toBeTruthy();
  });
});
