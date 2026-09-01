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

/**
 * Katakana, full-width and half-width. Not a "hiragana only" test on purpose:
 * an address reading legitimately carries digits, spaces and hyphens, and
 * demanding pure hiragana would reject correct input. What is actually wrong is
 * KATAKANA, so that is what is named.
 */
const KATAKANA = /[ァ-ヺｦ-ﾝ]/;

/**
 * ふりがな columns are hiragana (`docs/04-database-schema.md` §139–148) and are
 * printed above the kanji in 履歴書 row 1 (§479). Katakana here is not a
 * formatting preference — it renders a wrong 履歴書, and it used to save
 * silently because neither the form nor this schema said which kana it wanted.
 */
const kana = (label: string) =>
  required(label).refine((value) => !KATAKANA.test(value), {
    message: `${label} is written in hiragana, not katakana.`,
  });

const profileBody = z.object({
  familyNameKanji: required("Family name"),
  givenNameKanji: required("Given name"),
  familyNameKana: kana("Family name (kana)"),
  givenNameKana: kana("Given name (kana)"),
  nameLatin: required("Name in Latin script"),
  dateOfBirth: monthDate,
  gender: z.string().trim().nullish(),
  phone: required("Phone"),
  email: z.string().trim().email("That is not an email address."),
  postalCode: required("Postal code"),
  address: required("Address"),
  addressKana: kana("Address (kana)"),
  contactSameAsAddress: z.boolean().default(true),
  contactPostalCode: z.string().trim().nullish(),
  contactAddress: z.string().trim().nullish(),
  contactAddressKana: z.string().trim().nullish().refine((v) => !v || !KATAKANA.test(v), {
    message: "Address (kana) is written in hiragana, not katakana.",
  }),
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
