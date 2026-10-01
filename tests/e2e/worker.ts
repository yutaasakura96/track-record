/**
 * The test-only Worker entry (`docs/11-testing-plan.md` §2.9, issue #33).
 *
 * The production entry with one difference: the model is the stub. It lives
 * here, under `tests/`, and `src/server` gains no switch to reach it.
 */
import { createApp } from "~/server/app";
import type { Bindings } from "~/server/env";
import { e2eModel } from "./model";

const app = createApp({ model: () => e2eModel });

export default {
  fetch(request: Request, env: Bindings, ctx: ExecutionContext) {
    return app.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Bindings>;
