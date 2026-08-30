/**
 * Seed data. Every value here is INVENTED — `CLAUDE.md` forbids sampling from
 * the author's real documents, and a fixture carrying a real client name would
 * be committed to a public repository forever.
 */
import { env } from "cloudflare:test";
import { createDb } from "~/server/db/client";
import { users } from "~/server/db/schema";
import type { Bindings } from "~/server/env";
import type { SeededUser } from "./harness";

const bindings = env as unknown as Bindings;

let counter = 0;

export const AUTHOR_EMAIL = "author@example.invalid";
export const SECOND_EMAIL = "second@example.invalid";

export async function seedUser(email = AUTHOR_EMAIL): Promise<SeededUser> {
  const db = createDb(bindings.DATABASE_URL);
  const id = `usr_test_${++counter}_${Math.trunc(Math.random() * 1e9)}`;
  const unique = `${id}.${email}`;
  const user = { id, email: unique, name: "Test Author" };
  await db.insert(users).values({ ...user, emailVerified: true });
  return user;
}

/**
 * A seeded user's email must be on the allowlist for the session middleware to
 * admit it, and must be unique for the users table. This gives both.
 */
export async function seedAllowedUser(base = AUTHOR_EMAIL): Promise<SeededUser> {
  const db = createDb(bindings.DATABASE_URL);
  const id = `usr_test_${++counter}_${Math.trunc(Math.random() * 1e9)}`;
  await db.insert(users).values({
    id,
    email: `${id}@example.invalid`,
    name: "Test Author",
    emailVerified: true,
  });
  // The session's email is what the allowlist is checked against.
  return { id, email: base, name: "Test Author" };
}

export const PROFILE_FIXTURE = {
  familyNameKanji: "青木",
  givenNameKanji: "陽介",
  familyNameKana: "あおき",
  givenNameKana: "ようすけ",
  nameLatin: "Yosuke Aoki",
  dateOfBirth: "1994-11-01",
  gender: null,
  phone: "080-0000-0000",
  email: "yosuke@example.invalid",
  postalCode: "150-0001",
  address: "東京都渋谷区神宮前0-0-0",
  addressKana: "とうきょうと しぶやく じんぐうまえ",
  contactSameAsAddress: true,
};

export const EMPLOYER_FIXTURE = {
  nameJa: "株式会社アオゾラ物流",
  nameLatin: "Aozora Logistics K.K.",
  industryJa: "運輸業",
  businessDescription: "中堅の国内向け物流事業者。",
  capitalYen: 50_000_000,
  headcount: 320,
  employmentType: "full_time" as const,
  startedOn: "2022-04-01",
  endedOn: "2024-09-01",
  leavingReasonJa: "一身上の都合により",
};

/** An invented case study, in the shape the author's are written in. */
export const CASE_STUDY = `# Aozora nightly batch

The nightly settlement batch had grown to six hours and was regularly
overrunning into the business day.

We replaced the row-by-row settlement loop with a set-based rewrite and moved
scheduling onto Airflow. Nightly batch runtime fell from 6 hours to 90 minutes.

A second pass added partition pruning on the ledger table. Query planning time
dropped noticeably, though we never measured it precisely.

Contact for the vendor escalation path was ops-lead@vendor.example.invalid.
`;

export const uploadForm = (text: string, filename = "aozora-batch.md") => {
  const form = new FormData();
  form.set("file", new File([text], filename, { type: "text/markdown" }));
  return form;
};
