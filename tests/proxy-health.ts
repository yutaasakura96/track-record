/**
 * A short budget on the suite's first query, so a proxy that does not answer
 * fails the run in one line instead of minutes of timeouts.
 *
 * The application speaks Neon's HTTP protocol, so a proxy sits between the suite
 * and Postgres (`docker-compose.yml`). If it accepts connections and stops
 * answering, nothing fails: every database test waits out its own 30s timeout
 * and every hook waits out 120s, no assertion errors, and the run looks hung
 * rather than broken. This has been produced deliberately, by pausing the proxy
 * container, and never observed on its own: every stalled run recorded against
 * issue #25 was the machine sleeping, which `./sleep-watch.ts` names. The two
 * look different. Here the timeouts stop at about 30,000ms; after a sleep they
 * run as long as the sleep did.
 *
 * The probe is not an extra round trip. `global-setup.ts` already asks
 * `current_database()` before it drops anything, to prove the proxy routed the
 * connection where the URL aimed it; this puts a clock on that same query. A
 * proxy that answers it is serving queries.
 *
 * Pure but for the clock, so the suite can prove it.
 */

/** The container `docker-compose.yml` names, as `docker restart` wants it. */
export const PROXY_CONTAINER = "track-record-neon-proxy-1";

/**
 * Long enough that no healthy answer is ever refused, short enough that the
 * unhealthy one costs nothing. The slowest of 151 health checks taken across a
 * session of six full suite runs under load was 342ms; a paused proxy does not
 * answer at all.
 */
export const PROXY_BUDGET_MS = 3_000;

/** What the race returns when the clock wins. Never a value a probe can yield. */
const EXPIRED = Symbol("the proxy health budget expired");

type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };

/**
 * Runs `probe`, and refuses the run when it does not answer inside `budgetMs`.
 *
 * A probe that loses the race is not cancelled — there is nothing to cancel an
 * in-flight `fetch` with here, and the process is about to exit anyway. It is
 * only kept from surfacing later as an unhandled rejection.
 */
export async function answerWithinBudget<T>(
  probe: () => Promise<T>,
  budgetMs: number = PROXY_BUDGET_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  // Settling both ways into a value, rather than racing a rejection, is what
  // makes the losing probe harmless.
  const running: Promise<Settled<T>> = probe().then(
    (value) => ({ ok: true, value }),
    (error: unknown) => ({ ok: false, error }),
  );

  const budget = new Promise<typeof EXPIRED>((resolve) => {
    timer = setTimeout(() => resolve(EXPIRED), budgetMs);
  });

  const outcome = await Promise.race([running, budget]);
  clearTimeout(timer);

  if (outcome === EXPIRED) throw new Error(proxyWedged(budgetMs));
  if (!outcome.ok) throw new Error(proxyUnreachable(outcome.error), { cause: outcome.error });
  return outcome.value;
}

/**
 * The proxy is there and did not answer. What was observed, and nothing more:
 * no cause has ever been found for this, because it has never happened on its
 * own. The restart is what clears it and also what destroys the evidence, so
 * the capture comes first.
 */
export function proxyWedged(budgetMs: number): string {
  return [
    `The Neon HTTP proxy accepted the connection and did not answer`,
    `select current_database() within ${budgetMs}ms. Nothing has been dropped.`,
    "",
    "Every database test would have waited out its own 30s timeout with nothing",
    "failing, so the run stops here instead.",
    "",
    "The restart below is also what erases the evidence, so capture it first:",
    "",
    "  npm run capture:proxy",
    `  docker restart ${PROXY_CONTAINER}`,
    "",
    "Then run the suite again. Read the capture before attaching it anywhere.",
  ].join("\n");
}

/**
 * The proxy refused or was not there at all. A different fault from a silent
 * proxy, and a different fix: there is nothing to restart and nothing to
 * capture.
 */
export function proxyUnreachable(error: unknown): string {
  return [
    `The Neon HTTP proxy could not be reached: ${describe(error)}. Nothing has been dropped.`,
    "",
    "It is not listening, so there is nothing to restart. Start the stack:",
    "",
    "  npm run db:up",
  ].join("\n");
}

/** The failure's own words, and not its stack. */
function describe(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const trimmed = message.trim();
  return trimmed === "" ? "no message" : trimmed;
}
