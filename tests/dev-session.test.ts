/**
 * `npm run dev:session` (`docs/06`, 2026-09-25).
 *
 * The guard is proved as pure functions: it is what stands between the script
 * and a deployed database or secret, and it has to refuse before anything is
 * written. The walk is proved against the real Hono app with real sessions —
 * the cookie it returns has to be one the application's own session probe
 * accepts, which is what the SPA checks before it shows a signed-in screen.
 */
import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { createApp } from "~/server/app";
import type { Bindings } from "~/server/env";
import {
  DEV_SESSION_IDENTITY,
  checkLocalOnly,
  createDevSession,
  storageState,
} from "../scripts/dev-session-core";
import { stubModel } from "./helpers/harness";

const LOCAL = {
  DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/track_record_dev?sslmode=disable",
  BETTER_AUTH_SECRET: "local-secret-for-this-test",
  BETTER_AUTH_URL: "http://localhost:8787",
  ALLOWED_SIGNUP_EMAILS: `author@example.invalid,${DEV_SESSION_IDENTITY.email}`,
};

const devVars = (overrides: Partial<typeof LOCAL> = {}) =>
  Object.entries({ ...LOCAL, ...overrides })
    .map(([key, value]) => `${key}="${value}"`)
    .join("\n");

const refusals = (contents: string | null, nodeEnv?: string) => {
  const result = checkLocalOnly(contents, nodeEnv);
  return result.ok ? [] : result.refusals;
};

describe("the local-only guard", () => {
  it("passes a .dev.vars that describes this machine", () => {
    const result = checkLocalOnly(devVars(), "development");
    expect(result).toEqual({
      ok: true,
      config: {
        databaseUrl: LOCAL.DATABASE_URL,
        origin: "http://localhost:8787",
        secret: LOCAL.BETTER_AUTH_SECRET,
        allowlist: LOCAL.ALLOWED_SIGNUP_EMAILS,
      },
    });
  });

  it("passes the docker-compose service name and 127.0.0.1 as local", () => {
    for (const host of ["postgres", "127.0.0.1"]) {
      const url = `postgresql://postgres:postgres@${host}:5432/track_record_dev`;
      expect(refusals(devVars({ DATABASE_URL: url }))).toEqual([]);
    }
  });

  it("refuses a database that is not on this machine", () => {
    const reasons = refusals(
      devVars({ DATABASE_URL: "postgresql://user:pw@ep-cool-name.us-east-2.aws.neon.tech/neondb?sslmode=require" }),
    );
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain("ep-cool-name.us-east-2.aws.neon.tech");
    // The password is never repeated back.
    expect(reasons[0]).not.toContain("pw@");
  });

  it("refuses a production NODE_ENV", () => {
    const reasons = refusals(devVars(), "production");
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain("NODE_ENV is production");
  });

  it("refuses a deployed BETTER_AUTH_URL, since the secret beside it may be a deployed one", () => {
    for (const url of ["https://track-record.example.com", "https://localhost:8787", ""]) {
      const reasons = refusals(devVars({ BETTER_AUTH_URL: url }));
      expect(reasons).toHaveLength(1);
      expect(reasons[0]).toContain("BETTER_AUTH_URL");
    }
  });

  it("refuses the suite's database, an empty secret, and a missing invite", () => {
    expect(
      refusals(devVars({ DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/track_record_test" })),
    ).toEqual([expect.stringContaining("track_record_test")]);
    expect(refusals(devVars({ BETTER_AUTH_SECRET: "" }))).toEqual([
      expect.stringContaining("BETTER_AUTH_SECRET"),
    ]);
    expect(refusals(devVars({ ALLOWED_SIGNUP_EMAILS: "author@example.invalid" }))).toEqual([
      expect.stringContaining(DEV_SESSION_IDENTITY.email),
    ]);
  });

  it("refuses when there is no .dev.vars, and says every reason at once otherwise", () => {
    expect(refusals(null)).toEqual([expect.stringContaining(".dev.vars was not found")]);
    expect(
      refusals(
        devVars({ DATABASE_URL: "postgresql://u:p@db.example.com/x", BETTER_AUTH_URL: "https://x.example.com" }),
        "production",
      ),
    ).toHaveLength(3);
  });
});

describe("the dev session", () => {
  const test = env as unknown as Bindings;
  // The test allowlist does not carry the dev-session address; `.dev.vars` does,
  // which the guard above insists on.
  const bindings: Bindings = {
    ...test,
    ALLOWED_SIGNUP_EMAILS: `${test.ALLOWED_SIGNUP_EMAILS},${DEV_SESSION_IDENTITY.email}`,
  };
  const origin = new URL(test.BETTER_AUTH_URL).origin;
  // No `sessions` override: every request resolves through Better Auth, as deployed.
  const app = createApp({ model: () => stubModel() });
  const context = {
    waitUntil() {},
    passThroughOnException() {},
    props: {},
  } as unknown as ExecutionContext;
  const handler = async (request: Request) => app.fetch(request, bindings, context);
  const client = { clientId: test.GOOGLE_CLIENT_ID, clientSecret: test.GOOGLE_CLIENT_SECRET };
  const get = (path: string, cookie?: string) =>
    handler(new Request(`${origin}${path}`, cookie ? { headers: { cookie } } : {}));

  it("yields a session the application accepts, and reuses the same user", async () => {
    // The control: without the cookie the SPA's session probe says signed out.
    expect((await get("/api/auth/session")).status).toBe(401);

    const first = await createDevSession(handler, origin, client);
    const cookie = `${first.session.name}=${first.session.value}`;

    const session = await get("/api/auth/session", cookie);
    expect(session.status).toBe(200);
    expect(await session.json()).toEqual({
      user: { id: first.user.id, email: DEV_SESSION_IDENTITY.email, name: DEV_SESSION_IDENTITY.name },
    });
    // A protected route is past the gate: whatever it answers, it is not 401.
    expect((await get("/api/profile", cookie)).status).not.toBe(401);

    const second = await createDevSession(handler, origin, client);
    expect(second.user.id).toBe(first.user.id);
    expect(second.session.value).not.toBe(first.session.value);
  });

  it("describes the cookie as a Playwright storageState", async () => {
    const { cookies, session } = await createDevSession(handler, origin, client);
    const state = storageState(cookies, origin, Date.UTC(2026, 8, 25));
    const stored = state.cookies.find((cookie) => cookie.name === session.name);
    expect(stored).toMatchObject({
      value: session.value,
      domain: new URL(origin).hostname,
      path: "/",
      httpOnly: true,
    });
    expect(stored!.expires).toBeGreaterThan(Date.UTC(2026, 8, 25) / 1000);
    expect(state.origins).toEqual([]);
  });
});
