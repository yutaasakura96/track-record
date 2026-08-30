/**
 * Worker bindings and the Hono environment.
 *
 * Secrets are never defaulted and never logged. `docs/13-infrastructure-security.md` §5.
 */
import type { ModelBindings, ModelSeam } from "~/model";
import type { Db } from "./db/client";

/**
 * `ModelBindings` is extended rather than restated: the provider's key names are
 * `src/model/`'s business, and naming them here would make swapping providers an
 * edit to the server (`docs/03` §4).
 */
export interface Bindings extends ModelBindings {
  /** Neon connection string. A DEV branch locally, never main. */
  DATABASE_URL: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  /** Comma-separated. Sign-up is invite-only by design (`docs/08` §2). */
  ALLOWED_SIGNUP_EMAILS: string;
  /** Absent in tests and in local dev; see src/pipeline/workflow.ts. */
  IMPORT_WORKFLOW?: { create(options: { params: unknown }): Promise<unknown> };
}

/** Established by the session middleware. Never optional downstream of it. */
export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

export interface Variables {
  db: Db;
  model: ModelSeam;
  /** Present on every protected route. Absent only on the auth callbacks. */
  user: SessionUser;
}

export type AppEnv = { Bindings: Bindings; Variables: Variables };
