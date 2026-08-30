/**
 * The Hono application.
 *
 * Deny-by-default: the session middleware covers EVERY route except the auth
 * callbacks. A route added without thinking about auth fails closed, and the
 * route-enumeration test reads the project's own registry to prove it
 * (`docs/08-auth-and-permissions.md` §4).
 */
import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { ApiError, errorResponse } from "./http/errors";
import { isPublicPath } from "./http/registry";
import { createDb } from "./db/client";
import { betterAuthSessions, isAllowedEmail, type SessionResolver } from "./auth";
import { createModelSeam } from "~/model";
import type { ModelSeam } from "~/model";
import type { AppEnv } from "./env";

import { registerAuthRoutes } from "./routes/auth";
import { registerProfileRoutes } from "./routes/profile";
import { registerRecordRoutes } from "./routes/record";
import { registerImportRoutes } from "./routes/imports";
import { registerFactRoutes } from "./routes/facts";
import { registerRenderRoutes } from "./routes/renders";
import { registerOverviewRoutes } from "./routes/overview";

export interface AppOptions {
  /** Overridden in tests. No test ever calls a real model (`docs/11` §1). */
  model?: (env: AppEnv["Bindings"]) => ModelSeam;
  /** Overridden in tests; production resolves through Better Auth. */
  sessions?: SessionResolver;
}

export function createApp(options: AppOptions = {}) {
  const app = new Hono<AppEnv>();
  const resolveSession = options.sessions ?? betterAuthSessions;
  const modelFor = options.model ?? createModelSeam;

  app.use("*", async (c, next) => {
    c.set("db", createDb(c.env.DATABASE_URL));
    c.set("model", modelFor(c.env));
    await next();
  });

  app.use("*", denyByDefault(resolveSession));

  app.onError((err, c) => errorResponse(c, err));
  app.notFound((c) => errorResponse(c, new ApiError("not_found", "That endpoint does not exist.")));

  // Registration order matters only where a literal path sits under a wildcard:
  // /api/auth/session is registered before the Better Auth catch-all.
  registerAuthRoutes(app, resolveSession);
  registerProfileRoutes(app);
  registerRecordRoutes(app);
  registerImportRoutes(app);
  registerFactRoutes(app);
  registerRenderRoutes(app);
  registerOverviewRoutes(app);

  return app;
}

/**
 * Requires a valid session on every route whose path is not on the exemption
 * list — which is the auth callbacks and nothing else.
 */
function denyByDefault(resolveSession: SessionResolver): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (isPublicPath(new URL(c.req.url).pathname)) return next();

    const user = await resolveSession(c.req.raw, c.env, c.get("db"));
    if (!user) throw new ApiError("unauthenticated", "Sign in to continue.");

    // Defence in depth against an allowlist that shrinks while a session is
    // still alive. The only 403 in the API (`docs/07` §3).
    if (!isAllowedEmail(c.env.ALLOWED_SIGNUP_EMAILS, user.email)) {
      throw new ApiError("forbidden", "This deployment accepts one account.");
    }

    c.set("user", user);
    await next();
  };
}
