/**
 * What the Worker under test and the global setup must agree on.
 *
 * Every value is a placeholder for a machine that holds nothing: a local
 * Postgres, an invented secret, a Google client that does not exist. No
 * deployment reads any of them.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEV_SESSION_CLIENT, DEV_SESSION_IDENTITY } from "../../scripts/dev-session-fixture";
import type { SuiteOwner } from "../database-guard";

/**
 * Not 8787, which `npm run dev:worker` uses, so a developer's dev server and
 * this one can run together.
 */
export const E2E_PORT = Number(process.env.E2E_PORT ?? 8788);
export const E2E_ORIGIN = `http://localhost:${E2E_PORT}`;

/** The suite's own database. `track_record_dev` is refused (`global-setup.ts`). */
export const E2E_SUITE: SuiteOwner = { variable: "E2E_DATABASE_URL", database: "track_record_e2e" };

export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ??
  `postgresql://postgres:postgres@localhost:5432/${E2E_SUITE.database}?sslmode=require`;

/** Signs the session cookie the setup mints and the Worker verifies. */
export const E2E_SECRET = "e2e-placeholder-secret-0123456789-abcdefghijklmnopqrstuvwxyz";

export const INTERVIEW_IDENTITY = {
  sub: "e2e-interview-local",
  email: "e2e-interview@example.invalid",
  name: "Interview Test",
};

export const CAPTURE_IDENTITY = {
  sub: "e2e-capture-local",
  email: "e2e-capture@example.invalid",
  name: "Capture Test",
};

export const DIFF_REVIEW_IDENTITY = {
  sub: "e2e-diff-review-local",
  email: "e2e-diff-review@example.invalid",
  name: "Diff Review Test",
};

export const DOCUMENT_VIEW_IDENTITY = {
  sub: "e2e-document-view-local",
  email: "e2e-document-view@example.invalid",
  name: "Document View Test",
};

export const RESUME_HEADER_IDENTITY = {
  sub: "e2e-resume-header-local",
  email: "e2e-resume-header@example.invalid",
  name: "Resume Header Test",
};

export const RIREKISHO_PRINT_IDENTITY = {
  sub: "e2e-rirekisho-print-local",
  email: "e2e-rirekisho-print@example.invalid",
  name: "Rirekisho Print Test",
};

export const E2E_ALLOWED_EMAIL = `${DEV_SESSION_IDENTITY.email},${INTERVIEW_IDENTITY.email},${CAPTURE_IDENTITY.email},${DIFF_REVIEW_IDENTITY.email},${DOCUMENT_VIEW_IDENTITY.email},${RESUME_HEADER_IDENTITY.email},${RIREKISHO_PRINT_IDENTITY.email}`;

/** Gitignored, with the rest of `.dev-session/`: a live session token, for the e2e database. */
export const STORAGE_STATE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  ".dev-session",
  "e2e-storage-state.json",
);

export const INTERVIEW_STORAGE_STATE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  ".dev-session",
  "e2e-interview-storage-state.json",
);

export const CAPTURE_STORAGE_STATE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  ".dev-session",
  "e2e-capture-storage-state.json",
);

export const DIFF_REVIEW_STORAGE_STATE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  ".dev-session",
  "e2e-diff-review-storage-state.json",
);

export const DOCUMENT_VIEW_STORAGE_STATE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  ".dev-session",
  "e2e-document-view-storage-state.json",
);

export const RESUME_HEADER_STORAGE_STATE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  ".dev-session",
  "e2e-resume-header-storage-state.json",
);

export const RIREKISHO_PRINT_STORAGE_STATE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  ".dev-session",
  "e2e-rirekisho-print-storage-state.json",
);

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
