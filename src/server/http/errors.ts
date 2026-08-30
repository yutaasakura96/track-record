/**
 * The one error shape, from `docs/07-api-design.md` §2.
 *
 * **No error body ever contains source text, a fact claim, or render content.**
 * Constructors take a message written for a human; callers are responsible for
 * not passing record content into one.
 */
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export type ErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "validation_failed"
  | "conflict"
  | "precondition_failed"
  | "upstream_unavailable"
  | "internal";

const STATUS: Record<ErrorCode, ContentfulStatusCode> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  validation_failed: 422,
  conflict: 409,
  precondition_failed: 428,
  upstream_unavailable: 503,
  internal: 500,
};

export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
  }

  get status(): ContentfulStatusCode {
    return STATUS[this.code];
  }

  toBody() {
    return {
      error: { code: this.code, message: this.message, ...(this.details ? { details: this.details } : {}) },
    };
  }
}

/**
 * A record that does not exist and a record belonging to another user are the
 * same answer. A 403 would confirm the record exists (`docs/07` §1).
 */
export const notFound = (what: string) => new ApiError("not_found", `${what} was not found.`);

export const validationFailed = (message: string, fields: string[]) =>
  new ApiError("validation_failed", message, { fields });

export const preconditionFailed = (message: string, fields: string[]) =>
  new ApiError("precondition_failed", message, { fields });

export function errorResponse(c: Context, err: unknown) {
  if (err instanceof ApiError) return c.json(err.toBody(), err.status);

  // Unhandled. The id is what ties the response to the log line; the message is
  // not echoed, because an upstream message can carry content we do not emit.
  const id = crypto.randomUUID();
  console.error(JSON.stringify({ event: "unhandled_error", errorId: id, name: (err as Error)?.name }));
  return c.json(
    new ApiError("internal", `Something went wrong. Reference ${id}.`).toBody(),
    500,
  );
}

/**
 * A path parameter, or a 404.
 *
 * Hono types `c.req.param()` as possibly undefined once a route is registered
 * through a wrapper. Coercing that away with `!` would turn a routing mistake
 * into a query against `undefined`; this turns it into the same answer a
 * genuinely missing record gets.
 */
export function pathParam(c: Context, name: string): string {
  const value = c.req.param(name);
  if (!value) throw new ApiError("not_found", "That endpoint does not exist.");
  return value;
}
