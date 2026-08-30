/**
 * Better Auth, Google OIDC, and the allowlist (`docs/08-auth-and-permissions.md`).
 *
 * There are no passwords in this system, no password reset, and no email
 * verification — Google has already verified it.
 */
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { Db } from "./db/client";
import * as schema from "./db/schema";
import type { Bindings, SessionUser } from "./env";

/**
 * EXACTLY THREE SCOPES, AND NEVER MORE.
 *
 * `openid email profile` — you are signed in, your email address, your name and
 * picture. Never `gmail.*`, `drive.*`, `calendar.*` or any other Google API
 * scope: nothing in this product reads your mail, your files or your calendar,
 * and an over-scoped OAuth client turns a stolen session into a mailbox
 * compromise. This is a RELEASE BLOCKER, not a hardening task, and a future
 * feature that appears to need more is a decision-log entry and a re-consent,
 * not a config tweak.
 */
export const GOOGLE_SCOPES = ["openid", "email", "profile"] as const;

/**
 * Sign-up is invite-only permanently, not open registration held back
 * (`docs/08` §2). The allowlist is the degenerate case of the invite list,
 * which is why moving between them is a schema change at ONE enforcement point.
 */
export function isAllowedEmail(allowlist: string, email: string): boolean {
  const normalised = email.trim().toLowerCase();
  if (normalised === "") return false;
  return allowlist
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .includes(normalised);
}

export function createAuth(env: Bindings, db: Db) {
  return betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    basePath: "/api/auth",
    database: drizzleAdapter(db, {
      provider: "pg",
      schema,
    }),
    // The table names below MUST mirror src/server/db/schema.ts. Better Auth's
    // defaults are singular with camelCase columns; without these overrides the
    // auth tables become the only ones in the database following different
    // conventions (`docs/04` §3.1).
    user: {
      modelName: "users",
      /**
       * The allowlist gate. `validateUserInfo` is used rather than
       * `databaseHooks.user.create.before` because it fires before ACCOUNT
       * LINKING as well as before user creation — so a rejected identity
       * leaves NO `users` row at all, not even a linked one.
       */
      validateUserInfo: ({ user }: { user: { email?: string | null } }) =>
        isAllowedEmail(env.ALLOWED_SIGNUP_EMAILS, user.email ?? "")
          ? undefined
          : {
              error: "email_not_allowed",
              errorDescription: "This deployment accepts one account.",
            },
    },
    session: { modelName: "sessions" },
    account: { modelName: "accounts" },
    verification: { modelName: "verifications" },
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        scope: [...GOOGLE_SCOPES],
      },
    },
    emailAndPassword: { enabled: false },
  });
}

export type Auth = ReturnType<typeof createAuth>;

/**
 * How a request becomes a user.
 *
 * A seam, because the tests that matter here assert OUR middleware and OUR
 * allowlist — Better Auth's own session implementation is a maintained
 * library's behaviour and is deliberately not retested (`docs/11` §4).
 */
export type SessionResolver = (request: Request, env: Bindings, db: Db) => Promise<SessionUser | null>;

export const betterAuthSessions: SessionResolver = async (request, env, db) => {
  const auth = createAuth(env, db);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user?.id) return null;
  return {
    id: session.user.id,
    email: session.user.email ?? "",
    name: session.user.name ?? "",
  };
};
