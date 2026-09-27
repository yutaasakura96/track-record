/**
 * A proxy that accepts the connection and never answers costs a whole run and
 * says nothing while it does it.
 *
 * `tests/global-setup.ts` puts a clock on the suite's first query so that a
 * proxy which has stopped serving is named in one line, rather than discovered
 * minutes later by a run that never failed anything. What is worth proving is
 * the telling apart: a proxy that is silent and one that is not there are
 * different faults with different fixes, and a message that offers the wrong one
 * is worse than no message.
 */
import { describe, expect, it } from "vitest";
import { PROXY_BUDGET_MS, PROXY_CONTAINER, answerWithinBudget } from "./proxy-health";

/** Small enough to keep these tests instant; the real budget is asserted below. */
const BUDGET = 20;

const after = <T>(ms: number, value: T) =>
  new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));

const failingAfter = (ms: number, message: string) =>
  new Promise<never>((_, reject) => setTimeout(() => reject(new Error(message)), ms));

/**
 * The error a call was refused with. A call that was not refused fails here
 * rather than further down, where the assertion would be reading a message off
 * a value that was never an error.
 */
async function refusal(run: () => Promise<unknown>): Promise<Error> {
  const caught = await run().then(
    () => null,
    (error: unknown) => error as Error,
  );
  if (caught === null) throw new Error("expected the budget to refuse, and it did not");
  return caught;
}

describe("a proxy that answers", () => {
  it("hands back what the query returned", async () => {
    const rows = [{ name: "track_record_test" }];
    await expect(answerWithinBudget(() => after(1, rows), BUDGET)).resolves.toBe(rows);
  });

  it("is given the whole budget, not a fraction of it", async () => {
    // A probe answering just inside the budget is healthy, and a guard that
    // refused it would fail runs nobody could explain.
    await expect(answerWithinBudget(() => after(BUDGET - 10, "ok"), BUDGET)).resolves.toBe("ok");
  });
});

describe("a proxy that accepts the connection and never answers", () => {
  const wedged = () => answerWithinBudget(() => after(10_000, "never arrives"), BUDGET);

  it("stops the run rather than waiting", async () => {
    await expect(wedged()).rejects.toThrow(/within 20ms/);
  });

  it("says nothing has been dropped, because nothing has", async () => {
    // The drop is the next statement in `global-setup.ts`. A reader who has just
    // watched a run die needs to know the test database is still intact.
    await expect(wedged()).rejects.toThrow(/Nothing has been dropped/);
  });

  it("says what was observed, then the capture and the restart, in that order", async () => {
    const error = await refusal(wedged);
    const capture = error.message.indexOf("npm run capture:proxy");
    const restart = error.message.indexOf(`docker restart ${PROXY_CONTAINER}`);

    expect(error.message).toContain("accepted the connection and did not answer");
    expect(capture).toBeGreaterThan(-1);
    // The restart is what erases the evidence. Offering it before the capture
    // is how an occurrence teaches nothing.
    expect(restart).toBeGreaterThan(capture);
  });

  it("does not claim a cause nobody has found", async () => {
    // Every stall once blamed on the proxy was the machine sleeping. A message
    // that names a known proxy fault sends readers to restart a healthy one.
    const error = await refusal(wedged);
    expect(error.message).not.toContain("#25");
    expect(error.message).not.toMatch(/wedge/i);
  });

  it("does not offer the fix for a proxy that is not running", async () => {
    await expect(wedged()).rejects.not.toThrow(/npm run db:up/);
  });
});

describe("a proxy that is not there at all", () => {
  const absent = () =>
    answerWithinBudget(() => failingAfter(1, "fetch failed: ECONNREFUSED"), BUDGET);

  it("carries the failure's own words", async () => {
    await expect(absent()).rejects.toThrow(/ECONNREFUSED/);
  });

  it("sends the reader to the stack, not to the restart", async () => {
    const error = await refusal(absent);
    expect(error.message).toContain("npm run db:up");
    expect(error.message).not.toContain("docker restart");
    // Told to restart, a reader restarts a container that is not running and
    // learns nothing. The two faults are stated as the different things they are.
    expect(error.message).toContain("nothing to restart");
  });

  it("keeps the original failure as the cause", async () => {
    const error = await refusal(absent);
    expect((error.cause as Error).message).toBe("fetch failed: ECONNREFUSED");
  });

  it("survives a failure with nothing to say", async () => {
    await expect(
      answerWithinBudget(() => Promise.reject(new Error("")), BUDGET),
    ).rejects.toThrow(/no message/);
  });
});

describe("the probe that loses the race", () => {
  it("fails later without taking the process with it", async () => {
    // The losing probe is not cancelled — there is nothing here to cancel an
    // in-flight fetch with. If its eventual rejection escaped, it would surface
    // as an unhandled rejection long after the run had already been told why it
    // stopped, and this test would fail rather than pass quietly.
    await expect(
      answerWithinBudget(() => failingAfter(BUDGET * 2, "the proxy gave up too"), BUDGET),
    ).rejects.toThrow(/did not answer/);

    await after(BUDGET * 3, null);
  });
});

describe("the budget itself", () => {
  it("is three seconds", () => {
    // Measured across six full suite runs under load: 151 health checks, the
    // slowest 342ms. Three seconds refuses nothing healthy, and a paused proxy
    // does not answer at any budget.
    expect(PROXY_BUDGET_MS).toBe(3_000);
  });

  it("names the container docker-compose.yml actually creates", () => {
    // `docker restart` takes the container name, which compose builds from the
    // project directory and the service. A wrong name here is a message that
    // sends the reader to a command that errors.
    expect(PROXY_CONTAINER).toBe("track-record-neon-proxy-1");
  });
});
