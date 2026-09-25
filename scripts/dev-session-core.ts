/**
 * The runtime-agnostic half of `npm run dev:session` (`docs/06`, 2026-09-25).
 *
 * The guard and the walk live here, apart from `./dev-session.ts`, so the suite
 * can run both inside the Workers runtime: the guard as pure functions, the
 * walk against the real Hono app. Nothing under `src/` imports this file.
 */
import { isAllowedEmail } from "~/server/auth";
import { SUITE_DATABASE, databaseTarget, devVar } from "../tests/database-guard";
import { createIssuer, type IssuerCredentials, type OidcIdentity } from "../tests/helpers/oidc-issuer";
import { CookieJar, walkSignIn, type Send, type StoredCookie } from "../tests/helpers/sign-in";

/**
 * The local test user. Invented, like every fixture here, and the same on every
 * run: Better Auth finds the account by provider subject, so a second run signs
 * the same user in again rather than creating another one.
 */
export const DEV_SESSION_IDENTITY: OidcIdentity = {
  sub: "dev-session-local",
  email: "dev-session@example.invalid",
  name: "Dev Session",
};

/**
 * What the in-process Better Auth and the fixture issuer agree on. Not a Google
 * client: the script never reads `GOOGLE_CLIENT_*` from `.dev.vars`, because the
 * session cookie does not depend on them and the real ones have no business here.
 */
export const DEV_SESSION_CLIENT: IssuerCredentials = {
  clientId: "dev-session-fixture-client",
  clientSecret: "dev-session-fixture-secret",
};

/** The Vite dev server's default port, which `npm run dev` serves the SPA on. */
const VITE_PORT = "5173";

const LOCAL_ORIGIN_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** The `.dev.vars` values the script needs, once the guard has passed them. */
export interface LocalConfig {
  databaseUrl: string;
  /** The origin `BETTER_AUTH_URL` names — the dev worker's. */
  origin: string;
  secret: string;
  allowlist: string;
}

export type GuardResult = { ok: true; config: LocalConfig } | { ok: false; refusals: string[] };

/**
 * Refuses anything that is not local development, before anything is written.
 *
 * The signal for "local" is the one the project already has: `.dev.vars` is the
 * local counterpart of Workers secrets (`.gitignore`), and deployed secrets live
 * only in Cloudflare (`wrangler.toml`). So the values are read from that file
 * and nowhere else, and each has to name this machine. A `BETTER_AUTH_URL` on a
 * deployed origin is what says the secret beside it may be a deployed one.
 *
 * Every refusal is collected rather than the first thrown, so one run says
 * everything that needs changing.
 */
export function checkLocalOnly(devVars: string | null, nodeEnv: string | undefined): GuardResult {
  if (devVars === null) {
    return {
      ok: false,
      refusals: [
        ".dev.vars was not found. Copy .dev.vars.example to .dev.vars; the script reads its values from that file only.",
      ],
    };
  }

  const refusals: string[] = [];
  if (nodeEnv === "production") {
    refusals.push("NODE_ENV is production. A dev session is for local development only.");
  }

  const databaseUrl = devVar(devVars, "DATABASE_URL") ?? "";
  const target = databaseUrl === "" ? null : databaseTarget(databaseUrl);
  if (!target) {
    refusals.push("DATABASE_URL in .dev.vars is missing or not a connection string this can read.");
  } else if (target.host !== "localhost") {
    refusals.push(
      `DATABASE_URL in .dev.vars points at ${target.host}, not the local Postgres ` +
        "(localhost, 127.0.0.1 or the docker-compose `postgres` service).",
    );
  } else if (target.database === SUITE_DATABASE) {
    refusals.push(
      `DATABASE_URL in .dev.vars names ${SUITE_DATABASE}, which the suite drops on every run. ` +
        "Point it at track_record_dev (see .dev.vars.example).",
    );
  }

  const authUrl = devVar(devVars, "BETTER_AUTH_URL") ?? "";
  const origin = localOrigin(authUrl);
  if (!origin) {
    refusals.push(
      `BETTER_AUTH_URL in .dev.vars is ${JSON.stringify(authUrl)}, not an http:// origin on this machine. ` +
        "A deployed origin means the secret beside it may be a deployed one.",
    );
  }

  const secret = devVar(devVars, "BETTER_AUTH_SECRET") ?? "";
  if (secret === "") {
    refusals.push("BETTER_AUTH_SECRET in .dev.vars is empty. Generate one with: openssl rand -base64 32");
  }

  const allowlist = devVar(devVars, "ALLOWED_SIGNUP_EMAILS") ?? "";
  if (!isAllowedEmail(allowlist, DEV_SESSION_IDENTITY.email)) {
    refusals.push(
      `ALLOWED_SIGNUP_EMAILS in .dev.vars does not include ${DEV_SESSION_IDENTITY.email}, so the ` +
        "invite gate would refuse the local test user. Add it to the comma-separated list.",
    );
  }

  if (refusals.length > 0 || !origin) return { ok: false, refusals };
  return { ok: true, config: { databaseUrl, origin, secret, allowlist } };
}

