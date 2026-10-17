/**
 * What `npm run db:seed:demo` refuses before it touches anything. Pure, so the
 * suite can prove each refusal; the reading of `.dev.vars` and the argument
 * list happen in `./seed.ts`.
 */
import { SUITE_DATABASE, databaseTarget } from "../../tests/database-guard";

export const REMOTE_FLAG = "--remote-after-backup";
export const RECORDINGS_FLAG = "--recordings-deleted";

/** The hosts `dev-session-core.ts` and `src/server/db/client.ts` treat as this machine. */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "db.localtest.me"]);

/** Throws, naming the reason, unless the reset may run against `url`. */
export function assertSeedTarget(url: string, flags: readonly string[]): void {
  const target = databaseTarget(url);
  if (!target) throw new Error("DATABASE_URL is not a connection string this can read.");
  if (target.database === SUITE_DATABASE) {
    throw new Error(`Refusing ${SUITE_DATABASE}: the suite drops it on every run.`);
  }
  const host = new URL(url).hostname;
  if (!LOCAL_HOSTS.has(host) && !flags.includes(REMOTE_FLAG)) {
    throw new Error(
      `DATABASE_URL points at ${host}. A remote reset needs a database backup first (docs/12 §5), then ${REMOTE_FLAG}.`,
    );
  }
}

/** Throws unless the uploaded recordings left in R2 have been dealt with. */
export function assertRecordingsGone(uploads: number, userId: string, flags: readonly string[]): void {
  if (uploads === 0 || flags.includes(RECORDINGS_FLAG)) return;
  throw new Error(
    `${uploads} uploaded recording(s) exist. Delete the R2 objects under "${userId}/" in the recordings bucket ` +
      `first (objects only, never the bucket), then rerun with ${RECORDINGS_FLAG}.`,
  );
}
