/**
 * Applies the committed migrations to the test database, once per run.
 *
 * A REAL Postgres, not an in-memory fake: the isolation guarantee this project
 * depends on is enforced by SQL, and a fake that does not run the query proves
 * nothing about the query (`docs/11-testing-plan.md` §1).
 *
 * The application speaks Neon's HTTP protocol, which plain Postgres does not
 * implement — hence the proxy in docker-compose.yml.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { neon, neonConfig } from "@neondatabase/serverless";
// The `.ts` is required, not a slip: `vitest.config.ts` imports this module, so
// it is part of the Vite config graph, which resolves extensionless relative
// imports only under the legacy config loader. `vitest.config.ts` spells its own
// import of this file the same way.
import { assertConnectedTo, assertSuiteDatabaseIsNotDev, databaseTarget } from "./database-guard.ts";

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = join(here, "..", "src", "server", "db", "migrations");
const DEV_VARS = join(here, "..", ".dev.vars");

/**
 * The suite has a database of its own — `track_record_test`, beside the
 * `track_record_dev` the dev worker uses. Both live in the docker-compose
 * Postgres; one Neon proxy serves both, because it honours the database named
 * by each client (`docker-compose.yml`, issue #4).
 */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/track_record_test?sslmode=require";

export default async function setup() {
  // Before anything connects: the drop below is total, and a dev database on
  // the other end of this URL loses everything it holds. Both places a dev
  // DATABASE_URL can come from are checked — the file `wrangler dev` reads, and
  // the environment a shell can put in front of it.
  assertSuiteDatabaseIsNotDev(
    TEST_DATABASE_URL,
    existsSync(DEV_VARS) ? readFileSync(DEV_VARS, "utf8") : null,
    process.env.DATABASE_URL ?? null,
  );

  neonConfig.fetchEndpoint = "http://localhost:4444/sql";
  neonConfig.useSecureWebSocket = false;
  neonConfig.poolQueryViaFetch = true;
  const sql = neon(TEST_DATABASE_URL);

  // And once connected: the URL says where the query was aimed, not where it
  // landed. The proxy in between decides that. The guard above has already
  // refused a URL that cannot be read, so this one always runs.
  const intended = databaseTarget(TEST_DATABASE_URL)!;
  const [row] = await sql.query("select current_database() as name");
  assertConnectedTo(intended.database, String((row as { name: string }).name));

  // Every run starts from nothing. Migrations are the only way the schema is
  // built, so a migration that does not apply cleanly fails the suite here
  // rather than in an unrelated assertion later.
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
