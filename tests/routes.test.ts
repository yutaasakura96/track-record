/**
 * Seam 2 — the route registry (`docs/11-testing-plan.md` §2.1).
 *
 * Route enumeration cannot be observed over HTTP, because it must ENUMERATE.
 * This is one of the two tests that earn a lower seam.
 *
 * A newly added unprotected endpoint breaks the build rather than shipping.
 */
import { describe, expect, it } from "vitest";
import { createApp } from "~/server/app";
import { PUBLIC_PATH_PREFIXES, registeredRoutes } from "~/server/http/registry";
import { harness } from "./helpers/harness";

// Building the app is what populates the registry.
createApp();

/** A concrete path for a pattern, so the route can actually be called. */
const concrete = (path: string) => path.replace(/:[^/]+/g, "placeholder");

describe("deny-by-default routing", () => {
  it("registers every route through the wrapper", () => {
    expect(registeredRoutes().length).toBeGreaterThan(15);
    for (const route of registeredRoutes()) {
      expect(route.path.startsWith("/api/")).toBe(true);
    }
  });

  it("exempts only the auth callbacks", () => {
    const publicRoutes = registeredRoutes().filter((r) => r.isPublic);
    for (const route of publicRoutes) {
      expect(PUBLIC_PATH_PREFIXES.some((p) => route.path.startsWith(p))).toBe(true);
    }
    expect(publicRoutes.every((r) => r.path.startsWith("/api/auth/"))).toBe(true);
  });

  it("answers every protected route with 401 when there is no session", async () => {
    const client = harness().anonymous();

    for (const route of registeredRoutes()) {
      if (route.isPublic) continue;
      const response = await client.request(concrete(route.path), {
        method: route.method === "ALL" ? "GET" : route.method,
      });
      expect(
        response.status,
        `${route.method} ${route.path} must require a session`,
      ).toBe(401);
      const body = (await response.json()) as { error: { code: string } };
      expect(body.error.code).toBe("unauthenticated");
    }
  });

  it("rejects a session outside the allowlist with the only 403 in the API", async () => {
    const client = harness().as({ id: "usr_stranger", email: "stranger@elsewhere.invalid", name: "Stranger" });
    const response = await client.get("/api/overview");
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("forbidden");
  });
});
