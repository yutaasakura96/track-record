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
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
// The `.ts` is required, not a slip: `vitest.config.ts` imports this module, so
// it is part of the Vite config graph, which resolves extensionless relative
// imports only under the legacy config loader. `vitest.config.ts` spells its own
// import of this file the same way.
import { assertSuiteDatabaseIsNotDev } from "./database-guard.ts";
import { rebuildSchema } from "./rebuild-schema.ts";
import { sleptMessage, watchForSleep } from "./sleep-watch.ts";

const here = dirname(fileURLToPath(import.meta.url));
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
  // First, so a machine that sleeps at any point in the run is named — at once,
  // and again at teardown beside the timeouts it caused (`./sleep-watch.ts`).
  const sleep = watchForSleep();
  try {
    await prepareDatabase();
  } catch (error) {
    sleep.stop();
    throw error;
  }
  return () => {
    const gaps = sleep.stop();
    if (gaps.length > 0) console.warn(sleptMessage(gaps));
  };
}

async function prepareDatabase() {
  // Before anything connects: the drop below is total, and a dev database on
  // the other end of this URL loses everything it holds. Both places a dev
  // DATABASE_URL can come from are checked — the file `wrangler dev` reads, and
  // the environment a shell can put in front of it.
  assertSuiteDatabaseIsNotDev(
    TEST_DATABASE_URL,
    existsSync(DEV_VARS) ? readFileSync(DEV_VARS, "utf8") : null,
    process.env.DATABASE_URL ?? null,
  );

  await rebuildSchema(TEST_DATABASE_URL);
}
