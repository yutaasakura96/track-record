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
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { neon, neonConfig } from "@neondatabase/serverless";

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = join(here, "..", "src", "server", "db", "migrations");

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/track_record_test?sslmode=require";

export default async function setup() {
  neonConfig.fetchEndpoint = "http://localhost:4444/sql";
  neonConfig.useSecureWebSocket = false;
  neonConfig.poolQueryViaFetch = true;
  const sql = neon(TEST_DATABASE_URL);

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