function localOrigin(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" || !LOCAL_ORIGIN_HOSTS.has(url.hostname)) return null;
  return url.origin;
}

export interface DevSession {
  /** Every cookie the callback left set. The session token is among them. */
  cookies: StoredCookie[];
  session: StoredCookie;
  user: { id: string; email: string };
}

/**
 * Signs the local test user in through Better Auth's own sign-in path, with the
 * suite's OIDC issuer standing in for Google (`tests/helpers/oidc-issuer.ts`),
 * and returns the cookie the callback set. Nothing here signs a cookie: Better
 * Auth does, with the secret `handler` was built with.
 *
 * `handler` must be the application's auth surface configured with `client`
 * as its Google credentials. The issuer claims Google's origins in this
 * process for the length of the walk and no longer.
 */
export async function createDevSession(
  handler: (request: Request) => Promise<Response>,
  origin: string,
  client: IssuerCredentials = DEV_SESSION_CLIENT,
  identity: OidcIdentity = DEV_SESSION_IDENTITY,
): Promise<DevSession> {
  const jar = new CookieJar();
  const send: Send = async (path, init = {}) => {
    const headers = new Headers(init.headers);
    const cookies = jar.header();
    if (cookies) headers.set("cookie", cookies);
    const response = await handler(new Request(`${origin}${path}`, { ...init, headers }));
    jar.capture(response);
    return response;
  };

  const issuer = await createIssuer(client);
  issuer.install();
  let location: string;
  try {
    ({ location } = await walkSignIn(send, issuer, identity));
  } finally {
    issuer.uninstall();
  }

  const session = jar.cookies().find((cookie) => cookie.name.endsWith("session_token"));
  if (!session) {
    throw new Error(`Sign-in did not set a session cookie; the callback redirected to ${location || "nowhere"}.`);
  }

  const probe = await send("/api/auth/get-session");
  const body = (await probe.json().catch(() => null)) as { user?: { id?: string; email?: string } } | null;
  if (!probe.ok || !body?.user?.id) {
    throw new Error(`The new session did not resolve: get-session answered ${probe.status}.`);
  }
  return { cookies: jar.cookies(), session, user: { id: body.user.id, email: body.user.email ?? "" } };
}

/** The Vite dev server's address, on the host the cookie belongs to. */
export function appUrl(origin: string): string {
  return `http://${new URL(origin).hostname}:${VITE_PORT}/`;
}

/** A Playwright `storageState` document carrying the cookies, for `--storage-state`. */
export function storageState(cookies: StoredCookie[], origin: string, now = Date.now()) {
  const domain = new URL(origin).hostname;
  return {
    cookies: cookies.map((cookie) => ({
      name: cookie.name,
      value: cookie.value,
      domain,
      path: attribute(cookie, "path") ?? "/",
      expires: expiresAt(cookie, now),
      httpOnly: cookie.attributes.httponly === true,
      secure: cookie.attributes.secure === true,
      sameSite: sameSite(attribute(cookie, "samesite")),
    })),
    origins: [],
  };
}

/**
 * The same cookie as a line of page script, for a browser tool with an `eval`
 * and no cookie API. `HttpOnly` cannot be set from script; the server does not
 * ask for it, so the session still resolves.
 */
export function documentCookieScript(cookie: StoredCookie): string {
  const path = attribute(cookie, "path") ?? "/";
  return `document.cookie = ${JSON.stringify(`${cookie.name}=${cookie.value}; path=${path}; samesite=lax`)}`;
}

function attribute(cookie: StoredCookie, name: string): string | undefined {
  const value = cookie.attributes[name];
  return typeof value === "string" ? value : undefined;
}

/** Seconds since the epoch, or -1 for a session cookie — Playwright's convention. */
function expiresAt(cookie: StoredCookie, now: number): number {
  const maxAge = Number(attribute(cookie, "max-age"));
  if (Number.isFinite(maxAge) && maxAge > 0) return Math.floor(now / 1000) + maxAge;
  const expires = Date.parse(attribute(cookie, "expires") ?? "");
  return Number.isNaN(expires) ? -1 : Math.floor(expires / 1000);
}

function sameSite(value: string | undefined): "Strict" | "Lax" | "None" {
  switch (value?.toLowerCase()) {
    case "strict":
      return "Strict";
    case "none":
      return "None";
    default:
      return "Lax";
  }
}
