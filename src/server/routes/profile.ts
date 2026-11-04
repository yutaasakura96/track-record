/**
 * Profile (`docs/07-api-design.md` §4).
 *
 * `GET` returns 404 when no profile exists, and the client redirects to the
 * profile form from that — every render needs a name to put on it, so nothing
 * else in the app is reachable until identity exists.
 *
 * The 履歴書's 写真 (issue #117) has routes of its own under
 * `/api/profile/photo`: it is the raw body of one request, never a form and
 * never base64 in JSON, and it is read back only by its owner. No log line
 * carries it, nor anything about it but its type and size.
 */
import type { Hono } from "hono";
import { eq, getTableColumns, sql } from "drizzle-orm";
import { z } from "zod";
import { profiles } from "../db/schema";
import { storedBytes } from "../db/bytes";
import { notFound, validationFailed } from "../http/errors";
import { routes } from "../http/registry";
import { newId } from "../http/ids";
import { parseBody } from "../services/validate";
import { photoResponse } from "../services/rirekisho";
import { MONTH_DATE_PATTERN } from "~/shared/calendar";
import { PHOTO_MAX_BYTES, PHOTO_TOO_LARGE, photoInfo, photoRefusal } from "~/shared/photo";
import type { AppEnv } from "../env";

/** Month precision, from the one place the rule lives. */
export const monthDate = z
  .string()
  .regex(MONTH_DATE_PATTERN, "Use a month, as YYYY-MM-01.");

/**
 * A date of birth is a real day, not a calendar column (`rirekisho.ts`): the
 * 履歴書 prints 年月日生 and computes age from it. `YYYY-MM-DD`, and a day that
 * exists in that month.
 */
export const dateOfBirthDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date, as YYYY-MM-DD.")
  .refine((value) => {
    const [year, month, day] = value.split("-").map(Number) as [number, number, number];
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return (
      parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day
    );
  }, "That date does not exist.")
  .refine((value) => value >= "1900-01-01" && value <= new Date().toISOString().slice(0, 10), {
    message: "Date of birth is between 1900 and today.",
  });

/**
 * A phone number as people write one: digits with optional `+`, hyphens, spaces
 * and parentheses (090-1234-5678, +81 90 1234 5678, (03) 1234-5678). Full-width
 * characters from a Japanese IME are folded to ASCII first, and what is stored
 * is the folded text. Nine to fifteen digits covers a Japanese number and the
 * E.164 ceiling.
 */
const PHONE_CHARACTERS = /^\+?[\d\s\-()]+$/;
const phoneNumber = (label: string) =>
  z
    .string()
    .trim()
    .max(30, `${label} is too long.`)
    .transform((value) => value.normalize("NFKC").replace(/[\u2010-\u2015\u2212\u30fc]/g, "-"))
    .refine((value) => {
      const digits = value.replace(/\D/g, "").length;
      return PHONE_CHARACTERS.test(value) && digits >= 9 && digits <= 15;
    }, `${label} is a phone number: digits, with optional +, hyphens, spaces and parentheses.`);

/**
 * 郵便番号: seven digits, typed `123-4567` or `1234567` (a leading 〒 and
 * full-width digits are tolerated), and stored as `123-4567` so there is one
 * form on file.
 */
const postalCodeValue = (label: string) =>
  z
    .string()
    .trim()
    .transform((value, ctx) => {
      const folded = value.normalize("NFKC").replace(/^〒\s*/, "").replace(/[\u2010-\u2015\u2212\u30fc]/g, "-");
      const match = /^(\d{3})-?(\d{4})$/.exec(folded);
      if (match) return `${match[1]}-${match[2]}`;
      ctx.addIssue({ code: "custom", message: `${label} is seven digits, as 123-4567.` });
      return z.NEVER;
    });

const required = (label: string) =>
  z.string().trim().min(1, `${label} is required.`).max(200, `${label} is too long.`);

/** Blank is the same as absent for an optional, checked field. */
const blankIsNull = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (typeof value === "string" && value.trim() === "" ? null : value), schema.nullish().transform((value) => value ?? null));

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

