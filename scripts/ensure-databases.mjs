#!/usr/bin/env node
/**
 * Creates whichever of the two local databases is missing (issue #4).
 *
 * `POSTGRES_DB` in docker-compose.yml only runs on a first, empty volume, so it
 * cannot be the mechanism: a volume created before the split would keep exactly
 * one database and the suite would go on sharing it with the dev worker. This
 * runs on every `npm run db:up` instead, and does nothing when both exist.
 *
 * It never drops anything. `npm run db:down` is what removes the volume.
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const DATABASES = [
  ["track_record_dev", "the dev worker — .dev.vars points here"],
  ["track_record_test", "the suite, which drops and rebuilds it on every run"],
];

for (const [name, purpose] of DATABASES) {
  if (psql(`select 1 from pg_database where datname = '${name}'`).trim() === "1") {
    console.log(`  ${name.padEnd(18)} present`);
    continue;
  }
  psql(`create database ${name}`);
  console.log(`  ${name.padEnd(18)} created — ${purpose}`);
}

// The Neon HTTP proxy authenticates EVERY query, before it looks at its pool:
// two role-secret lookups, each its own SCRAM login to Postgres, then a SCRAM
// check of the client's password. At Postgres's default 4096 PBKDF2 iterations
// that is ~110ms before a `select 1` that executes in 0.3ms, and it made single
// tests take 10–17s of a 30s budget. At one iteration it is ~9ms. The password
// is `postgres` on a local container, so the iterations were protecting nothing.
// Idempotent: it re-hashes only when the stored secret says otherwise.
const secret = psql("select rolpassword from pg_authid where rolname = 'postgres'").trim();
if (secret.startsWith("SCRAM-SHA-256$1:")) {
  console.log(`  ${"postgres role".padEnd(18)} SCRAM at 1 iteration`);
} else {
  psql("set scram_iterations = 1; alter role postgres password 'postgres'");
  console.log(`  ${"postgres role".padEnd(18)} re-hashed at 1 SCRAM iteration — each proxied query was paying ~100ms of auth`);
}

function psql(sql) {
  try {
    return execFileSync(
      "docker",
      ["compose", "exec", "-T", "postgres", "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-tAc", sql],
      // `fileURLToPath`, not `.pathname`: a repo path containing a space arrives
      // percent-encoded and docker compose is then run from a directory that does
      // not exist.
      { cwd: fileURLToPath(new URL("..", import.meta.url)), encoding: "utf8" },
    );
  } catch (error) {
    console.error(`Could not reach the docker-compose Postgres.\n${error.stderr ?? error.message}`);
    process.exit(1);
  }
}
