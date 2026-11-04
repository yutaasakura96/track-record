/**
 * How often a screen reads a resource that is still running (`docs/06`,
 * 2026-11-04): every 1.5 s while its answer changes, less often while it does
 * not, and not at all once it has been still for longer than either Workflow's
 * step can run. A screen left open on a run that never finished otherwise read
 * the database every 1.5 s for as long as the tab was visible.
 */
import { describe, expect, it } from "vitest";
import { POLL_MS, pollInterval } from "~/client/api";

const MINUTE = 60_000;
const query = (data: unknown) => ({ state: { data } });

describe("polling a running resource", () => {
  it("reads every 1.5 s while the answer keeps changing, however long it runs", () => {
    const q = query({ chunksDone: 0 });
    expect(pollInterval(q, true, 0)).toBe(POLL_MS);
    for (let minute = 1; minute <= 120; minute++) {
      q.state.data = { chunksDone: minute };
      expect(pollInterval(q, true, minute * MINUTE)).toBe(POLL_MS);
    }
  });

  it("backs off while nothing changes, and stops after 75 minutes", () => {
    const q = query({ status: "generating" });
    expect(pollInterval(q, true, 0)).toBe(POLL_MS);
    expect(pollInterval(q, true, 59_000)).toBe(POLL_MS);
    expect(pollInterval(q, true, MINUTE)).toBe(5_000);
    expect(pollInterval(q, true, 5 * MINUTE)).toBe(15_000);
    expect(pollInterval(q, true, 15 * MINUTE)).toBe(60_000);
    expect(pollInterval(q, true, 74 * MINUTE)).toBe(60_000);
    expect(pollInterval(q, true, 75 * MINUTE)).toBe(false);
  });

  it("starts again at 1.5 s when the answer moves", () => {
    const q = query({ chunksDone: 1 });
    pollInterval(q, true, 0);
    expect(pollInterval(q, true, 10 * MINUTE)).toBe(15_000);
    q.state.data = { chunksDone: 2 };
    expect(pollInterval(q, true, 10 * MINUTE)).toBe(POLL_MS);
    expect(pollInterval(q, true, 10 * MINUTE + 30_000)).toBe(POLL_MS);
  });

  it("does not poll a finished resource, and forgets how long it waited", () => {
    const q = query({ status: "generating" });
    pollInterval(q, true, 0);
    expect(pollInterval(q, true, 80 * MINUTE)).toBe(false);
    expect(pollInterval(q, false, 80 * MINUTE)).toBe(false);
    // Running again, it is a new wait.
    expect(pollInterval(q, true, 81 * MINUTE)).toBe(POLL_MS);
  });

  it("keeps each resource's wait to itself", () => {
    const a = query({ n: 1 });
    const b = query({ n: 1 });
    pollInterval(a, true, 0);
    expect(pollInterval(a, true, 20 * MINUTE)).toBe(60_000);
    expect(pollInterval(b, true, 20 * MINUTE)).toBe(POLL_MS);
  });
});
