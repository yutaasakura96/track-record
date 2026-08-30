/**
 * The auth surface (`docs/07-api-design.md` §3).
 *
 * These are the ONLY routes exempt from the session requirement — the OIDC
 * start, the callback, sign-out, and the session probe the SPA uses to discover
 * that it is signed out.
 */
import type { Hono } from "hono";
import { createAuth, isAllowedEmail, type SessionResolver } from "../auth";
import { ApiError } from "../http/errors";
import { routes } from "../http/registry";
import type { AppEnv } from "../env";

export function registerAuthRoutes(app: Hono<AppEnv>, resolveSession: SessionResolver) {
  const api = routes(app);

  // Registered before the catch-all so the literal path wins.
  api.get("/api/auth/session", async (c) => {
    const user = await resolveSession(c.req.raw, c.env, c.get("db"));
    if (!user) throw new ApiError("unauthenticated", "You are not signed in.");

    // A Google identity outside the allowlist completes OIDC and is then
    // rejected. The rejection also happens earlier, in `validateUserInfo`,
    // where it prevents a `users` row from being created at all.
    if (!isAllowedEmail(c.env.ALLOWED_SIGNUP_EMAILS, user.email)) {
      throw new ApiError("forbidden", "This deployment accepts one account.");
    }
    return c.json({ user });
  });

  api.all("/api/auth/*", (c) => createAuth(c.env, c.get("db")).handler(c.req.raw));
}
