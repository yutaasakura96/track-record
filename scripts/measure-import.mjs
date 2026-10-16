#!/usr/bin/env node
/**
 * The import cost readout (`docs/06`, 2026-10-16; issue #92).
 *
 * Prints what one import cost: chunks total, done and failed, the four token
 * sums `import_chunks` carries, chunks with no usage recorded, and an estimated
 * cost in US dollars beside the same figures at the Message Batches price. The
 * definition and the rates live in `src/pipeline/cost.ts`; this file only finds
 * a version and hands over its sums.
 *
 *   npm run measure:import -- --latest
 *   npm run measure:import -- --version sdv_H8t4
 *   npm run measure:import -- --latest --url "$PRODUCTION_DATABASE_URL"
 *
 * Options:
 *   --latest            the most recently created `source_document_versions` row
 *   --version <id>      a specific row
 *   --database <name>   default track_record_dev
 *   --psql <command>    how to reach psql (default: the docker-compose Postgres)
 *   --url <string>      a connection string, run with the host's `psql` instead
 *                       of the compose one — how the owner reads production
 *
 * IT PRINTS NUMBERS AND IDS AND NEVER TEXT. No filename, claim, quote or error
 * body, and not part of the document: the query selects counts and sums and
 * nothing else, so there is nothing to leak in an error either.
 *
 * psql rather than the application's own driver, for the same reason `measure`
 * uses it: this is an operations task and must not depend on the Worker.
 */
import { execFileSync, execSync } from "node:child_process";
import { formatReport, importUsageSql } from "../src/pipeline/cost.ts";

const args = parseArgs(process.argv.slice(2));

const PSQL = args.psql ?? "docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U postgres";
const DB = args.database ?? "track_record_dev";

if (!args.latest && !args.version) fail("Pass --latest or --version <id>.");
// An id reaches a shell command, so it is checked against the shape ids
// actually have rather than quoted and hoped for.
if (args.version && !/^[A-Za-z0-9_-]+$/.test(args.version)) fail("That is not a version id.");

const sql = importUsageSql(args.version ?? null).replace(/\s+/g, " ");

const out = run(sql);
if (!out) fail(args.version ? "No import with that id." : "No imports in the database.");

const { id, ...usage } = JSON.parse(out);
console.log(formatReport(id, usage));

function run(query) {
  try {
    if (args.url) {
      return execFileSync("psql", [args.url, "-v", "ON_ERROR_STOP=1", "-tAc", query], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
    }
    return execSync(`${PSQL} -d ${DB} -tAc "${query}"`, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch {
    // psql's stderr can quote the statement and the connection string; say only that it failed.
    fail("Could not read the database. Is it up, and are --database, --psql or --url right?");
  }
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) fail(`Unexpected argument ${arg}.`);
    const key = arg.slice(2);
    if (key === "latest") {
      parsed.latest = true;
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) fail(`${arg} needs a value.`);
    parsed[key] = value;
    i += 1;
  }
  return parsed;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
