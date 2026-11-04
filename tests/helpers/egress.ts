/**
 * What the database sends back, measured where Neon would bill it.
 *
 * Every query the application makes is an HTTPS request to the database's
 * `/sql` endpoint (`~/server/db/client.ts`), and its response body is the
 * transfer Neon counts against the plan's network allowance. This wraps the
 * global `fetch` the driver reaches through, for the length of one piece of
 * work, and sums those bodies: their bytes, their rows and how many requests
 * carried them.
 *
 * Counts only. The bodies are read for their length and their row count, and
 * nothing in them is kept or printed.
 */

export interface Egress {
  /** Requests to the database's `/sql` endpoint. A batch is one. */
  requests: number;
  /** Rows across every result, a batch's statements included. */
  rows: number;
  /** Response body bytes, as the driver received them. */
  bytes: number;
}

const isQuery = (input: RequestInfo | URL): boolean => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  return new URL(url).pathname === "/sql";
};

const rowsIn = (body: unknown): number => {
  if (body === null || typeof body !== "object") return 0;
  const shaped = body as { rows?: unknown[]; results?: { rows?: unknown[] }[] };
  if (Array.isArray(shaped.results)) return shaped.results.reduce((sum, result) => sum + (result.rows?.length ?? 0), 0);
  return Array.isArray(shaped.rows) ? shaped.rows.length : 0;
};

/**
 * Runs `work` and returns what the database sent while it ran. `work` must be
 * everything that reads, `waitUntil` work included: the meter is the global
 * `fetch`, so whatever runs in the window is counted.
 */
export async function metered<T>(work: () => Promise<T>): Promise<Egress & { result: T }> {
  const totals: Egress = { requests: 0, rows: 0, bytes: 0 };
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await original(input, init);
    if (!isQuery(input)) return response;
    const text = await response.clone().text();
    totals.requests++;
    totals.bytes += new TextEncoder().encode(text).length;
    try {
      totals.rows += rowsIn(JSON.parse(text));
    } catch {
      // An error body is still transfer; it carries no rows.
    }
    return response;
  }) as typeof fetch;
  try {
    const result = await work();
    return { ...totals, result };
  } finally {
    globalThis.fetch = original;
  }
}
