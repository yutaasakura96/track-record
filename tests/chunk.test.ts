/**
 * Chunk planning, steps 3 and 4 of the import pipeline (`docs/03-technical-design.md` §5).
 *
 * The import tests reach this over HTTP. These pin the plan itself: which
 * regions of a re-import are sent to the model, and the changed share that the
 * import status reports. They also hold planning to one line diff per import;
 * the diff is the expensive part, and the regions and the share come from the
 * same comparison.
 *
 * Every fixture here is invented.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const diffCalls = vi.hoisted(() => ({ count: 0 }));

vi.mock("diff", async (importOriginal) => {
  const actual = await importOriginal<typeof import("diff")>();
  return {
    ...actual,
    diffLines: (...args: Parameters<typeof actual.diffLines>) => {
      diffCalls.count += 1;
      return actual.diffLines(...args);
    },
  };
});

const { planChunks } = await import("~/pipeline/chunk");

const FIRST = "Qorvane plinth rollout.\n\nZentrel quillset audit.\n";
const ADDED = "Vorbit ledger migration.\n\n";

describe("planChunks", () => {
  beforeEach(() => {
    diffCalls.count = 0;
  });

  it("plans the whole document on a first import and reports no share", () => {
    const plan = planChunks(FIRST, null);
    expect(plan.chunks).toEqual([{ start: 0, end: FIRST.length }]);
    expect(plan.changedRegionShare).toBeNull();
  });

  it("plans nothing for an unchanged version", () => {
    const plan = planChunks(FIRST, FIRST);
    expect(plan.chunks).toEqual([]);
    expect(plan.changedRegionShare).toBe(0);
  });

  it("plans only the added passage and counts it in the share", () => {
    const text = ADDED + FIRST;
    const plan = planChunks(text, FIRST);
    expect(plan.chunks).toEqual([{ start: 0, end: ADDED.length }]);
    expect(plan.changedRegionShare).toBe(ADDED.length / text.length);
  });

  it("reports a deletion in the share though it plans no chunk", () => {
    const previous = ADDED + FIRST;
    const plan = planChunks(FIRST, previous);
    expect(plan.chunks).toEqual([]);
    expect(plan.changedRegionShare).toBe(ADDED.length / previous.length);
  });

  it("diffs the two versions once per plan", () => {
    planChunks(ADDED + FIRST, FIRST);
    expect(diffCalls.count).toBe(1);
  });
});
