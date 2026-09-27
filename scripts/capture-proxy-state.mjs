#!/usr/bin/env node
/**
 * Writes down what a Neon proxy that has stopped answering looks like, before
 * the restart erases it.
 *
 * Every stalled run recorded against issue #25 turned out to be the machine
 * sleeping, not the proxy: a capture taken during one showed the proxy
 * answering in 42ms. A proxy that genuinely accepts connections and never
 * answers has only ever been produced on purpose, by pausing its container. If
 * it happens on its own, the one action that clears it, `docker restart`, is
 * also the one that destroys everything that could explain it, and it is what
 * anyone hitting this reaches for within seconds.
 *
 * Hence this. Run it FIRST, then restart:
 *
 *   npm run capture:proxy
 *   docker restart track-record-neon-proxy-1
 *
 * It is read-only. It starts nothing, stops nothing and writes nothing to either
 * database.
 *
 * WHAT IT DELIBERATELY DOES NOT CAPTURE: the `query` column of
 * `pg_stat_activity` holds the statement text of whatever the dev worker was
 * running, which on the dev database means source text and fact quotes. Only the
 * leading verb and the length are taken. The proxy's own log is captured whole,
 * because it is the evidence, and the proxy is not ours to make promises about —
 * read the file before attaching it to the public issue.
 *
 * Postgres is reached through `docker compose exec`, never a direct connection
 * to localhost:5432, which on this machine may be a different Postgres entirely.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { neon, neonConfig } from "@neondatabase/serverless";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PROXY_CONTAINER = "track-record-neon-proxy-1";
const PROXY_ENDPOINT = "http://localhost:4444/sql";
const PROBE_BUDGET_MS = 3_000;
const LOG_LINES = 1_000;

/**
 * The suite's database, not the dev one. The probe is a `select 1`; it touches
 * no table, and aiming it at the database the suite already rebuilds keeps it
 * away from the dev record entirely.
 */
const PROBE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/track_record_test?sslmode=require";

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const out = `proxy-capture-${stamp}.txt`;
const sections = [];

await section("captured at", () => new Date().toISOString());

await section("proxy: is it answering right now?", probeTheProxy);

await section("proxy: container", () =>
  docker([
    "inspect",
    PROXY_CONTAINER,
    "--format",
    [
      "state:      {{.State.Status}}",
      // The image carries a healthcheck of its own, which `npm run db:up --wait`
      // already waits on. Whether it registers a silent proxy is unknown, and this is
      // how that gets answered the first time one is caught.
      "health:     {{if .State.Health}}{{.State.Health.Status}} ({{len .State.Health.Log}} probes recorded){{else}}no healthcheck{{end}}",
      "started:    {{.State.StartedAt}}",
      "restarts:   {{.RestartCount}}",
      "oom killed: {{.State.OOMKilled}}",
      "image:      {{.Config.Image}}",
      "image id:   {{.Image}}",
      "cmd:        {{.Config.Cmd}}",
      "args:       {{.Args}}",
    ].join("\n"),
  ]),
);

// The digest is the only thing that can tell one `:main` build from another.
// Until docker-compose.yml pins it, this is how a silent proxy gets tied to a version.
await section("proxy: image digest", () => {
  // Asked of the running container's image, not of the tag: the tag can have
  // moved since this container started, which is exactly the drift the digest
  // is here to pin down.
  const id = docker(["inspect", PROXY_CONTAINER, "--format", "{{.Image}}"]).trim();
  return docker(["image", "inspect", id, "--format", "{{range .RepoDigests}}{{.}}\n{{end}}built: {{.Created}}"]);
});

// The pool limit named in the issue is --sql-over-http-pool-max-conns-per-endpoint
// (default 20). This records the settings actually in force, not the defaults.
await section("proxy: settings in force", () => docker(["exec", PROXY_CONTAINER, "./neon-proxy", "--help"]));

await section(`proxy: last ${LOG_LINES} log lines`, () =>
  docker(["logs", "--timestamps", "--tail", String(LOG_LINES), PROXY_CONTAINER], { stderrToo: true }),
);

// Connections, without a word of anyone's data. A silent proxy should show here as
// backends parked on a wait_event, or as none at all.
await section("postgres: backends", () =>
  psql(`
    select pid,
           datname,
           usename,
           application_name,
           host(client_addr) as client,
           state,
           coalesce(wait_event_type, '-') as wait_type,
           coalesce(wait_event, '-') as wait_event,
           to_char(backend_start, 'HH24:MI:SS') as started,
           to_char(state_change, 'HH24:MI:SS') as state_changed,
           case when xact_start is null then '-'
                else to_char(now() - xact_start, 'HH24:MI:SS') end as in_xact,
           upper(split_part(btrim(query), ' ', 1)) as verb,
           length(query) as query_len
      from pg_stat_activity
     where backend_type = 'client backend'
     order by datname, backend_start
  `),
);

