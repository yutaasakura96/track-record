/**
 * The database handle.
 *
 * HTTP mode, deliberately. Interactive transactions would need WebSockets, and
 * a WebSocket Pool cannot outlive a single request handler in Workers
 * (`docs/03-technical-design.md` §5). Multi-statement writes therefore go
 * through `db.batch([...])`, which the neon-http driver executes as a genuine
 * single non-interactive transaction.
 */
import { neon, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

export type Db = ReturnType<typeof createDb>;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "db.localtest.me", "postgres"]);

export function createDb(connectionString: string) {
  // A missing binding otherwise surfaces as `Invalid URL string` on every route,
  // which reads as an application bug rather than as unset configuration.
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Locally, copy .dev.vars.example to .dev.vars; in production, `wrangler secret put DATABASE_URL`.",
    );
  }
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("DATABASE_URL is not a valid connection string.");
  }
  if (LOCAL_HOSTS.has(url.hostname)) {
    // Plain Postgres does not speak Neon's HTTP protocol. Local and CI runs put
    // the Neon HTTP proxy from docker-compose.yml in front of it — without this,
    // every database test fails at connection time (`docs/11` §1).
    const proxyPort = url.searchParams.get("proxyPort") ?? "4444";
    neonConfig.fetchEndpoint = `http://${url.hostname}:${proxyPort}/sql`;
    neonConfig.useSecureWebSocket = false;
    neonConfig.poolQueryViaFetch = true;
  }
  return drizzle(neon(connectionString), { schema, casing: "snake_case" });
}
