/**
 * The invite gate (`docs/08-auth-and-permissions.md` §2).
 *
 * The application is publicly reachable. **Sign-up is not.** Open registration
 * is not a later default that invite-only is holding back — invite-only is the
 * model, and the allowlist is the degenerate case of the invite list.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { isAllowedEmail } from "~/server/auth";
import { accounts, users } from "~/server/db/schema";
import { harness, stubModel } from "./helpers/harness";
import { installIssuer, type FixtureIssuer } from "./helpers/oidc";
import { seedAllowedUser, AUTHOR_EMAIL, SECOND_EMAIL } from "./helpers/seed";
import type { Bindings } from "~/server/env";

const allowlist = (env as unknown as Bindings).ALLOWED_SIGNUP_EMAILS;

const STRANGER_EMAIL = "stranger@elsewhere.invalid";

let issuer: FixtureIssuer;

beforeAll(async () => {
  issuer = await installIssuer();
});

afterAll(() => issuer.uninstall());

describe("the allowlist", () => {
  it("admits an address on the list, however it is cased or spaced", () => {
    expect(isAllowedEmail(allowlist, AUTHOR_EMAIL)).toBe(true);
    expect(isAllowedEmail(allowlist, `  ${AUTHOR_EMAIL.toUpperCase()}  `)).toBe(true);
  });

  it("refuses everything else, including the empty case", () => {
    expect(isAllowedEmail(allowlist, "stranger@elsewhere.invalid")).toBe(false);
    expect(isAllowedEmail(allowlist, "")).toBe(false);
    expect(isAllowedEmail(allowlist, "   ")).toBe(false);
    // A substring of an allowed address is not an allowed address.
    expect(isAllowedEmail(allowlist, AUTHOR_EMAIL.slice(1))).toBe(false);
    expect(isAllowedEmail(allowlist, `x${AUTHOR_EMAIL}`)).toBe(false);
  });

  it("refuses everything when the list is empty — closed, not open", () => {
    expect(isAllowedEmail("", AUTHOR_EMAIL)).toBe(false);
    expect(isAllowedEmail("  ,  ", AUTHOR_EMAIL)).toBe(false);
  });
});

describe("a Google identity outside the allowlist", () => {
  it("is rejected with the only 403 in the API, on every route", async () => {
    const stranger = harness().as({
      id: "usr_stranger",
      email: "stranger@elsewhere.invalid",
      name: "Stranger",
    });

    for (const path of ["/api/auth/session", "/api/overview", "/api/profile", "/api/export"]) {
      const response = await stranger.get(path);
      expect(response.status, path).toBe(403);
      const body = (await response.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe("forbidden");
      expect(body.error.message).toMatch(/one account/i);
    }
  });

  it("still admits the author", async () => {
    const client = harness().as(await seedAllowedUser());
    expect((await client.get("/api/auth/session")).status).toBe(200);
  });
});

/**
 * The gate as Better Auth actually runs it (issue #3). The tests above assert
 * the predicate and the middleware; these assert the SIGN-IN PATH, through a
 * local OIDC issuer run as a fixture — which is the only place `validateUserInfo`
 * can be observed doing its job.
 */
describe("the allowlist, on the real sign-in path", () => {
  it("admits an invited identity, and records the issuer that asserted it", async () => {
    const app = harness(stubModel(), { realSessions: true });
    const walk = await app.signIn(issuer, {
      sub: "115902847362519048371",
      email: SECOND_EMAIL,
      name: "Invited Author",
    });

    expect(walk.location).toBe("/");
    const session = await walk.client.json<{ user: { email: string } }>("/api/auth/session");
    expect(session.user.email).toBe(SECOND_EMAIL);

    const [created] = await app.db.select().from(users).where(eq(users.email, SECOND_EMAIL));
    expect(created).toBeDefined();

    // `accounts.issuer` is the OIDC issuer, not the provider id. A missing
    // column here surfaced as a SQL syntax error on the callback (`docs/06`,
    // 2026-09-01, item 3) and nothing in the suite could see it.
    const [account] = await app.db.select().from(accounts).where(eq(accounts.userId, created!.id));
    expect(account?.issuer).toBe("https://accounts.google.com");
    expect(account?.providerId).toBe("google");
  });

  it("refuses an identity off the list, and leaves no user row behind", async () => {
    const app = harness(stubModel(), { realSessions: true });
    const walk = await app.signIn(issuer, {
      sub: "129384756019283746501",
      email: STRANGER_EMAIL,
      name: "Stranger",
    });

    // The rejection is a redirect to the error URL the sign-in asked for,
    // carrying the reason `validateUserInfo` gave.
    expect(walk.callback.status).toBe(302);
    expect(walk.location).toContain("/sign-in");
    expect(walk.location).toContain("error=email_not_allowed");

    // No session came out of it.
    expect((await walk.client.get("/api/auth/session")).status).toBe(401);

    // And NO row. This is what `validateUserInfo` is for: it fires before
    // account linking as well as before user creation, so a rejected identity
    // leaves nothing at all — not even a linked account (`docs/08` §2).
    const rows = await app.db.select().from(users).where(eq(users.email, STRANGER_EMAIL));
    expect(rows).toHaveLength(0);
  });
});
