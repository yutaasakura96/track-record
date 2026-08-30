/**
 * The invite gate (`docs/08-auth-and-permissions.md` §2).
 *
 * The application is publicly reachable. **Sign-up is not.** Open registration
 * is not a later default that invite-only is holding back — invite-only is the
 * model, and the allowlist is the degenerate case of the invite list.
 */
import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { isAllowedEmail } from "~/server/auth";
import { harness } from "./helpers/harness";
import { seedAllowedUser, AUTHOR_EMAIL } from "./helpers/seed";
import type { Bindings } from "~/server/env";

const allowlist = (env as unknown as Bindings).ALLOWED_SIGNUP_EMAILS;

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
