/**
 * Track Record — database schema.
 *
 * This file and `docs/04-database-schema.md` are kept literally in sync.
 * If they disagree, that is a bug in one of them, not a matter of interpretation.
 *
 * Conventions (docs/04 §0):
 *   - snake_case columns, plural table names
 *   - text primary keys generated with nanoid(), matching Better Auth
 *   - created_at / updated_at on every table
 *   - user_id on every record-bearing table; EVERY query filters by it
 *   - MONTH PRECISION on all calendar columns: `date` with the day pinned to
 *     `01`, never rendered. Forms collect month and year only.
 */
import {
  pgTable, pgEnum, text, integer, bigint, boolean, timestamp, date, jsonb,
  index, uniqueIndex, customType, primaryKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * `bytea` is documented in Drizzle's v1 beta docs but is NOT exported by
 * drizzle-orm 0.45.2. Defined here until it lands in stable.
 */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

/* ------------------------------------------------------------------ enums */

export const provenance = pgEnum("provenance", ["measured", "attested", "generated"]);
export const disclosure = pgEnum("disclosure", ["public", "restricted", "private"]);
export const factStatus = pgEnum("fact_status", ["candidate", "accepted", "rejected"]);
export const employmentType = pgEnum("employment_type", [
  "full_time", "contract", "dispatch", "part_time", "independent",
]);
export const educationOutcome = pgEnum("education_outcome", [
  "graduated", "completed", "withdrawn", "expected",
]);
export const renderKind = pgEnum("render_kind", [
  "english_resume", "rirekisho", "shokumu_keirekisho", "career_story_en", "career_story_ja",
]);
export const proposalStatus = pgEnum("proposal_status", ["pending", "accepted", "dismissed"]);
export const importStatus = pgEnum("import_status", ["queued", "extracting", "ready", "failed"]);

/* --------------------------------------------------- auth (Better Auth) */

/**
 * Better Auth owns these tables and their migrations. Its DEFAULTS are singular
 * table names with camelCase columns (`user`, `session`, `userId`, `expiresAt`);
 * the names below therefore MUST be mirrored by `modelName`/`fields` overrides in
 * the Better Auth config, or the auth tables become the only ones in the database
 * following different conventions. See docs/04 §3.1.
 *
 * Regenerate with `npm run auth:generate` and reconcile — do not hand-edit drift.
 *
 * `users.id` IS the person. There is no separate `person` table.
 */
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  ...timestamps,
});

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  ...timestamps,
}, (t) => [index("sessions_user_idx").on(t.userId)]);

export const accounts = pgTable("accounts", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  idToken: text("id_token"),
  password: text("password"),
  ...timestamps,
}, (t) => [index("accounts_user_idx").on(t.userId)]);

export const verifications = pgTable("verifications", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ...timestamps,
});

/* ----------------------------------------------------------- the record */

/** 履歴書 identity fields. PII here is readable ONLY by the 履歴書 render spec. */
export const profiles = pgTable("profiles", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
  familyNameKanji: text("family_name_kanji").notNull(),
  givenNameKanji: text("given_name_kanji").notNull(),
  familyNameKana: text("family_name_kana").notNull(),
  givenNameKana: text("given_name_kana").notNull(),
  nameLatin: text("name_latin").notNull(),
  /** 生年月日. Age (満N歳) is COMPUTED at generation against the submission date. */
  dateOfBirth: date("date_of_birth", { mode: "string" }).notNull(),
  /** 性別 — nullable; optional under the 2024 JIS revision. */
  gender: text("gender"),
  phone: text("phone").notNull(),
  email: text("email").notNull(),
  postalCode: text("postal_code").notNull(),
  address: text("address").notNull(),
  addressKana: text("address_kana").notNull(),
  contactSameAsAddress: boolean("contact_same_as_address").notNull().default(true),
  contactPostalCode: text("contact_postal_code"),
  contactAddress: text("contact_address"),
  contactAddressKana: text("contact_address_kana"),
  photo: bytea("photo"),
  desiredRoleNote: text("desired_role_note"),
  ...timestamps,
});

export const employers = pgTable("employers", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  nameJa: text("name_ja").notNull(),
  nameLatin: text("name_latin"),
  businessDescription: text("business_description"),
  /** e.g. 小売業 — appears on the 履歴書 職歴 line. */
  industryJa: text("industry_ja"),
  /** 資本金, in YEN — not 万円. Formatted at render time. */
  capitalYen: bigint("capital_yen", { mode: "number" }),
  /** 従業員数 */
  headcount: integer("headcount"),
  employmentType: employmentType("employment_type").notNull(),
  startedOn: date("started_on", { mode: "string" }).notNull(),
  /** null = current employer */
  endedOn: date("ended_on", { mode: "string" }),
  /** 退職理由, e.g. 一身上の都合により */
  leavingReasonJa: text("leaving_reason_ja"),
  sortOrder: integer("sort_order").notNull().default(0),
  ...timestamps,
}, (t) => [index("employers_user_started_idx").on(t.userId, t.startedOn.desc())]);

