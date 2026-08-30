/**
 * Request validation at the route boundary, server side.
 *
 * Client-side validation exists for ergonomics only and is never trusted
 * (`docs/03-technical-design.md` §8).
 */
import type { Context } from "hono";
import type { z } from "zod";
import { ApiError, validationFailed } from "../http/errors";
import type { AppEnv } from "../env";

export async function parseBody<S extends z.ZodType>(
  c: Context<AppEnv>,
  schema: S,
): Promise<z.output<S>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new ApiError("validation_failed", "That request body was not valid JSON.");
  }
  return parse(schema, raw);
}

export function parse<S extends z.ZodType>(schema: S, raw: unknown): z.output<S> {
  const result = schema.safeParse(raw);
  if (result.success) return result.data;

  // `details.fields` names the offenders so the form can mark them inline. The
  // messages come from the schema and are written for a human; no field value
  // is echoed back, because a value here can be record content.
  const fields = [...new Set(result.error.issues.map((i) => i.path.join(".")).filter(Boolean))];
  const first = result.error.issues[0];
  throw validationFailed(first?.message ?? "That request could not be accepted.", fields);
}
