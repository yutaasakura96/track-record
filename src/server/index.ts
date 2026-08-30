/**
 * The Worker entry point.
 *
 * One deployable unit: the SPA (served from the ASSETS binding), the Hono API,
 * and the Workflow definitions (`docs/03-technical-design.md` §2).
 */
import { createApp } from "./app";
import type { Bindings } from "./env";

export { ImportWorkflow } from "~/pipeline/workflow";

const app = createApp();

export default {
  fetch(request: Request, env: Bindings, ctx: ExecutionContext) {
    return app.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Bindings>;
