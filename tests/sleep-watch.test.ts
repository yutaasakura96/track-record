/**
 * A laptop that sleeps mid-run looks like a proxy that stopped answering: tests
 * time out, nothing fails an assertion, and the reflex is to restart a proxy
 * that was healthy all along (issue #25). `tests/sleep-watch.ts` names the
 * sleep instead.
 *
 * What is worth proving is the gap rule. A late tick is normal on a loaded
 * machine, and a watch that reported one would teach readers to ignore it; a
 * tick far later than it was due is a process that was not running. The clock
 * is injected and moved by hand, so a gap is a number here rather than a real
 * suspension, and no fake timers run inside workerd.
 */
import { describe, expect, it } from "vitest";
import { SLEEP_GAP_MS, TICK_MS, sleptMessage, watchForSleep } from "./sleep-watch";

/** Small enough to keep these tests instant; the real values are asserted below. */
const INTERVAL = 5;
const GAP = 1_000;

const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Long enough for several real ticks of the injected interval. */
const TICKS = INTERVAL * 6;

/** A watch over a clock that only moves when the test moves it. */
function watched() {
  let time = 1_000_000;
  const reports: string[] = [];
  const watch = watchForSleep({
    now: () => time,
    intervalMs: INTERVAL,
    gapMs: GAP,
    report: (message) => reports.push(message),
  });
  return {
    reports,
    stop: watch.stop,
    advance: (ms: number) => {
      time += ms;
    },
    get time() {
      return time;
    },
  };
}

describe("a machine that stays awake", () => {
  it("reports nothing", async () => {
    const watch = watched();
    await settle(TICKS);
    expect(watch.stop()).toEqual([]);
    expect(watch.reports).toEqual([]);
  });

  it("reports nothing for a tick late by up to the gap", async () => {
    // A busy event loop delays a tick. Only a delay past the gap is a sleep.
    const watch = watched();
    await settle(TICKS);
    watch.advance(INTERVAL + GAP);
    await settle(TICKS);
    expect(watch.stop()).toEqual([]);
    expect(watch.reports).toEqual([]);
  });
});

describe("a machine that sleeps", () => {
  it("is reported at once, with the length of the sleep", async () => {
    const watch = watched();
    await settle(TICKS);
    watch.advance(900_000);
    await settle(TICKS);

    expect(watch.reports).toHaveLength(1);
    expect(watch.reports[0]).toContain("asleep for 900s");
    watch.stop();
  });

  it("keeps each gap, from the last tick before it to the first after", async () => {
    const watch = watched();
    await settle(TICKS);
    const before = watch.time;
    watch.advance(900_000);
    await settle(TICKS);
    watch.advance(600_000);
    await settle(TICKS);

    const gaps = watch.stop();
    expect(gaps).toEqual([
      { from: before, to: before + 900_000 },
      { from: before + 900_000, to: before + 1_500_000 },
    ]);
    expect(watch.reports).toHaveLength(2);
  });

  it("stops watching when stopped", async () => {
    const watch = watched();
    watch.stop();
    watch.advance(900_000);
    await settle(TICKS);
    expect(watch.reports).toEqual([]);
  });
});

describe("what the reader is told", () => {
  const nine = { from: 0, to: 900_000 };
  const ten = { from: 1_000_000, to: 1_600_000 };

  it("names the sleep, not the proxy, and says there is nothing to restart", () => {
    const message = sleptMessage([nine]);
    expect(message).toContain("This machine was asleep for 900s");
    expect(message).toContain("not the proxy or the database");
    expect(message).toContain("nothing needs restarting");
    expect(message).toContain("with the machine awake");
    expect(message).not.toContain("docker restart");
  });

  it("explains the durations that give the sleep away", () => {
    expect(sleptMessage([nine])).toContain("durations about as long as the sleep");
    expect(sleptMessage([nine])).toContain("rather than at their timeout");
  });

  it("counts several sleeps and adds them up", () => {
    expect(sleptMessage([nine, ten])).toContain("asleep 2 times during the run, 1500s in all");
  });
});

describe("the real values", () => {
  it("ticks every second and calls ten seconds late a sleep", () => {
    // The DarkWakes that fail tests come every thirteen minutes or so, so a
    // ten-second gap misses no real sleep, and no busy event loop comes near it.
    expect(TICK_MS).toBe(1_000);
    expect(SLEEP_GAP_MS).toBe(10_000);
  });
});
