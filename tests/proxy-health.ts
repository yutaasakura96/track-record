/**
 * A short budget on the suite's first query, so a wedged proxy fails the run in
 * one line instead of eight minutes.
 *
 * The application speaks Neon's HTTP protocol, so a proxy sits between the suite
 * and Postgres (`docker-compose.yml`). Sometimes it stops serving queries
 * (issue #25). Nothing fails when that happens: every database test waits out
 * its own 30s timeout and every hook waits out 120s, no assertion errors, and
 * the run looks hung rather than broken. Ten deliberate attempts over a full
 * session could not reproduce it, so there is no fix to apply here — only a way
 * to recognise it immediately and to keep the evidence the next occurrence
 * produces.
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
 * session of six full suite runs under load was 342ms; the wedge does not
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
 * The proxy is there and did not answer. This is issue #25, and the restart is
 * the only known way out of it — which is also what destroys the evidence, so
 * the capture comes first.
 */
export function proxyWedged(budgetMs: number): string {
  return [
    `The Neon HTTP proxy did not answer in ${budgetMs}ms. Nothing has been dropped.`,
    "",
    "This is issue #25: the proxy stops serving queries, and every database test",
    "then waits out its own 30s timeout with nothing failing. Stopping here costs",
    "one line instead of eight minutes.",
    "",
    "The restart below is also what erases the wedge, so capture it first:",
    "",
    "  npm run capture:proxy",
    `  docker restart ${PROXY_CONTAINER}`,
    "",
    "Then run the suite again, and attach the capture to issue #25.",
  ].join("\n");
}

/**
 * The proxy refused or was not there at all. A different fault from the wedge,
 * and a different fix: there is nothing to restart and nothing to capture.
 */
export function proxyUnreachable(error: unknown): string {
  return [
    `The Neon HTTP proxy could not be reached: ${describe(error)}. Nothing has been dropped.`,
    "",
    "This is not issue #25 — a wedged proxy accepts the connection and never",
    "answers. This one is not listening. Start the stack:",
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
