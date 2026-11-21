/**
 * The Worker entry point.
 *
 * One deployable unit: the SPA (served from the ASSETS binding), the Hono API,
 * and the Workflow definitions (`docs/03-technical-design.md` §2).
 */
import { createApp } from "./app";
import { createAuth } from "./auth";
import { createDb } from "./db/client";
import type { Bindings } from "./env";

/**
 * The OAuth discovery documents the claude.ai connector's client reads, at
 * the host root where RFC 8414 and RFC 9728 put them (decision log
 * 2026-11-17). Exactly these three, each served by Better Auth's provider and
 * each public metadata with nothing of the record in it. Everything else
 * under `/.well-known/` is the static assets', as before.
 */
export const DISCOVERY_PATHS = new Set([
  "/.well-known/oauth-authorization-server/api/auth",
  "/.well-known/oauth-protected-resource",
  "/.well-known/oauth-protected-resource/api/mcp",
]);

export { GenerationWorkflow } from "~/pipeline/generation-workflow";
export { ImportWorkflow } from "~/pipeline/workflow";

const app = createApp();

export default {
  fetch(request: Request, env: Bindings, ctx: ExecutionContext) {
    if (DISCOVERY_PATHS.has(new URL(request.url).pathname)) {
      return createAuth(env, createDb(env.DATABASE_URL)).handler(request);
    }
    return app.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Bindings>;
