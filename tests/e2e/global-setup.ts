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
  CAPTURE_IDENTITY,
  CAPTURE_STORAGE_STATE,
  CREDIT_PAUSE_IDENTITY,
  CREDIT_PAUSE_STORAGE_STATE,
  DIFF_REVIEW_IDENTITY,
  DIFF_REVIEW_STORAGE_STATE,
  JAPANESE_DIFF_IDENTITY,
  JAPANESE_DIFF_STORAGE_STATE,
  EDUCATION_CHIPS_IDENTITY,
  EDUCATION_CHIPS_STORAGE_STATE,
  DOCUMENT_VIEW_IDENTITY,
  DOCUMENT_VIEW_STORAGE_STATE,
  JAPANESE_CHECK_IDENTITY,
  JAPANESE_CHECK_STORAGE_STATE,
  RESUME_IDENTITY,
  RESUME_STORAGE_STATE,
  INTERVIEW_IDENTITY,
  INTERVIEW_STORAGE_STATE,
  DEMO_SEED_IDENTITY,
  DEMO_SEED_STORAGE_STATE,
  NUMBER_FLAG_IDENTITY,
  NUMBER_FLAG_STORAGE_STATE,
  PHONE_WALL_IDENTITY,
  PHONE_WALL_STORAGE_STATE,
  RESUME_HEADER_IDENTITY,
  RESUME_HEADER_STORAGE_STATE,
  RIREKISHO_PRINT_IDENTITY,
  RIREKISHO_PRINT_STORAGE_STATE,
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
  const interviewSession = await createDevSession(
    (request) => createAuth(bindings, db).handler(request),
    E2E_ORIGIN,
    DEV_SESSION_CLIENT,
    INTERVIEW_IDENTITY,
  );
  writeFileSync(INTERVIEW_STORAGE_STATE, `${JSON.stringify(storageState(interviewSession.cookies, E2E_ORIGIN), null, 2)}\n`, {
    mode: 0o600,
  });
  for (const [identity, path] of [
    [DEMO_SEED_IDENTITY, DEMO_SEED_STORAGE_STATE],
    [NUMBER_FLAG_IDENTITY, NUMBER_FLAG_STORAGE_STATE],
    [PHONE_WALL_IDENTITY, PHONE_WALL_STORAGE_STATE],
  ] as const) {
    const session = await createDevSession(
      (request) => createAuth(bindings, db).handler(request),
      E2E_ORIGIN,
      DEV_SESSION_CLIENT,
      identity,
    );
    writeFileSync(path, `${JSON.stringify(storageState(session.cookies, E2E_ORIGIN), null, 2)}\n`, { mode: 0o600 });
  }
  // Quick capture's own author (issue #95), so its record starts empty and leaves the others' alone.
  const captureSession = await createDevSession(
    (request) => createAuth(bindings, db).handler(request),
    E2E_ORIGIN,
    DEV_SESSION_CLIENT,
    CAPTURE_IDENTITY,
  );
  writeFileSync(CAPTURE_STORAGE_STATE, `${JSON.stringify(storageState(captureSession.cookies, E2E_ORIGIN), null, 2)}\n`, {
    mode: 0o600,
  });
  const creditPauseSession = await createDevSession(
    (request) => createAuth(bindings, db).handler(request),
    E2E_ORIGIN,
    DEV_SESSION_CLIENT,
    CREDIT_PAUSE_IDENTITY,
  );
  writeFileSync(CREDIT_PAUSE_STORAGE_STATE, `${JSON.stringify(storageState(creditPauseSession.cookies, E2E_ORIGIN), null, 2)}\n`, {
    mode: 0o600,
  });
  const diffReviewSession = await createDevSession(
    (request) => createAuth(bindings, db).handler(request),
    E2E_ORIGIN,
    DEV_SESSION_CLIENT,
    DIFF_REVIEW_IDENTITY,
  );
  writeFileSync(DIFF_REVIEW_STORAGE_STATE, `${JSON.stringify(storageState(diffReviewSession.cookies, E2E_ORIGIN), null, 2)}\n`, {
    mode: 0o600,
  });
  const japaneseDiffSession = await createDevSession(
    (request) => createAuth(bindings, db).handler(request),
    E2E_ORIGIN,
    DEV_SESSION_CLIENT,
    JAPANESE_DIFF_IDENTITY,
  );
  writeFileSync(JAPANESE_DIFF_STORAGE_STATE, `${JSON.stringify(storageState(japaneseDiffSession.cookies, E2E_ORIGIN), null, 2)}\n`, {
    mode: 0o600,
  });
  // The reader's own author (issue #106), so the smoke test's record still starts with no profile.
  const documentViewSession = await createDevSession(
    (request) => createAuth(bindings, db).handler(request),
    E2E_ORIGIN,
    DEV_SESSION_CLIENT,
    DOCUMENT_VIEW_IDENTITY,
  );
  writeFileSync(DOCUMENT_VIEW_STORAGE_STATE, `${JSON.stringify(storageState(documentViewSession.cookies, E2E_ORIGIN), null, 2)}\n`, {
    mode: 0o600,
  });
  const japaneseCheckSession = await createDevSession(
    (request) => createAuth(bindings, db).handler(request),
    E2E_ORIGIN,
    DEV_SESSION_CLIENT,
    JAPANESE_CHECK_IDENTITY,
  );
  writeFileSync(JAPANESE_CHECK_STORAGE_STATE, `${JSON.stringify(storageState(japaneseCheckSession.cookies, E2E_ORIGIN), null, 2)}\n`, {
    mode: 0o600,
  });
  // The résumé header's own author (issue #108), so the smoke test's record still starts with no profile.
  const resumeHeaderSession = await createDevSession(
    (request) => createAuth(bindings, db).handler(request),
    E2E_ORIGIN,
    DEV_SESSION_CLIENT,
    RESUME_HEADER_IDENTITY,
  );
  writeFileSync(RESUME_HEADER_STORAGE_STATE, `${JSON.stringify(storageState(resumeHeaderSession.cookies, E2E_ORIGIN), null, 2)}\n`, {
    mode: 0o600,
  });
  // The 履歴書 print check's own author, so it onboards from no profile whichever spec ran first.
  const rirekishoPrintSession = await createDevSession(
    (request) => createAuth(bindings, db).handler(request),
    E2E_ORIGIN,
    DEV_SESSION_CLIENT,
    RIREKISHO_PRINT_IDENTITY,
  );
  writeFileSync(RIREKISHO_PRINT_STORAGE_STATE, `${JSON.stringify(storageState(rirekishoPrintSession.cookies, E2E_ORIGIN), null, 2)}\n`, {
    mode: 0o600,
  });
  // The résumé layout's own author (issue #107), so the smoke test's record still starts with no profile.
  const resumeSession = await createDevSession(
    (request) => createAuth(bindings, db).handler(request),
    E2E_ORIGIN,
    DEV_SESSION_CLIENT,
    RESUME_IDENTITY,
  );
  writeFileSync(RESUME_STORAGE_STATE, `${JSON.stringify(storageState(resumeSession.cookies, E2E_ORIGIN), null, 2)}\n`, {
    mode: 0o600,
  });
  const educationChipsSession = await createDevSession(
    (request) => createAuth(bindings, db).handler(request),
    E2E_ORIGIN,
    DEV_SESSION_CLIENT,
    EDUCATION_CHIPS_IDENTITY,
  );
  writeFileSync(EDUCATION_CHIPS_STORAGE_STATE, `${JSON.stringify(storageState(educationChipsSession.cookies, E2E_ORIGIN), null, 2)}\n`, {
    mode: 0o600,
  });
}
