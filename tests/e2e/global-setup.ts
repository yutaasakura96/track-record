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
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { neon, neonConfig } from "@neondatabase/serverless";
import { createAuth } from "~/server/auth";
import { createDb } from "~/server/db/client";
import { localProxyEndpoint } from "~/server/db/local-proxy";
import type { Bindings } from "~/server/env";
import { DEV_SESSION_CLIENT, createDevSession, storageState } from "../../scripts/dev-session-core";
import { assertConnectedTo, assertSuiteDatabaseIsNotDev, databaseTarget } from "../database-guard";
import { E2E_ALLOWED_EMAIL, E2E_DATABASE_URL, E2E_ORIGIN, E2E_SECRET } from "./env";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MIGRATIONS = join(root, "src", "server", "db", "migrations");
const DEV_VARS = join(root, ".dev.vars");

/** Gitignored, with the rest of `.dev-session/`: a live session token, for the e2e database. */
export const STORAGE_STATE = join(root, ".dev-session", "e2e-storage-state.json");

export default async function setup() {
  // Before anything connects: the drop below is total.
  assertSuiteDatabaseIsNotDev(
    E2E_DATABASE_URL,
    existsSync(DEV_VARS) ? readFileSync(DEV_VARS, "utf8") : null,
    process.env.DATABASE_URL ?? null,
  );
  await rebuildSchema();

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

/** Every run starts from nothing, and the schema comes only from the migrations. */
async function rebuildSchema() {
  const url = new URL(E2E_DATABASE_URL);
  neonConfig.fetchEndpoint = localProxyEndpoint(url);
  neonConfig.useSecureWebSocket = false;
  neonConfig.poolQueryViaFetch = true;
  const sql = neon(E2E_DATABASE_URL);

  // The URL says where the query was aimed, not where it landed.
  const intended = databaseTarget(E2E_DATABASE_URL)!;
  const [row] = await sql.query("select current_database() as name");
  assertConnectedTo(intended.database, String((row as { name: string }).name));

  await sql.query("drop schema if exists public cascade");
  await sql.query("create schema public");
  const files = readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const file of files) {
    for (const statement of readFileSync(join(MIGRATIONS, file), "utf8").split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed !== "") await sql.query(trimmed);
    }
  }
}
