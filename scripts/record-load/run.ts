/**
 * `npm run db:load:record -- --file <path> --check`
 * `npm run db:load:record -- --file <path> --email <address> [--remote-after-backup] [--clear-recordings | --recordings-deleted]`
 *
 * `--check` reads the file and touches nothing else. Without it, this empties
 * ONE user's record and loads the file in its place. `./load.ts` does the work;
 * the refusals are the demo seed's (`../demo-seed/guard.ts`), and the runbook
 * is `docs/12` §5b. It prints counts and field names, never a value from the file.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { createDb } from "~/server/db/client";
import * as s from "~/server/db/schema";
import { databaseTarget, devVar } from "../../tests/database-guard";
import { assertSeedTarget } from "../demo-seed/guard";
import { assertOutsideRepository, parseRecordFile, recordAdvisories } from "./format";
import { clearAndLoad } from "./load";
import { CLEAR_RECORDINGS_FLAG, boundObjects, cloudflareObjects, type RecordingObjects } from "./recordings";

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

/**
 * Where the recordings are: the bucket on disk behind a local database, the
 * real one behind a remote database. Disposed once the run is over.
 */
async function recordingObjects(url: string): Promise<{ objects: RecordingObjects; dispose: () => Promise<void> }> {
  if (databaseTarget(url)?.host === "localhost") {
    const { getPlatformProxy } = await import("wrangler");
    const proxy = await getPlatformProxy<{ RECORDINGS: R2Bucket }>({ configPath: join(root, "wrangler.toml") });
    return { objects: boundObjects(proxy.env.RECORDINGS), dispose: proxy.dispose };
  }
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !token) throw new Error(`${CLEAR_RECORDINGS_FLAG} against a remote database needs CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN.`);
  return { objects: cloudflareObjects({ accountId, token }), dispose: async () => {} };
}

async function main(): Promise<void> {
  const file = arg("--file");
  if (!file) throw new Error("Name the record file with --file <path>.");
  assertOutsideRepository(file, root);
  const record = parseRecordFile(readFileSync(file, "utf8"));
  const advisories = recordAdvisories(record);

  if (process.argv.includes("--check")) {
    console.log(
      JSON.stringify({
        employers: record.employers.length,
        roles: record.employers.flatMap((employer) => employer.roles).length,
        educations: record.educations.length,
        certifications: record.certifications.length,
        advisories,
      }),
    );
    return;
  }

  const url = databaseUrl();
  assertSeedTarget(url, process.argv);
  // Named every time. This replaces a real record, so it has no default user.
  const email = arg("--email");
  if (!email) throw new Error("Name the user with --email <address>.");
  const db = createDb(url);
  const [user] = await db.select({ id: s.users.id }).from(s.users).where(eq(s.users.email, email)).limit(1);
  if (!user) throw new Error(`No user ${email}. Sign in once first: the record hangs off the user row.`);

  const recordings = process.argv.includes(CLEAR_RECORDINGS_FLAG) ? await recordingObjects(url) : null;
  try {
    const counts = await clearAndLoad(db, user.id, record, { flags: process.argv, objects: recordings?.objects });
    console.log(JSON.stringify({ ...counts, advisories }));
  } finally {
    await recordings?.dispose();
  }
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(`record load failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  },
);
