/**
 * Screen 9, Flagged (`docs/10-screen-specifications.md`, issue #57).
 *
 * The list that replaced accepting facts one at a time. What matters is that
 * reading it writes nothing and asks the AI nothing, that every flag says why,
 * that `Explain this` is one request on one press, and that the author clicks
 * into a fact only by choosing to. All fixtures are invented.
 */
import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import type { FlaggedItem, FlagsListing } from "~/client/api";
import { mount, Refusal, type Routes } from "./harness";

const item = (over: Partial<Omit<FlaggedItem, "fact">> & { fact?: Partial<FlaggedItem["fact"]> } = {}): FlaggedItem => ({
  id: "flg-test-1",
  kind: "number",
  reason: "It states a number. Check the number against the passage it was read from.",
  explanation: null,
  checked: false,
  ...over,
  fact: {
    id: "fct-test-1",
    claim: "Cut the plinth build from 40 minutes to 6",
    provenance: "measured",
    disclosure: "restricted",
    lineNumber: 12,
    importId: "sdv-test-1",
    filename: "quillset-notes.md",
    ...over.fact,
  },
});

const NUMBER = item();
const PRIVATE = item({
  id: "flg-test-2",
  kind: "confidential",
  reason: "The importer read it as confidential. It names a client's system. It is kept Private and out of every document.",
  fact: { id: "fct-test-2", claim: "Rebuilt the zentrel ledger", provenance: "attested", disclosure: "private", lineNumber: 20 },
});
const UNSURE = item({
  id: "flg-test-3",
  kind: "unsure",
  reason: "The importer was not sure about it. The passage does not say who led it.",
  fact: { id: "fct-test-3", claim: "Led the orrery migration", provenance: "attested", lineNumber: null },
});
const REPEAT = item({
  id: "flg-test-4",
  kind: "repeat",
  reason: "It likely restates a fact already in your record. Open it to see both, and reject one if they say the same thing.",
  fact: { id: "fct-test-4", claim: "Reduced the plinth build to 6 minutes" },
});

const listing = (items: FlaggedItem[], checked = 0): FlagsListing => ({ counts: { open: items.length, checked }, items });

const open = (items: FlaggedItem[], routes: Routes = {}) =>
  mount("/flagged", {
    "GET /api/flags": listing(items),
    "GET /api/imports/summary": { openCandidates: 0, openFlags: items.length, running: false },
    ...routes,
  });

const rowOf = async (claim: string) => (await screen.findByText(claim)).closest("li")!;

describe("the flagged list", () => {
  it("groups the flags by kind, what keeps a fact out of documents first, each with its reason", async () => {
    open([NUMBER, REPEAT, UNSURE, PRIVATE]);
    await screen.findByText(NUMBER.fact.claim);

    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "Kept private · 1",
      "Not sure · 1",
      "Likely a repeat · 1",
      "States a number · 1",
    ]);
    for (const flag of [NUMBER, REPEAT, UNSURE, PRIVATE]) {
      expect(within(await rowOf(flag.fact.claim)).getByText(flag.reason, { exact: false })).toBeTruthy();
    }
    expect(screen.getByRole("button", { name: "To check 4" })).toBeTruthy();
  });

  it("is read with one request, and neither writes nor asks the AI anything", async () => {
    const { api } = open([NUMBER, PRIVATE]);
    await screen.findByText(NUMBER.fact.claim);

    expect(api.writes()).toEqual([]);
    expect(api.calls.filter((c) => c.path.startsWith("/api/flags")).map((c) => `${c.method} ${c.path}`)).toEqual([
      "GET /api/flags",
    ]);
  });

  it("opens a fact on its own card only when the author clicks into it", async () => {
    const { user, pathname } = open([NUMBER], {
      "GET /api/imports/sdv-test-1": new Refusal(404, "not_found", "That import was not found."),
    });
    const link = within(await rowOf(NUMBER.fact.claim)).getByRole("link", { name: /Open it in quillset-notes\.md, line 12/ });
    expect(link.getAttribute("href")).toBe("/imports/sdv-test-1?fact=fct-test-1");
    expect(pathname()).toBe("/flagged");

    await user.click(link);
    await waitFor(() => expect(pathname()).toBe("/imports/sdv-test-1"));
  });

  it("says nothing is flagged when nothing is", async () => {
    open([]);
    expect(await screen.findByText("Nothing is flagged. Facts that need a look appear here as documents are imported.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Explain this" })).toBeNull();
  });

  it("says so when the list could not be read", async () => {
    open([], {
      "GET /api/flags": () => {
        throw new TypeError("Failed to fetch");
      },
    });
    expect((await screen.findByRole("alert")).textContent).toContain("The server could not be reached.");
  });
});