await section("postgres: backends by database and state", () =>
  psql(`
    select datname, state, count(*)
      from pg_stat_activity
     where backend_type = 'client backend'
     group by datname, state
     order by datname, state
  `),
);

// state_change is the wrong signal for "is traffic flowing" — it read 89s idle
// while the worker was serving ~14 commits/s. xact_commit is the right one.
await section("postgres: committed transactions (the real traffic signal)", () =>
  psql(`
    select datname, numbackends, xact_commit, xact_rollback, conflicts, deadlocks
      from pg_stat_database
     where datname in ('track_record_dev', 'track_record_test', 'postgres')
     order by datname
  `),
);

await section("postgres: locks not granted", () =>
  psql(`
    select l.pid,
           l.locktype,
           l.mode,
           coalesce(c.relname::text, '-') as relation,
           a.state,
           coalesce(a.wait_event, '-') as wait_event
      from pg_locks l
      left join pg_class c on c.oid = l.relation
      left join pg_stat_activity a on a.pid = l.pid
     where not l.granted
     order by l.pid
  `),
);

await section("postgres: connection ceiling", () =>
  psql("select setting as max_connections from pg_settings where name = 'max_connections'"),
);

writeFileSync(new URL(out, new URL("..", import.meta.url)), sections.join("\n") + "\n");

console.log(`\nWritten to ${out}`);
console.log("\nRead it before attaching it anywhere — the proxy's own log is captured whole,");
console.log("and it is not this project's promise that it holds no query text.");
console.log(`\nIf the probe above got no answer, the restart, once the capture is safe:\n\n  docker restart ${PROXY_CONTAINER}\n`);

/** Every section is best-effort: a failure is recorded and the capture goes on. */
async function section(title, gather) {
  const rule = "=".repeat(78);
  let body;
  try {
    body = String((await gather()) ?? "").trimEnd();
  } catch (error) {
    body = `COULD NOT CAPTURE: ${error.stderr?.toString().trim() || error.message}`;
  }
  process.stdout.write(`  ${title}\n`);
  sections.push(`${rule}\n${title}\n${rule}\n${body === "" ? "(nothing)" : body}\n`);
}

/**
 * `spawnSync`, not `execFileSync`, for one reason: `docker logs` relays the
 * container's stderr to ours, and the proxy writes its log there. `execFileSync`
 * hands back stdout alone, so a capture built on it would capture nothing.
 */
function docker(args, { stderrToo = false } = {}) {
  const run = spawnSync("docker", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (run.error) throw run.error;

  const stdout = run.stdout ?? "";
  const stderr = run.stderr ?? "";
  if (run.status !== 0) {
    const why = (stderr || stdout).trim();
    throw new Error(why === "" ? `docker ${args[0]} exited with ${run.status}` : why);
  }

  // The two streams are concatenated rather than interleaved. `--timestamps` is
  // what puts the lines back in order.
  return stderrToo && stderr !== "" ? `${stdout}${stdout === "" ? "" : "\n"}${stderr}` : stdout;
}

function psql(sql) {
  return execFileSync(
    "docker",
    ["compose", "exec", "-T", "postgres", "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-c", sql],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
  );
}

/**
 * The one thing the capture cannot reconstruct afterwards: whether the proxy was
 * still serving when the evidence was taken. Same budget the suite uses.
 */
function probeTheProxy() {
  neonConfig.fetchEndpoint = PROXY_ENDPOINT;
  neonConfig.useSecureWebSocket = false;
  neonConfig.poolQueryViaFetch = true;

  const started = Date.now();
  const settled = neon(PROBE_URL)
    .query("select 1 as ok")
    .then(
      () => `ANSWERED in ${Date.now() - started}ms — the proxy is serving queries.`,
      (error) => `REFUSED after ${Date.now() - started}ms — ${error.message}\n(refused, not silent: this is not the case the restart is for)`,
    );

  let timer;
  const expired = new Promise((resolve) => {
    timer = setTimeout(
      () => resolve(`NO ANSWER in ${PROBE_BUDGET_MS}ms — the proxy accepted the connection and is not serving queries.`),
      PROBE_BUDGET_MS,
    );
  });

  // The losing side is left running rather than cancelled, and settles both ways
  // so that a late refusal cannot surface as an unhandled rejection after the
  // capture has already been written.
  return Promise.race([settled, expired]).finally(() => clearTimeout(timer));
}
