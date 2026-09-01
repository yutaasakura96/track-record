/**
 * Two guards standing between `npm test` and the development database.
 *
 * The suite drops and rebuilds `public` on every run — every run starts from
 * nothing (`docs/11-testing-plan.md` §1). That is correct and it is total, so
 * the only thing making it safe is that it lands on a database nobody is using.
 * When it lands on the dev database instead, the loss is silent and complete:
 * the signed-in session, the profile, the imported documents, the accepted
 * facts and every accepted render version. This happened three times during the
 * 2026-09-01 walk (issue #4).
 *
 * Both guards are pure so the suite can prove them. The reading of `.dev.vars`
 * and the asking of `current_database()` happen in `global-setup.ts`.
 */

/** The two databases this project ships with (`docker-compose.yml`). */
export const DEV_DATABASE = "track_record_dev";
export const SUITE_DATABASE = "track_record_test";

export type DatabaseTarget = { host: string; port: string; database: string };

/**
 * The spellings of the local server, as `src/server/db/client.ts` already reads
 * them. Collapsed to one name here so that writing `127.0.0.1` in `.dev.vars`
 * and `localhost` in `TEST_DATABASE_URL` cannot walk past the guard.
 */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1", "db.localtest.me", "postgres"]);

/**
 * What a connection string points at. Port defaults where Postgres defaults, so
 * that a URL naming :5432 and one omitting it are recognised as one server.
 */
export function databaseTarget(connectionString: string): DatabaseTarget | null {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    return null;
  }
  const database = url.pathname.replace(/^\//, "");
  if (url.hostname === "" || database === "") return null;
  const host = LOCAL_HOSTS.has(url.hostname) ? "localhost" : url.hostname;
  return { host, port: url.port === "" ? "5432" : url.port, database };
}

/**
 * `DATABASE_URL` as `.dev.vars` sets it, or null when the file is absent or
 * does not set it. `.dev.vars` is a flat `KEY=value` file; this reads it as one
 * rather than pulling in a dotenv parser for a single line.
 */
export function devDatabaseUrl(contents: string | null): string | null {
  if (contents === null) return null;
  for (const line of contents.split("\n")) {
    const match = /^\s*DATABASE_URL\s*=\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    const value = match[1] ?? "";
    const unquoted = /^(["'])(.*)\1$/.exec(value);
    return unquoted ? (unquoted[2] ?? "") : value;
  }
  return null;
}

/**
 * Refuses the run when the suite is aimed at a database local development is
 * using. A dev database that is elsewhere — a Neon branch, another port — is not
 * at risk and is not blocked, however it is named.
 *
 * It fails CLOSED. Input it cannot read is a refusal, not a shrug: the drop
 * cannot be undone, and the run nobody could explain is the one to stop. The
 * only silence is a dev URL that is genuinely absent — CI has none, and there is
 * nothing there to lose.
 */
export function assertSuiteDatabaseIsNotDev(
  suiteUrl: string,
  devVars: string | null,
  envDatabaseUrl: string | null = null,
): void {
  const suite = databaseTarget(suiteUrl);
  if (!suite) {
    throw new Error(
      `TEST_DATABASE_URL is not a connection string this can read: ${JSON.stringify(suiteUrl)}. ` +
        "Refusing to run, because there is no way to tell what would be dropped.",
    );
  }

  // The name alone is enough. `TEST_DATABASE_URL` is an override, and an
  // override pointed at the dev database is a mistake whatever else is set.
  if (suite.database === DEV_DATABASE) {
    throw new Error(
      `The suite is aimed at ${where(suite)} — the development database. ` +
        `TEST_DATABASE_URL should name the suite's own database, ${SUITE_DATABASE}.`,
    );
  }

  for (const [source, url] of devUrls(devVars, envDatabaseUrl)) {
    const dev = databaseTarget(url);
    if (!dev) {
      throw new Error(
        `DATABASE_URL in ${source} is not a connection string this can read. Refusing to run, ` +
          "because there is no way to tell whether it is the database the suite is about to drop.",
      );
    }
    if (dev.host !== suite.host || dev.port !== suite.port) continue;
    if (dev.database !== suite.database) continue;

    throw new Error(
      [
        `The suite and local development are pointed at the same database: ${where(suite)},`,
        `named by TEST_DATABASE_URL and by DATABASE_URL in ${source}.`,
        "",
        "Every suite run drops and rebuilds `public` (docs/11 §1), which would destroy the",
        "dev session, the profile, the imported documents and every accepted render version.",
        "",
        "Point DATABASE_URL at the development database — see .dev.vars.example:",
        "",
        `  DATABASE_URL="postgresql://postgres:postgres@${suite.host}:${suite.port}/${DEV_DATABASE}?sslmode=disable"`,
        "",
        `To keep what is already in ${suite.database}, copy it across first:`,
        "",
        `  docker compose exec postgres psql -U postgres -c 'create database ${DEV_DATABASE} template ${suite.database}'`,
      ].join("\n"),
    );
  }
}

/**
 * Where a dev `DATABASE_URL` can come from, each labelled so the refusal can say
 * which file or variable to go and edit. `.dev.vars` is what `wrangler dev`
 * reads; an exported variable is what a shell can put in front of it.
 */
function devUrls(devVars: string | null, envDatabaseUrl: string | null): Array<[string, string]> {
  const found: Array<[string, string]> = [];
  const fromFile = devDatabaseUrl(devVars);
  if (fromFile !== null) found.push([".dev.vars", fromFile]);
  if (envDatabaseUrl !== null && envDatabaseUrl !== "") found.push(["the environment", envDatabaseUrl]);
  return found;
}

/**
 * Refuses the run when the server answers from a database other than the one
 * asked for. The Neon HTTP proxy carries a connection string of its own; it
 * honours the database each client names, but a misconfiguration there would
 * send the drop somewhere else entirely with nothing in `TEST_DATABASE_URL` to
 * show for it. Asking the connection what it is costs one round trip.
 */
export function assertConnectedTo(expected: string, actual: string): void {
  if (expected === actual) return;
  throw new Error(
    `The suite asked for the database "${expected}" and reached "${actual}" instead. ` +
      "Check PG_CONNECTION_STRING on the neon-proxy service in docker-compose.yml. " +
      "Nothing has been dropped.",
  );
}

/** Host and database, never the password — a dev URL may hold a real one. */
function where(target: DatabaseTarget): string {
  return `${target.host}:${target.port}/${target.database}`;
}
