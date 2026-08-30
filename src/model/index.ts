/**
 * THE SEAM. Two functions.
 *
 * **Nothing outside this directory imports an SDK or names a provider** — and
 * that includes the provider's environment variables, which is why the bindings
 * it needs are declared here rather than in `src/server/env.ts`. Callers ask for
 * `createModelSeam(env)`; what that resolves to is this directory's business.
 *
 * Swapping providers is a configuration value plus one adapter file
 * (`docs/03-technical-design.md` §4).
 */
import { createAnthropicSeam } from "./providers/anthropic";
import type { ModelSeam } from "./types";

export type {
  CandidateFact,
  ExtractionContext,
  ModelSeam,
  RenderFact,
  RenderSpec,
} from "./types";
export { ModelUnavailableError } from "./types";

/**
 * The Worker bindings the model seam reads. `src/server/env.ts` extends the
 * application's bindings from this, so a provider change moves these key names
 * without the server knowing they moved.
 */
export interface ModelBindings {
  ANTHROPIC_API_KEY: string;
  ANTHROPIC_MODEL: string;
}

export function createModelSeam(env: ModelBindings): ModelSeam {
  return createAnthropicSeam({ apiKey: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL });
}
