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
