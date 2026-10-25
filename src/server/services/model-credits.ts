/**
 * The one place a route turns a failed model call into the answer the member
 * sees. A call that failed for want of credits says so, and logs an event of
 * its own so the owner can tell "out of credits" from an outage
 * (`docs/12` §9, `docs/13` §2). Every other unavailable-model failure keeps
 * the route's own words.
 */
import { ApiError } from "../http/errors";
import { CREDITS_EXHAUSTED_MESSAGE, ModelCreditsExhaustedError } from "~/model";

/** `error.details.reason`, for the screens that would otherwise word a model failure themselves. */
export const CREDITS_REASON = "credits_exhausted";

/** The step name and nothing else. Never the text, the facts or the response body. */
export function logCreditsExhausted(step: string): void {
  console.warn(JSON.stringify({ event: "model_credits_exhausted", step }));
}

/**
 * `null` when `err` is not the out-of-credits case, so the caller carries on
 * with its own failure log and message. Retryable like any 503.
 */
export function creditsExhaustedError(err: unknown, step: string): ApiError | null {
  if (!(err instanceof ModelCreditsExhaustedError)) return null;
  logCreditsExhausted(step);
  return new ApiError("upstream_unavailable", CREDITS_EXHAUSTED_MESSAGE, { reason: CREDITS_REASON });
}
