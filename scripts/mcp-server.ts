/**
 * `npm run mcp` — Track Record's record as a local stdio MCP server, for Claude
 * Desktop or Claude Code (`docs/specs/mcp-spike.md`).
 *
 * Local only, by the same signal `npm run dev:session` uses: the connection
 * string comes from `.dev.vars` and nowhere else, it has to name this machine,
 * and it may not name the suite's database. A remote connector needs real
 * authentication, which this does not pretend to be.
 *
 * The user is chosen once, here, with `--user <email>` (or
 * `TRACK_RECORD_USER_EMAIL`); with neither, the database must hold exactly one
 * user. Every tool is bound to that id and no tool argument can change it.
 *
 * stdout is the protocol. Anything that would print there is sent to stderr.
 */
import { existsSync, readFileSync } from "node:fs";
import { register } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SUITE_DATABASE, databaseTarget, devVar } from "../tests/database-guard";

console.log = console.error;
console.info = console.error;

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "db.localtest.me"]);

function refuse(reason: string): never {
  console.error(`track-record mcp refused: ${reason}`);
  process.exit(1);
}

function flag(name: string): string | null {
  const at = process.argv.indexOf(name);
  if (at === -1) return null;
  return process.argv[at + 1] ?? refuse(`${name} needs a value.`);
}

/**
 * `.dev.vars`'s `DATABASE_URL`, or `--database-url` for a second local database
 * (the demo in `docs/specs/mcp-spike.md` uses one). Either is held to the same
 * guard: this machine, and never the suite's database.
 */
function localDatabaseUrl(): string {
  let url = flag("--database-url");
  if (url === null) {
    const devVars = join(root, ".dev.vars");
    if (!existsSync(devVars)) refuse(".dev.vars was not found. Copy .dev.vars.example to .dev.vars.");
    url = devVar(readFileSync(devVars, "utf8"), "DATABASE_URL") ?? "";
  }
  const target = url === "" ? null : databaseTarget(url);
  if (!target) refuse("DATABASE_URL is missing or unreadable.");
  if (!LOCAL_HOSTS.has(new URL(url).hostname)) refuse("DATABASE_URL is not a local database.");
  if (target.database === SUITE_DATABASE) {
    refuse(`DATABASE_URL names ${SUITE_DATABASE}, which the suite drops on every run.`);
  }
  return url;
}

function requestedEmail(): string | null {
  return flag("--user") ?? (process.env.TRACK_RECORD_USER_EMAIL || null);
}

async function main() {
  const databaseUrl = localDatabaseUrl();
  register("./mcp/data-hooks.mjs", import.meta.url);

  // Imported only now, after the `.docx` and `.ttf` hook is in place.
  const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
  const { eq } = await import("drizzle-orm");
  const { createDb } = await import("~/server/db/client");
  const { users } = await import("~/server/db/schema");
  const { createTrackRecordServer } = await import("~/mcp/server");

  const db = createDb(databaseUrl);
  const email = requestedEmail();
  const found = await db
    .select({ id: users.id })
    .from(users)
    .where(email ? eq(users.email, email) : undefined)
    .limit(2);
  if (found.length === 0) refuse(email ? `no user has the email given.` : "the database holds no user.");
  if (found.length > 1) refuse("the database holds more than one user. Pass --user <email>.");

  await createTrackRecordServer(db, found[0]!.id).connect(new StdioServerTransport());
  // Ids only, to stderr.
  console.error(JSON.stringify({ event: "mcp_ready", userId: found[0]!.id }));
}

main().catch(() => refuse("could not start. Is the database up (npm run db:up)?"));
