/**
 * What the Worker under test and the global setup must agree on.
 *
 * Every value is a placeholder for a machine that holds nothing: a local
 * Postgres, an invented secret, a Google client that does not exist. No
 * deployment reads any of them.
 */
import { DEV_SESSION_CLIENT, DEV_SESSION_IDENTITY } from "../../scripts/dev-session-core";
import type { SuiteOwner } from "../database-guard";

/**
 * Not 8787, which `npm run dev:worker` uses, so a developer's dev server and
 * this one can run together.
 */
export const E2E_PORT = 8788;
export const E2E_ORIGIN = `http://localhost:${E2E_PORT}`;

/** The suite's own database. `track_record_dev` is refused (`global-setup.ts`). */
export const E2E_SUITE: SuiteOwner = { variable: "E2E_DATABASE_URL", database: "track_record_e2e" };

export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ??
  `postgresql://postgres:postgres@localhost:5432/${E2E_SUITE.database}?sslmode=require`;

/** Signs the session cookie the setup mints and the Worker verifies. */
export const E2E_SECRET = "e2e-placeholder-secret-0123456789-abcdefghijklmnopqrstuvwxyz";

export const E2E_ALLOWED_EMAIL = DEV_SESSION_IDENTITY.email;

/** The Worker's bindings as `NAME:value` pairs for `wrangler dev --var`. */
export function workerVars(databaseUrl: string, secret: string): string[] {
  return [
    `DATABASE_URL:'${databaseUrl}'`,
    `BETTER_AUTH_SECRET:${secret}`,
    `BETTER_AUTH_URL:${E2E_ORIGIN}`,
    `GOOGLE_CLIENT_ID:${DEV_SESSION_CLIENT.clientId}`,
    `GOOGLE_CLIENT_SECRET:${DEV_SESSION_CLIENT.clientSecret}`,
    `ALLOWED_SIGNUP_EMAILS:${E2E_ALLOWED_EMAIL}`,
  ];
}