describe("Explain this", () => {
  const EXPLAIN = "POST /api/flags/flg-test-1/explain";
  const ANSWER = "The claim gives two figures.\n\nRead them against line 12.\n\nIf you do nothing, the fact stays usable.";

  it("asks once, for that flag, and shows the answer where the button was", async () => {
    const { api, user } = open([NUMBER, PRIVATE], { [EXPLAIN]: { ...NUMBER, explanation: ANSWER } });
    const row = await rowOf(NUMBER.fact.claim);
    await user.click(within(row).getByRole("button", { name: "Explain this" }));

    expect((await within(row).findByLabelText("Explanation")).textContent).toBe(ANSWER);
    expect(within(row).queryByRole("button", { name: "Explain this" })).toBeNull();
    expect(api.writes()).toEqual([EXPLAIN]);
    // The other flag was not explained, and still offers to be.
    expect(within(await rowOf(PRIVATE.fact.claim)).getByRole("button", { name: "Explain this" })).toBeTruthy();
  });

  it("shows an explanation already written, with no button and no request", async () => {
    const { api } = open([{ ...NUMBER, explanation: ANSWER }]);
    const row = await rowOf(NUMBER.fact.claim);

    expect(within(row).getByLabelText("Explanation").textContent).toBe(ANSWER);
    expect(within(row).queryByRole("button", { name: "Explain this" })).toBeNull();
    expect(api.writes()).toEqual([]);
  });

  it("shows the server's words when the AI could not answer, and offers the button again", async () => {
    const { api, user } = open([NUMBER], {
      [EXPLAIN]: new Refusal(503, "upstream_unavailable", "The explanation could not be written just now. Try again."),
    });
    const row = await rowOf(NUMBER.fact.claim);
    await user.click(within(row).getByRole("button", { name: "Explain this" }));

    expect((await within(row).findByRole("alert")).textContent).toBe("The explanation could not be written just now. Try again.");
    expect(within(row).getByRole("button", { name: "Explain this" })).toBeTruthy();
    expect(api.writes()).toEqual([EXPLAIN]);
  });
});

describe("marking a flag checked", () => {
  it("takes it off the list with one write, and changes nothing else", async () => {
    let checked = false;
    const { api, user } = open([NUMBER], {
      "GET /api/flags": () => (checked ? listing([], 1) : listing([NUMBER])),
      "POST /api/flags/flg-test-1/check": () => {
        checked = true;
        return { ...NUMBER, checked: true };
      },
    });
    await user.click(within(await rowOf(NUMBER.fact.claim)).getByRole("button", { name: "Mark as checked" }));

    expect(await screen.findByRole("button", { name: "Checked 1" })).toBeTruthy();
    expect(screen.queryByText(NUMBER.fact.claim)).toBeNull();
    expect(api.writes()).toEqual(["POST /api/flags/flg-test-1/check"]);
  });

  it("lists the checked ones on their own, and puts one back with one write", async () => {
    const { api, user } = open([], {
      "GET /api/flags": listing([], 1),
      "GET /api/flags?state=checked": { counts: { open: 0, checked: 1 }, items: [{ ...NUMBER, checked: true }] },
      "POST /api/flags/flg-test-1/uncheck": NUMBER,
    });
    await user.click(await screen.findByRole("button", { name: "Checked 1" }));
    await user.click(within(await rowOf(NUMBER.fact.claim)).getByRole("button", { name: "Put back on the list" }));

    await waitFor(() => expect(api.writes()).toEqual(["POST /api/flags/flg-test-1/uncheck"]));
  });
});
