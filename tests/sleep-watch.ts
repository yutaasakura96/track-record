/**
 * Names a machine that slept during the run.
 *
 * Every stalled run recorded against issue #25 was a laptop sleeping mid-run,
 * not the proxy. Sleep suspends vitest, workerd and the Docker VM together, and
 * the test timers run on a clock that keeps counting through it. Each brief
 * DarkWake (a few seconds, every quarter of an hour or so) fires the overdue
 * 30s timer of whatever test was in flight, and the machine is asleep again
 * before the next one can finish. So the run loses about one test per file per
 * wake, fails no assertion, and looks hung. The tell is the duration: a timeout
 * reported at 900,000ms against a 30,000ms timer is a process that was not
 * running, not one waiting on a proxy. The proxy answers the moment the machine
 * is awake, and restarting it only ever looked like the cure because people
 * restart it when they are back at the machine.
 *
 * Nothing here can keep a closed lid from sleeping the Mac. What it can do is
 * notice and say so, before anyone restarts a healthy proxy. A one-second
 * interval in the main vitest process: a tick that arrives far later than it
 * was due means the process was suspended. It reports at once, keeps the gap,
 * and `tests/global-setup.ts` repeats the whole list at teardown beside the
 * failures it explains.
 *
 * It never cancels the run. Sleep while files are being transformed and
 * imported fails nothing, and cancelling there would throw away a good run.
 *
 * Pure but for the clock and the interval, both injectable, so the suite can
 * prove the gap rule without fake timers inside workerd.
 */

/** How often the watch ticks. */
export const TICK_MS = 1_000;

/**
 * How late a tick must be to count as a suspension. A loaded machine delays a
 * timer by milliseconds, a busy event loop by a second or two at worst; ten
 * seconds late is a process that was not running.
 */
export const SLEEP_GAP_MS = 10_000;

/** A stretch the process was not running, in the clock's milliseconds. */
export type Gap = { from: number; to: number };

type Watch = {
  now?: () => number;
  intervalMs?: number;
  gapMs?: number;
  report?: (message: string) => void;
};

/**
 * Starts watching. `stop` ends the watch and hands back every gap it saw, in
 * the order they happened.
 */
export function watchForSleep(watch: Watch = {}): { stop: () => Gap[] } {
  const now = watch.now ?? Date.now;
  const intervalMs = watch.intervalMs ?? TICK_MS;
  const gapMs = watch.gapMs ?? SLEEP_GAP_MS;
  const report = watch.report ?? ((message: string) => console.warn(message));

  const gaps: Gap[] = [];
  let last = now();

  const timer = setInterval(() => {
    const at = now();
    if (at - last > intervalMs + gapMs) {
      const gap = { from: last, to: at };
      gaps.push(gap);
      report(sleptMessage([gap]));
    }
    last = at;
  }, intervalMs);

  // In Node the timer is an object that can be unref'd, so the watch never
  // holds the process open on its own. The type this project compiles against
  // is the DOM's, where it is a number.
  (timer as unknown as { unref?: () => void }).unref?.();

  return {
    stop: () => {
      clearInterval(timer);
      return [...gaps];
    },
  };
}

/**
 * What a reader who has just watched a run stall needs: that the machine
 * slept, what that did to the tests, and that there is nothing to restart.
 * Times are local, to line up with `pmset -g log`.
 */
export function sleptMessage(gaps: readonly Gap[]): string {
  const total = gaps.reduce((sum, gap) => sum + (gap.to - gap.from), 0);
  const spans = gaps.map((gap) => `${clock(gap.from)}–${clock(gap.to)}`).join(", ");
  const opening =
    gaps.length === 1
      ? `This machine was asleep for ${seconds(total)} during the run (${spans}).`
      : `This machine was asleep ${gaps.length} times during the run, ${seconds(total)} in all (${spans}).`;

  return [
    opening,
    "",
    'Tests and hooks running across that window report "timed out" with',
    "durations about as long as the sleep, rather than at their timeout. That is",
    "the sleep, not the proxy or the database, and nothing needs restarting. Run",
    "the suite again with the machine awake.",
  ].join("\n");
}

function seconds(ms: number): string {
  return `${Math.round(ms / 1_000)}s`;
}

function clock(ms: number): string {
  return new Date(ms).toTimeString().slice(0, 8);
}
