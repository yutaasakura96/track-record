/**
 * Profile (`docs/07-api-design.md` §4).
 *
 * `GET` returns 404 when no profile exists, and the client redirects to the
 * profile form from that — every render needs a name to put on it, so nothing
 * else in the app is reachable until identity exists.
 */
import type { Hono } from "hono";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { profiles } from "../db/schema";
import { notFound } from "../http/errors";
import { routes } from "../http/registry";
import { newId } from "../http/ids";
import { parseBody } from "../services/validate";
import { MONTH_DATE_PATTERN } from "~/shared/calendar";
import type { AppEnv } from "../env";

/** Month precision, from the one place the rule lives. */
export const monthDate = z
  .string()
  .regex(MONTH_DATE_PATTERN, "Use a month, as YYYY-MM-01.");

const required = (label: string) => z.string().trim().min(1, `${label} is required.`);

const profileBody = z.object({
  familyNameKanji: required("Family name"),
  givenNameKanji: required("Given name"),
  familyNameKana: required("Family name (kana)"),
  givenNameKana: required("Given name (kana)"),
  nameLatin: required("Name in Latin script"),
  dateOfBirth: monthDate,
  gender: z.string().trim().nullish(),
  phone: required("Phone"),
  email: z.string().trim().email("That is not an email address."),
  postalCode: required("Postal code"),
  address: required("Address"),
  addressKana: required("Address (kana)"),
  contactSameAsAddress: z.boolean().default(true),
  contactPostalCode: z.string().trim().nullish(),
  contactAddress: z.string().trim().nullish(),
  contactAddressKana: z.string().trim().nullish(),
  desiredRoleNote: z.string().trim().nullish(),
});

export function registerProfileRoutes(app: Hono<AppEnv>) {
  const api = routes(app);

  api.get("/api/profile", async (c) => {
    const user = c.get("user");
    const [profile] = await c
      .get("db")
      .select()
      .from(profiles)
      .where(eq(profiles.userId, user.id))
      .limit(1);
    if (!profile) throw notFound("A profile");
    return c.json(toResponse(profile));
  });

  api.put("/api/profile", async (c) => {
    const user = c.get("user");
    // Nothing is saved when a required field is missing — the response names
    // the offenders and the form marks them inline.
    const body = await parseBody(c, profileBody);
    const db = c.get("db");

    const values = {
      ...body,
      gender: body.gender ?? null,
      contactPostalCode: body.contactPostalCode ?? null,
      contactAddress: body.contactAddress ?? null,
      contactAddressKana: body.contactAddressKana ?? null,
      desiredRoleNote: body.desiredRoleNote ?? null,
      userId: user.id,
      updatedAt: new Date(),
    };

    const [saved] = await db
      .insert(profiles)
      .values({ id: newId("profile"), ...values })
      .onConflictDoUpdate({ target: profiles.userId, set: values })
      .returning();

    return c.json(toResponse(saved!));
  });
}

/**
 * `photo` is NEVER inlined. The response reports `hasPhoto`; the image is
 * fetched separately, because base64 in a JSON body would put the author's face
 * in every cache and log of that response.
 */
function toResponse(profile: typeof profiles.$inferSelect) {
  const { photo, userId, createdAt, updatedAt, ...rest } = profile;
  void userId;
  void createdAt;
  void updatedAt;
  return { ...rest, hasPhoto: photo !== null };
}
