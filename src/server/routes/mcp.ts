/**
 * The claude.ai connector: Track Record's MCP server over Streamable HTTP
 * (`docs/specs/mcp-spike.md`, decision log 2026-11-17).
 *
 * The one route that is not behind a session. It is behind an OAuth access
 * token instead, issued by Better Auth's `mcp` plugin after the author signed
 * in with Google and consented, and checked here on every request:
 *
 * - signed by a key in `jwks`, read in-process rather than fetched from the
 *   Worker's own URL;
 * - issued by this deployment, for this resource (`mcpResource`), carrying
 *   the `record` scope;
 * - for a user who still exists and is still on the allowlist, as the session
 *   middleware asks of a session.
 *
 * A request without a valid token is answered 401 with the RFC 9728 challenge
 * that points the client at the protected resource metadata, so the route
 * enumeration test still sees it fail closed. The user id the tools are bound
 * to comes from the token's subject and from nothing the client sends.
 */
import type { Hono } from "hono";
import { eq } from "drizzle-orm";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createInsufficientScopeError, isInsufficientScopeError, verifyJwsAccessToken } from "@better-auth/core/oauth2";
import { APIError } from "better-auth/api";
import { createResourceServerChallenge } from "@better-auth/oauth-provider";
import { users } from "../db/schema";
import { routes } from "../http/registry";
import { createAuth, isAllowedEmail, MCP_SCOPE, mcpResource } from "../auth";
import { createTrackRecordServer } from "~/mcp/server";
import type { AppEnv } from "../env";

export const MCP_PATH = "/api/mcp";

class Unauthorized extends Error {}

/**
 * The challenge the provider would send, as a JSON-RPC error body: a 403
 * naming the scope for a token without `record`, and for anything else (no
 * token, a bad signature, another audience, a user no longer allowed) a 401
 * pointing at the protected resource metadata, so the client signs in again.
 */
function challenge(error: unknown, resource: string): Response {
  const asked = isInsufficientScopeError(error) ? error : new APIError("UNAUTHORIZED", { message: "invalid_token" });
  const built = createResourceServerChallenge(asked, resource, { challengeScopes: [MCP_SCOPE] });
  const headers = new Headers(built?.headers);
  headers.set("Content-Type", "application/json");
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: built?.message ?? "Unauthorized" }, id: null }),
    { status: built?.statusCode ?? 401, headers },
  );
}

export function registerMcpRoutes(app: Hono<AppEnv>) {
  const api = routes(app);

  api.all(MCP_PATH, async (c) => {
    const db = c.get("db");
    const resource = mcpResource(c.env);
    const auth = createAuth(c.env, db);

    let userId: string;
    try {
      const header = c.req.header("authorization") ?? "";
      const token = /^Bearer\s+(.+)$/i.exec(header)?.[1]?.trim();
      if (!token) throw new Unauthorized("missing token");
      const { baseURL } = await auth.$context;
      const claims = await verifyJwsAccessToken(token, {
        // The keys from the database, through the plugin, not over HTTP.
        jwksFetch: async () => ({ keys: (await auth.api.getJwks()).keys }),
        verifyOptions: { issuer: baseURL, audience: resource, requiredClaims: ["sub", "azp"] },
      });
      const scopes = new Set(String(claims.scope ?? "").split(" ").filter(Boolean));
      if (!scopes.has(MCP_SCOPE)) throw createInsufficientScopeError([MCP_SCOPE]);

      const [user] = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.id, String(claims.sub))).limit(1);
      if (!user || !isAllowedEmail(c.env.ALLOWED_SIGNUP_EMAILS, user.email)) throw new Unauthorized("no such user");
      userId = user.id;
    } catch (error) {
      // An id and a reason class only. Never the token or its claims.
      console.log(JSON.stringify({ event: "mcp_unauthorized", reason: error instanceof Error ? error.constructor.name : "unknown" }));
      return challenge(error, resource);
    }

    // Stateless: one server and one transport per request, nothing held between them.
    const server = createTrackRecordServer(db, userId);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  });
}