/** An optional free-text field: blank is the same as absent, and both store null. */
const optional = z
  .string()
  .trim()
  .nullish()
  .transform((value) => value || null);

/**
 * An optional web address. `linkedin.com/in/…` is how people copy one, so a
 * missing scheme is supplied rather than refused; anything that is still not an
 * http(s) address is refused, because the résumé would print it as a link.
 *
 * What is checked is the string that is saved. The URL parser quietly rewrites
 * a backslash into a slash, so one is refused rather than saved unparsed; and
 * an address carrying credentials is refused, which is also what catches
 * `mailto:person@example.com` once `https://` is put in front of it.
 */
const webAddress = (label: string) =>
  optional.transform((value, ctx) => {
    if (!value) return null;
    const hasWebScheme = /^https?:\/\//i.test(value);
    const withScheme = hasWebScheme ? value : `https://${value}`;
    try {
      if (!/[\s\p{Cc}\\]/u.test(withScheme) && (hasWebScheme || !/^[a-z][a-z0-9+.-]*:\/\//i.test(value))) {
        const url = new URL(withScheme);
        const isWeb = url.protocol === "https:" || url.protocol === "http:";
        // Read off the text, not the parse, which drops an empty `@` unseen.
        const hasCredentials = /^https?:\/\/[^/?#]*@/i.test(withScheme);
        if (isWeb && !hasCredentials && url.hostname.includes(".")) return withScheme;
      }
    } catch {
      // Falls through to the refusal below.
    }
    ctx.addIssue({ code: "custom", message: `${label} is not a web address.` });
    return z.NEVER;
  });

export const profileBody = z.object({
  familyNameKanji: required("Family name"),
  givenNameKanji: required("Given name"),
  familyNameKana: kana("Family name (kana)"),
  givenNameKana: kana("Given name (kana)"),
  nameLatin: required("Name in Latin script"),
  dateOfBirth: dateOfBirthDate,
  gender: z.string().trim().nullish(),
  phone: phoneNumber("Phone"),
  email: z.string().trim().max(254, "That email address is too long.").email("That is not an email address."),
  postalCode: postalCodeValue("Postal code"),
  address: required("Address"),
  addressKana: kana("Address (kana)"),
  contactSameAsAddress: z.boolean().default(true),
  contactPostalCode: blankIsNull(postalCodeValue("Contact postal code")),
  contactAddress: z.string().trim().nullish(),
  contactAddressKana: z.string().trim().nullish().refine((v) => !v || !KATAKANA.test(v), {
    message: "Address (kana) is written in hiragana, not katakana.",
  }),
  desiredRoleNote: z.string().trim().nullish(),
  // The English résumé's header (issue #108). All optional, and none of them
  // the 履歴書 PII above: the résumé phone is its own number, opted into here.
  resumeHeadline: optional,
  resumeCity: optional,
  resumeCountry: optional,
  resumePhone: blankIsNull(phoneNumber("Phone on the résumé")),
  resumeLinkedinUrl: webAddress("LinkedIn"),
  resumeGithubUrl: webAddress("GitHub"),
  resumePortfolioUrl: webAddress("Portfolio"),
  /** Left as it is when not sent; a new profile starts on A4. */
  paperSize: z.enum(["a4", "letter"]).optional(),
});

export function registerProfileRoutes(app: Hono<AppEnv>) {
  const api = routes(app);

  api.get("/api/profile", async (c) => {
    const user = c.get("user");
    const [profile] = await c
      .get("db")
      .select(RESPONSE_COLUMNS)
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

    // The photo is not in `values`, so saving the form keeps it.
    const [saved] = await db
      .insert(profiles)
      .values({ id: newId("profile"), ...values })
      .onConflictDoUpdate({ target: profiles.userId, set: values })
      .returning(RESPONSE_COLUMNS);

    return c.json(toResponse(saved!));
  });

  /** The photo, to show in the page. `404` when there is none. Never cached. */
  api.get("/api/profile/photo", async (c) => {
    const user = c.get("user");
    const [row] = await c
      .get("db")
      .select({ photo: profiles.photo })
      .from(profiles)
      .where(eq(profiles.userId, user.id))
      .limit(1);
    const bytes = row?.photo ? storedBytes(row.photo) : null;
    const info = bytes ? photoInfo(bytes) : null;
    if (!bytes || !info) throw notFound("A photo");
    return photoResponse({ bytes, type: info.type });
  });

  /**
   * Puts the photo on the profile, replacing any before it. The body is the
   * image, already cropped to 3:4 by the browser; its first bytes decide its
   * type, and its header its size. `200` + the profile. A profile has to exist
   * first, since the photo is one of its columns.
   */
  api.put("/api/profile/photo", async (c) => {
    const user = c.get("user");
    const db = c.get("db");
    const [profile] = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.userId, user.id)).limit(1);
    if (!profile) throw notFound("A profile");

    const declared = c.req.header("content-length");
    if (declared && /^\d+$/.test(declared) && Number(declared) > PHOTO_MAX_BYTES) {
      throw validationFailed(PHOTO_TOO_LARGE, ["photo"]);
    }
    const bytes = await readAtMost(c.req.raw.body, PHOTO_MAX_BYTES);
    if (bytes === "too_large") throw validationFailed(PHOTO_TOO_LARGE, ["photo"]);
    const info = photoInfo(bytes);
    const refusal = photoRefusal(info);
    if (refusal) throw validationFailed(refusal, ["photo"]);

    const [saved] = await db
      .update(profiles)
      .set({ photo: Buffer.from(bytes), updatedAt: new Date() })
      .where(eq(profiles.userId, user.id))
      .returning(RESPONSE_COLUMNS);
    // The type, the pixel size and the byte count. Never the image.
    console.log(JSON.stringify({ event: "profile_photo_saved", type: info!.type, width: info!.width, height: info!.height, bytes: bytes.byteLength }));
    return c.json(toResponse(saved!));
  });

  /** Takes the photo off the profile, for good. `200` + the profile; removing none is not an error. */
  api.delete("/api/profile/photo", async (c) => {
    const user = c.get("user");
    const [saved] = await c
      .get("db")
      .update(profiles)
      .set({ photo: null, updatedAt: new Date() })
      .where(eq(profiles.userId, user.id))
      .returning(RESPONSE_COLUMNS);
    if (!saved) throw notFound("A profile");
    console.log(JSON.stringify({ event: "profile_photo_removed" }));
    return c.json(toResponse(saved));
  });
}

