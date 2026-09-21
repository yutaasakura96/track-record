/**
 * Names a wedged Neon proxy in the dev worker's log (issue #25).
 *
 * The local stack puts a Neon HTTP proxy in front of plain Postgres, and
 * sometimes it stops serving queries: it accepts the connection and never
 * answers. The suite already recognises that in one line
 * (`tests/proxy-health.ts`). The dev worker did not. A page just spins, the
 * worker prints nothing, and the reflex is `docker restart`, which clears the
 * wedge and erases the only evidence it has ever left behind.
 *
 * So every query the driver sends through the local proxy is watched. One that
 * has not answered after `SLOW_MS` is not proof of anything, because a query can
 * be slow. What tells the two apart is a second, trivial query: a proxy that
 * cannot answer `select 1` inside `PROBE_BUDGET_MS` is not serving at all. Only
 * then does the log say so, once, with the capture before the restart.
 *
 * The watched query is never cancelled or failed. It is left to finish or hang
 * exactly as it would have. This changes what the log says and nothing else.
 *
 * Production never gets here: `createDb` installs this only for local hosts.
 */

/** The container `docker-compose.yml` names, as `docker restart` wants it. */
const PROXY_CONTAINER = "track-record-neon-proxy-1";

/**
 * How long a query runs before the proxy is asked whether it is still there.
 * The slowest of 151 `select 1` health checks across six loaded suite runs was
 * 342ms, and the dev record is small; a query past this is unusual enough to
 * spend one probe on.
 */
export const SLOW_MS = 3_000;

/** The same budget the suite gives its first query (`tests/proxy-health.ts`). */
export const PROBE_BUDGET_MS = 3_000;

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

type Watch = {
  slowMs?: number;
  probeBudgetMs?: number;
  report?: (message: string) => void;
};

/**
 * Wraps the fetch the Neon driver sends queries with.
 *
 * State lives in the returned closure, so it lasts as long as the isolate that
 * holds it: one probe in flight at a time, and one report per wedge. The report
 * is armed again by the next query that answers, which after a restart is the
 * first one.
 */
export function watchProxy(fetchImpl: Fetch, watch: Watch = {}): Fetch {
  const slowMs = watch.slowMs ?? SLOW_MS;
  const probeBudgetMs = watch.probeBudgetMs ?? PROBE_BUDGET_MS;
  const report = watch.report ?? ((message: string) => console.error(message));

  let probing = false;
  let reported = false;

  async function probe(input: string, init: RequestInit | undefined) {
    if (probing || reported) return;
    probing = true;
    try {
      const answered = await withinBudget(
        fetchImpl(input, {
          method: "POST",
          headers: { "Neon-Connection-String": connectionString(init) },
          body: JSON.stringify({ query: "select 1", params: [] }),
        }),
        probeBudgetMs,
      );
      if (answered || reported) return;
      reported = true;
      report(proxyWedged(slowMs, probeBudgetMs));
    } finally {
      probing = false;
    }
  }

  return async (input, init) => {
    const timer = setTimeout(() => void probe(input, init), slowMs);
    try {
      const response = await fetchImpl(input, init);
      reported = false;
      return response;
    } finally {
      clearTimeout(timer);
    }
  };
}

/**
 * Whether `request` settled inside `budgetMs`. A refusal counts as an answer:
 * a proxy that says no is listening, and that is a different fault which the
 * watched query will surface on its own.
 */
async function withinBudget(request: Promise<unknown>, budgetMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const settled = request.then(
    () => true,
    () => true,
  );
  const expired = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), budgetMs);
  });
  const answered = await Promise.race([settled, expired]);
  clearTimeout(timer);
  return answered;
}

/** The driver sends its headers as a plain object (`@neondatabase/serverless` 1.1.0). */
function connectionString(init: RequestInit | undefined): string {
  const headers = new Headers(init?.headers);
  return headers.get("Neon-Connection-String") ?? "";
}

/**
 * Carries no query, no connection string and nothing from the record: the
 * fixed text below and two numbers.
 */
export function proxyWedged(slowMs: number, probeBudgetMs: number): string {
  return [
    `A query through the Neon HTTP proxy has not answered in ${slowMs}ms, and a`,
    `select 1 sent after it did not answer in ${probeBudgetMs}ms either.`,
    "",
    "This is issue #25: the proxy has stopped serving queries. Every request that",
    "reaches the database will now hang without an error.",
    "",
    "The restart below is also what erases the wedge, so capture it first:",
    "",
    "  npm run capture:proxy",
    `  docker restart ${PROXY_CONTAINER}`,
    "",
    "Then attach the capture to issue #25, after reading it.",
  ].join("\n");
}