export const roles = pgTable("roles", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  employerId: text("employer_id").notNull().references(() => employers.id, { onDelete: "restrict" }),
  titleJa: text("title_ja"),
  titleLatin: text("title_latin"),
  /** 職種 */
  shokushuJa: text("shokushu_ja"),
  startedOn: date("started_on", { mode: "string" }).notNull(),
  endedOn: date("ended_on", { mode: "string" }),
  ...timestamps,
}, (t) => [index("roles_user_employer_idx").on(t.userId, t.employerId)]);

export const projects = pgTable("projects", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  /** NULL = independent project. Load-bearing: the résumé renders PROJECTS separately. */
  employerId: text("employer_id").references(() => employers.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  nameJa: text("name_ja"),
  summary: text("summary"),
  startedOn: date("started_on", { mode: "string" }),
  endedOn: date("ended_on", { mode: "string" }),
  /** Per-project override of the "client identity is not named" default. */
  clientIsNamed: boolean("client_is_named").notNull().default(false),
  ...timestamps,
}, (t) => [index("projects_user_employer_idx").on(t.userId, t.employerId)]);

/* --------------------------------------------------------------- evidence */

/** Source documents NEVER render, export, or appear in any output (PRD §6.1). */
export const sourceDocuments = pgTable("source_documents", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  projectId: text("project_id").references(() => projects.id, { onDelete: "restrict" }),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  ...timestamps,
}, (t) => [index("source_documents_user_idx").on(t.userId)]);

export const sourceDocumentVersions = pgTable("source_document_versions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  sourceDocumentId: text("source_document_id").notNull()
    .references(() => sourceDocuments.id, { onDelete: "cascade" }),
  versionNo: integer("version_no").notNull(),
  originalBytes: bytea("original_bytes").notNull(),
  /** Line numbers AND fact quote offsets index into this. */
  extractedText: text("extracted_text").notNull(),
  /**
   * Which parser produced `extracted_text`. A version is NEVER re-extracted in
   * place — a parser upgrade creates a new version with fresh offsets, because
   * stale offsets still resolve to *some* text and fail silently.
   */
  extractorVersion: text("extractor_version").notNull(),
  byteSize: integer("byte_size").notNull(),
  wordCount: integer("word_count").notNull(),
  importStatus: importStatus("import_status").notNull().default("queued"),
  /** Populated when failed — PRD §7 requires a stated reason, not an empty success. */
  importError: text("import_error"),
  importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
  ...timestamps,
}, (t) => [
  uniqueIndex("sdv_document_version_uq").on(t.sourceDocumentId, t.versionNo),
  index("sdv_user_idx").on(t.userId),
]);

/* ------------------------------------------------------------------ facts */

/**
 * One table holds candidates, accepted and rejected facts. Rejected rows are
 * retained FOREVER — that is what stops a re-import re-proposing them.
 */
export const facts = pgTable("facts", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  projectId: text("project_id").references(() => projects.id, { onDelete: "restrict" }),
  employerId: text("employer_id").references(() => employers.id, { onDelete: "restrict" }),
  /** Stored PLAINLY. Impact framing is applied at render time, never here. */
  claim: text("claim").notNull(),
  /** Anything a model produces starts Generated. */
  provenance: provenance("provenance").notNull().default("generated"),
  /** Defaults point toward secrecy. */
  disclosure: disclosure("disclosure").notNull().default("private"),
  status: factStatus("status").notNull().default("candidate"),
  sourceDocumentVersionId: text("source_document_version_id")
    .references(() => sourceDocumentVersions.id, { onDelete: "restrict" }),
  /** The VERBATIM supporting span. Verified by exact string match before insert. */
  quote: text("quote"),
  quoteStart: integer("quote_start"),
  quoteEnd: integer("quote_end"),
  lineNumber: integer("line_number"),
  /** sha256(normalise(quote) + '\0' + normalise(claim)) — re-import dedupe. */
  dedupeHash: text("dedupe_hash"),
  technologies: text("technologies").array().notNull().default(sql`'{}'`),
  isClientIdentifying: boolean("is_client_identifying").notNull().default(false),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  ...timestamps,
}, (t) => [
  index("facts_user_status_idx").on(t.userId, t.status),
  index("facts_sdv_status_idx").on(t.sourceDocumentVersionId, t.status),
  uniqueIndex("facts_user_dedupe_uq").on(t.userId, t.dedupeHash)
    .where(sql`${t.dedupeHash} is not null`),
  index("facts_tech_gin_idx").using("gin", t.technologies),
  index("facts_employer_status_idx").on(t.employerId, t.status),
]);

