/**
 * The dev worker's half of the proxy health check: a proxy that has stopped
 * answering named in the worker's log instead of a page that spins in silence.
 *
 * What is worth proving is the telling apart. A slow query is not a silent
 * proxy, and a log that cried proxy at every slow query would be ignored by the
 * time a real one came. So the report must need both a slow query and a probe that also goes
 * unanswered, and it must come once per silence, not once per hanging request.
 */
import { describe, expect, it } from "vitest";
import { PROBE_BUDGET_MS, SLOW_MS, watchProxy } from "~/server/db/proxy-watch";

/** Small enough to keep these tests instant; the real budgets are asserted below. */
const SLOW = 10;
const BUDGET = 10;

const ENDPOINT = "http://localhost:4444/sql";
const CONNECTION = "postgresql://fixture_user:secret@localhost:5432/watch_fixture_db";

const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const never = () => new Promise<Response>(() => {});
const answer = (ms = 0) => settle(ms).then(() => new Response("{}"));

type Reply = () => Promise<Response>;

/**
 * A proxy that replies to the watched query and to the probe separately, and
 * remembers what it was sent.
 */
function proxy(replies: { query: Reply; probe: Reply }) {
  const sent: string[] = [];
  const fetchImpl = (_input: string, init?: RequestInit) => {
    const body = String(init?.body);
    sent.push(body);
    return body.includes("select 1") ? replies.probe() : replies.query();
  };
  return { fetchImpl, sent };
}

function watched(replies: { query: Reply; probe: Reply }) {
  const reports: string[] = [];
  const { fetchImpl, sent } = proxy(replies);
  const fetch = watchProxy(fetchImpl, {
    slowMs: SLOW,
    probeBudgetMs: BUDGET,
    report: (message) => reports.push(message),
  });
  const query = () =>
    fetch(ENDPOINT, {
      method: "POST",
      headers: { "Neon-Connection-String": CONNECTION },
      body: JSON.stringify({ query: "select * from facts", params: [] }),
    });
  const probes = () => sent.filter((body) => body.includes("select 1")).length;
  return { query, reports, probes };
}

/** Long enough for a slow query to trigger its probe and the probe to run out. */
const OUTLAST = SLOW + BUDGET + 30;

describe("a proxy that answers", () => {
  it("hands back the response and never probes", async () => {
    const proxy = watched({ query: () => answer(), probe: never });
    const response = await proxy.query();
    await settle(OUTLAST);
    expect(response.status).toBe(200);
    expect(proxy.probes()).toBe(0);
    expect(proxy.reports).toEqual([]);
  });
});

describe("a query that is only slow", () => {
  it("probes once and says nothing, because the probe answered", async () => {
    const proxy = watched({ query: () => answer(OUTLAST), probe: () => answer() });
    await proxy.query();
    expect(proxy.probes()).toBe(1);
    expect(proxy.reports).toEqual([]);
  });

  it("says nothing when the probe is refused, because a refusal is not silence", async () => {
    const proxy = watched({
      query: () => answer(OUTLAST),
      probe: () => Promise.reject(new TypeError("connection refused")),
    });
    await proxy.query();
    expect(proxy.reports).toEqual([]);
  });
});

describe("a proxy that has stopped answering", () => {
  it("is named once, with the capture before the restart", async () => {
    const proxy = watched({ query: never, probe: never });
    void proxy.query();
    await settle(OUTLAST);

    expect(proxy.reports).toHaveLength(1);
    const [report] = proxy.reports;
    expect(report).toContain("Neither has been answered or refused");
    expect(report).not.toContain("#25");
    const capture = report!.indexOf("npm run capture:proxy");
    const restart = report!.indexOf("docker restart track-record-neon-proxy-1");
    expect(capture).toBeGreaterThan(-1);
    expect(restart).toBeGreaterThan(capture);
  });

  it("does not fail the query it was watching", async () => {
    const proxy = watched({ query: never, probe: never });
    let settled = false;
    void proxy.query().finally(() => (settled = true));
    await settle(OUTLAST);
    expect(proxy.reports).toHaveLength(1);
    expect(settled).toBe(false);
  });

  it("is not named again by every request that hangs behind it", async () => {
    const proxy = watched({ query: never, probe: never });
    void proxy.query();
    await settle(OUTLAST);
    void proxy.query();
    void proxy.query();
    await settle(OUTLAST);
    expect(proxy.reports).toHaveLength(1);
  });

  it("is named again after the proxy has answered in between", async () => {
    let wedged = true;
    const proxy = watched({ query: () => (wedged ? never() : answer()), probe: never });
    void proxy.query();
    await settle(OUTLAST);

    wedged = false;
    await proxy.query();

    wedged = true;
    void proxy.query();
    await settle(OUTLAST);
    expect(proxy.reports).toHaveLength(2);
  });

  it("keeps the connection string out of the log", async () => {
    const proxy = watched({ query: never, probe: never });
    void proxy.query();
    await settle(OUTLAST);
    expect(proxy.reports[0]).not.toContain("secret");
    expect(proxy.reports[0]).not.toContain("watch_fixture_db");
  });
});

describe("the real budgets", () => {
  // The slowest of 151 `select 1` checks under a loaded suite run was 342ms.
  // Either budget below a second would start naming a healthy proxy.
  it("leave room for a healthy proxy under load", () => {
    expect(SLOW_MS).toBeGreaterThanOrEqual(1_000);
    expect(PROBE_BUDGET_MS).toBeGreaterThanOrEqual(1_000);
  });
});
