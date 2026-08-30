/**
 * THE SEAM. Two functions.
 *
 * Nothing outside this directory imports an SDK or names a provider.
 */
export type {
  CandidateFact,
  ExtractionContext,
  ModelSeam,
  RenderFact,
  RenderSpec,
} from "./types";
export { ModelUnavailableError } from "./types";
export { createAnthropicSeam } from "./providers/anthropic";
