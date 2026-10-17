/**
 * `npm run db:seed:demo [-- --email <address>] [--remote-after-backup] [--recordings-deleted]`
 *
 * Resets ONE user's record to the invented one in `fixture.ts` and
 * `documents.ts`, and fills every screen. `./demo.ts` does the work; this
 * reads the database URL and the flags and applies the refusals in `./guard.ts`.
 * The production runbook is `docs/12` §5a.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { createDb } from "~/server/db/client";
import * as s from "~/server/db/schema";
import { devVar } from "../../tests/database-guard";
import { seedDemo } from "./demo";
import { assertSeedTarget } from "./guard";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function arg(name: string): string | null {
  const at = process.argv.indexOf(name);
  return at === -1 ? null : (process.argv[at + 1] ?? null);
}

/** The environment first, so a production run names its URL on the command line; `.dev.vars` otherwise. */
function databaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const file = join(root, ".dev.vars");
  if (!existsSync(file)) throw new Error("No DATABASE_URL in the environment and no .dev.vars.");
  const url = devVar(readFileSync(file, "utf8"), "DATABASE_URL");
  if (!url) throw new Error(".dev.vars has no DATABASE_URL.");
  return url;
}

async function main(): Promise<void> {
  const url = databaseUrl();
  assertSeedTarget(url, process.argv);

  const db = createDb(url);
  const email = arg("--email") ?? "dev-session@example.invalid";
  const [user] = await db.select({ id: s.users.id }).from(s.users).where(eq(s.users.email, email)).limit(1);
  if (!user) throw new Error(`No user ${email}. Sign in once (or run npm run dev:session) first.`);

  console.log(JSON.stringify(await seedDemo(db, user.id, process.argv)));
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(`demo seed failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  },
);