/* ------------------------------------------------ education & credentials */

/** 履歴書 学歴 rows derive from this — TWO rows per record, 入学 and 卒業/修了/中退. */
export const educations = pgTable("educations", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  institution: text("institution").notNull(),
  institutionJa: text("institution_ja"),
  /** 学部・学科 — appears on the 履歴書 closing line. */
  faculty: text("faculty"),
  degree: text("degree"),
  fieldOfStudy: text("field_of_study"),
  startedOn: date("started_on", { mode: "string" }).notNull(),
  /** null only when outcome = 'expected'. */
  endedOn: date("ended_on", { mode: "string" }),
  /**
   * NOT decoration. 履歴書 convention requires a withdrawal to read 中退, not 卒業.
   * Rendering it wrong is a misrepresentation, not a formatting slip.
   */
  outcome: educationOutcome("outcome").notNull(),
  ...timestamps,
}, (t) => [index("educations_user_started_idx").on(t.userId, t.startedOn)]);

export const certifications = pgTable("certifications", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  nameJa: text("name_ja"),
  issuingOrganization: text("issuing_organization").notNull(),
  issuedOn: date("issued_on", { mode: "string" }),
  expiresOn: date("expires_on", { mode: "string" }),
  /** Not rendered in v1 — for the author's own reference at renewal. */
  credentialId: text("credential_id"),
  credentialUrl: text("credential_url"),
  /** Feeds the SAME skill-candidate pool as facts.technologies. */
  technologies: text("technologies").array().notNull().default(sql`'{}'`),
  ...timestamps,
}, (t) => [
  index("certifications_user_issued_idx").on(t.userId, t.issuedOn),
  index("certifications_expiry_idx").on(t.userId, t.expiresOn)
    .where(sql`${t.expiresOn} is not null`),
]);

/* ---------------------------------------------------------------- renders */

export const renders = pgTable("renders", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: renderKind("kind").notNull(),
  /** null = NEVER GENERATED, which is distinct from generated-and-unchanged. */
  currentVersionId: text("current_version_id"),
  staleSinceFactCount: integer("stale_since_fact_count"),
  ...timestamps,
}, (t) => [uniqueIndex("renders_user_kind_uq").on(t.userId, t.kind)]);

/** Accepted versions. NEVER deleted. */
export const renderVersions = pgTable("render_versions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  renderId: text("render_id").notNull().references(() => renders.id, { onDelete: "cascade" }),
  versionNo: integer("version_no").notNull(),
  /** RenderContent — sections → blocks → factIds. jsonb, because the diff reads structure. */
  content: jsonb("content").notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().defaultNow(),
  /** Restoring creates a NEW version rather than erasing history (S14). */
  restoredFromVersionId: text("restored_from_version_id"),
  ...timestamps,
}, (t) => [
  uniqueIndex("render_versions_render_no_uq").on(t.renderId, t.versionNo),
  index("render_versions_user_idx").on(t.userId),
]);

/** Pending and dismissed proposals. Retained, but NOT versions. */
export const renderProposals = pgTable("render_proposals", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  renderId: text("render_id").notNull().references(() => renders.id, { onDelete: "cascade" }),
  content: jsonb("content").notNull(),
  status: proposalStatus("status").notNull().default("pending"),
  basedOnVersionId: text("based_on_version_id"),
  reason: text("reason"),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  ...timestamps,
}, (t) => [index("render_proposals_render_status_idx").on(t.renderId, t.status)]);

/* ------------------------------------------------------------- M2 tables */

export const skillCurations = pgTable("skill_curations", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  skillName: text("skill_name").notNull(),
  groupName: text("group_name"),
  sortOrder: integer("sort_order").notNull().default(0),
  /** A curated skill in no fact is FLAGGED, never removed (S9). */
  isStale: boolean("is_stale").notNull().default(false),
  ...timestamps,
}, (t) => [uniqueIndex("skill_curations_user_skill_uq").on(t.userId, t.skillName)]);

export const renderInclusions = pgTable("render_inclusions", {
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  kind: renderKind("kind").notNull(),
  /** Absence of a row means INCLUDED. 履歴書 defaults to everything (S13). */
  included: boolean("included").notNull().default(true),
  ...timestamps,
}, (t) => [primaryKey({ columns: [t.userId, t.entityType, t.entityId, t.kind] })]);
