/**
 * Every run starts from nothing, and the schema comes only from the migrations.
 * Both setups call this — the Vitest suite's and the Playwright one's — each
 * after its own guard has refused a dev database (`./database-guard.ts`).
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { neon, neonConfig } from "@neondatabase/serverless";
// The `.ts` is required, not a slip: `global-setup.ts` imports this module and
// is part of the Vite config graph (see the note there).
import { assertConnectedTo, databaseTarget } from "./database-guard.ts";
import { answerWithinBudget } from "./proxy-health.ts";
import { localProxyEndpoint } from "../src/server/db/local-proxy.ts";

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = join(here, "..", "src", "server", "db", "migrations");

export async function rebuildSchema(databaseUrl: string): Promise<void> {
  // The same proxy `createDb` sends the tests' queries to, `proxyPort` included.
  // A second stack on other ports would otherwise have its tests run against it
  // and this drop run against the default one.
  neonConfig.fetchEndpoint = localProxyEndpoint(new URL(databaseUrl));
  neonConfig.useSecureWebSocket = false;
  neonConfig.poolQueryViaFetch = true;
  const sql = neon(databaseUrl);

  // And once connected: the URL says where the query was aimed, not where it
  // landed. The proxy in between decides that. The caller's guard has already
  // refused a URL that cannot be read, so this one always runs.
  //
  // It runs under a clock, because it is also the first query of the run. A
  // proxy that answers it is serving queries; one that accepts the connection
  // and stays silent is named here in one line, rather than by every database
  // test waiting out its own timeout (`tests/proxy-health.ts`).
  const intended = databaseTarget(databaseUrl)!;
  const [row] = await answerWithinBudget(() => sql.query("select current_database() as name"));
  assertConnectedTo(intended.database, String((row as { name: string }).name));

  // Migrations are the only way the schema is built, so a migration that does
  // not apply cleanly fails the run here rather than in an unrelated assertion
  // later.
  await sql.query("drop schema if exists public cascade");
  await sql.query("create schema public");

  const files = readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const contents = readFileSync(join(MIGRATIONS, file), "utf8");
    for (const statement of contents.split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed === "") continue;
      await sql.query(trimmed);
    }
  }
}