/** A request body, or `too_large` as soon as it passes `limit` bytes, whatever its header said. */
async function readAtMost(body: ReadableStream<Uint8Array> | null, limit: number): Promise<Uint8Array | "too_large"> {
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => {});
      return "too_large";
    }
    parts.push(value);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    bytes.set(part, at);
    at += part.byteLength;
  }
  return bytes;
}

/**
 * Every column the response is made from. Not the photo itself, which would be
 * read on every request for no use: its digest stands in, as `photoVersion`,
 * so a page showing the photo asks for a new one when it changes.
 */
const { photo: _photo, ...withoutPhoto } = getTableColumns(profiles);
void _photo;
const RESPONSE_COLUMNS = { ...withoutPhoto, photoDigest: sql<string | null>`md5(${profiles.photo})` };

/**
 * `photo` is NEVER inlined. The response reports `hasPhoto`; the image is
 * fetched separately, because base64 in a JSON body would put the author's face
 * in every cache and log of that response.
 */
function toResponse(profile: Omit<typeof profiles.$inferSelect, "photo"> & { photoDigest: string | null }) {
  const { photoDigest, userId, createdAt, updatedAt, ...rest } = profile;
  void userId;
  void createdAt;
  void updatedAt;
  return { ...rest, hasPhoto: photoDigest !== null, photoVersion: photoDigest?.slice(0, 12) ?? null };
}
