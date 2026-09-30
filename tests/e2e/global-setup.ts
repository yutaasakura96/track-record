/**
 * Before the browser opens: an empty database, and a signed-in session for it.
 *
 * The session is made by the code behind `npm run dev:session` — Better Auth's
 * own sign-in path, run in this process, with the suite's OIDC fixture standing
 * in for Google (`scripts/dev-session-core.ts`). The fixture patches
 * `globalThis.fetch` in the process that runs it, so a browser following a
 * redirect would reach the real Google; the browser therefore clicks the
 * sign-in button and stops at the redirect, then loads this session instead
 * (`docs/06`, 2026-09-28).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createAuth } from "~/server/auth";
import { createDb } from "~/server/db/client";
import type { Bindings } from "~/server/env";
import { DEV_SESSION_CLIENT, createDevSession, storageState } from "../../scripts/dev-session-core";
import { assertSuiteDatabaseIsNotDev } from "../database-guard";
import { rebuildSchema } from "../rebuild-schema";
import {
  E2E_ALLOWED_EMAIL,
  E2E_DATABASE_URL,
  E2E_ORIGIN,
  E2E_SECRET,
  E2E_SUITE,
  STORAGE_STATE,
} from "./env";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEV_VARS = join(root, ".dev.vars");

export default async function setup() {
  // Before anything connects: the drop below is total.
  assertSuiteDatabaseIsNotDev(
    E2E_DATABASE_URL,
    existsSync(DEV_VARS) ? readFileSync(DEV_VARS, "utf8") : null,
    process.env.DATABASE_URL ?? null,
    E2E_SUITE,
  );
  await rebuildSchema(E2E_DATABASE_URL);

  const bindings = {
    DATABASE_URL: E2E_DATABASE_URL,
    BETTER_AUTH_SECRET: E2E_SECRET,
    BETTER_AUTH_URL: E2E_ORIGIN,
    ALLOWED_SIGNUP_EMAILS: E2E_ALLOWED_EMAIL,
    GOOGLE_CLIENT_ID: DEV_SESSION_CLIENT.clientId,
    GOOGLE_CLIENT_SECRET: DEV_SESSION_CLIENT.clientSecret,
  } as Bindings;
  const db = createDb(E2E_DATABASE_URL);
  const { cookies } = await createDevSession(
    (request) => createAuth(bindings, db).handler(request),
    E2E_ORIGIN,
  );

  mkdirSync(dirname(STORAGE_STATE), { recursive: true });
  writeFileSync(STORAGE_STATE, `${JSON.stringify(storageState(cookies, E2E_ORIGIN), null, 2)}\n`, {
    mode: 0o600,
  });
}
