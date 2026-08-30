CREATE TYPE "public"."disclosure" AS ENUM('public', 'restricted', 'private');--> statement-breakpoint
CREATE TYPE "public"."education_outcome" AS ENUM('graduated', 'completed', 'withdrawn', 'expected');--> statement-breakpoint
CREATE TYPE "public"."employment_type" AS ENUM('full_time', 'contract', 'dispatch', 'part_time', 'independent');--> statement-breakpoint
CREATE TYPE "public"."fact_status" AS ENUM('candidate', 'accepted', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."import_status" AS ENUM('queued', 'extracting', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."proposal_status" AS ENUM('pending', 'accepted', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."provenance" AS ENUM('measured', 'attested', 'generated');--> statement-breakpoint
CREATE TYPE "public"."render_kind" AS ENUM('english_resume', 'rirekisho', 'shokumu_keirekisho', 'career_story_en', 'career_story_ja');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"id_token" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "certifications" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"name_ja" text,
	"issuing_organization" text NOT NULL,
	"issued_on" date,
	"expires_on" date,
	"credential_id" text,
	"credential_url" text,
	"technologies" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "educations" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"institution" text NOT NULL,
	"institution_ja" text,
	"faculty" text,
	"degree" text,
	"field_of_study" text,
	"started_on" date NOT NULL,
	"ended_on" date,
	"outcome" "education_outcome" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employers" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name_ja" text NOT NULL,
	"name_latin" text,
	"business_description" text,
	"industry_ja" text,
	"capital_yen" bigint,
	"headcount" integer,
	"employment_type" "employment_type" NOT NULL,
	"started_on" date NOT NULL,
	"ended_on" date,
	"leaving_reason_ja" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "facts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"project_id" text,
	"employer_id" text,
	"claim" text NOT NULL,
	"provenance" "provenance" DEFAULT 'generated' NOT NULL,
	"disclosure" "disclosure" DEFAULT 'private' NOT NULL,
	"status" "fact_status" DEFAULT 'candidate' NOT NULL,
	"source_document_version_id" text,
	"quote" text,
	"quote_start" integer,
	"quote_end" integer,
	"line_number" integer,
	"dedupe_hash" text,
	"technologies" text[] DEFAULT '{}' NOT NULL,
	"is_client_identifying" boolean DEFAULT false NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"family_name_kanji" text NOT NULL,
	"given_name_kanji" text NOT NULL,
	"family_name_kana" text NOT NULL,
	"given_name_kana" text NOT NULL,
	"name_latin" text NOT NULL,
	"date_of_birth" date NOT NULL,
	"gender" text,
	"phone" text NOT NULL,
	"email" text NOT NULL,
	"postal_code" text NOT NULL,
	"address" text NOT NULL,
	"address_kana" text NOT NULL,
	"contact_same_as_address" boolean DEFAULT true NOT NULL,
	"contact_postal_code" text,
	"contact_address" text,
	"contact_address_kana" text,
	"photo" "bytea",
	"desired_role_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"employer_id" text,
	"name" text NOT NULL,
	"name_ja" text,
	"summary" text,
	"started_on" date,
	"ended_on" date,
	"client_is_named" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "render_inclusions" (
	"user_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"kind" "render_kind" NOT NULL,
	"included" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "render_inclusions_user_id_entity_type_entity_id_kind_pk" PRIMARY KEY("user_id","entity_type","entity_id","kind")
);
--> statement-breakpoint
CREATE TABLE "render_proposals" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"render_id" text NOT NULL,
	"content" jsonb NOT NULL,
	"status" "proposal_status" DEFAULT 'pending' NOT NULL,
	"based_on_version_id" text,
	"reason" text,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "render_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"render_id" text NOT NULL,
	"version_no" integer NOT NULL,
	"content" jsonb NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"restored_from_version_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "renders" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" "render_kind" NOT NULL,
	"current_version_id" text,
	"stale_since_fact_count" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"employer_id" text NOT NULL,
	"title_ja" text,
	"title_latin" text,
	"shokushu_ja" text,
	"started_on" date NOT NULL,
	"ended_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "skill_curations" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"skill_name" text NOT NULL,
	"group_name" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_stale" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_document_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"source_document_id" text NOT NULL,
	"version_no" integer NOT NULL,
	"original_bytes" "bytea" NOT NULL,
	"extracted_text" text NOT NULL,
	"extractor_version" text NOT NULL,
	"byte_size" integer NOT NULL,
	"word_count" integer NOT NULL,
	"import_status" "import_status" DEFAULT 'queued' NOT NULL,
	"import_error" text,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"project_id" text,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certifications" ADD CONSTRAINT "certifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "educations" ADD CONSTRAINT "educations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employers" ADD CONSTRAINT "employers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facts" ADD CONSTRAINT "facts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facts" ADD CONSTRAINT "facts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facts" ADD CONSTRAINT "facts_employer_id_employers_id_fk" FOREIGN KEY ("employer_id") REFERENCES "public"."employers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facts" ADD CONSTRAINT "facts_source_document_version_id_source_document_versions_id_fk" FOREIGN KEY ("source_document_version_id") REFERENCES "public"."source_document_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_employer_id_employers_id_fk" FOREIGN KEY ("employer_id") REFERENCES "public"."employers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "render_inclusions" ADD CONSTRAINT "render_inclusions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "render_proposals" ADD CONSTRAINT "render_proposals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "render_proposals" ADD CONSTRAINT "render_proposals_render_id_renders_id_fk" FOREIGN KEY ("render_id") REFERENCES "public"."renders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "render_versions" ADD CONSTRAINT "render_versions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "render_versions" ADD CONSTRAINT "render_versions_render_id_renders_id_fk" FOREIGN KEY ("render_id") REFERENCES "public"."renders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "renders" ADD CONSTRAINT "renders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_employer_id_employers_id_fk" FOREIGN KEY ("employer_id") REFERENCES "public"."employers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_curations" ADD CONSTRAINT "skill_curations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_document_versions" ADD CONSTRAINT "source_document_versions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_document_versions" ADD CONSTRAINT "source_document_versions_source_document_id_source_documents_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."source_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_documents" ADD CONSTRAINT "source_documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_documents" ADD CONSTRAINT "source_documents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_user_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "certifications_user_issued_idx" ON "certifications" USING btree ("user_id","issued_on");--> statement-breakpoint
CREATE INDEX "certifications_expiry_idx" ON "certifications" USING btree ("user_id","expires_on") WHERE "certifications"."expires_on" is not null;--> statement-breakpoint
CREATE INDEX "educations_user_started_idx" ON "educations" USING btree ("user_id","started_on");--> statement-breakpoint
CREATE INDEX "employers_user_started_idx" ON "employers" USING btree ("user_id","started_on" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "facts_user_status_idx" ON "facts" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "facts_sdv_status_idx" ON "facts" USING btree ("source_document_version_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "facts_user_dedupe_uq" ON "facts" USING btree ("user_id","dedupe_hash") WHERE "facts"."dedupe_hash" is not null;--> statement-breakpoint
CREATE INDEX "facts_tech_gin_idx" ON "facts" USING gin ("technologies");--> statement-breakpoint
CREATE INDEX "facts_employer_status_idx" ON "facts" USING btree ("employer_id","status");--> statement-breakpoint
CREATE INDEX "projects_user_employer_idx" ON "projects" USING btree ("user_id","employer_id");--> statement-breakpoint
CREATE INDEX "render_proposals_render_status_idx" ON "render_proposals" USING btree ("render_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "render_versions_render_no_uq" ON "render_versions" USING btree ("render_id","version_no");--> statement-breakpoint
CREATE INDEX "render_versions_user_idx" ON "render_versions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "renders_user_kind_uq" ON "renders" USING btree ("user_id","kind");--> statement-breakpoint
CREATE INDEX "roles_user_employer_idx" ON "roles" USING btree ("user_id","employer_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_curations_user_skill_uq" ON "skill_curations" USING btree ("user_id","skill_name");--> statement-breakpoint
CREATE UNIQUE INDEX "sdv_document_version_uq" ON "source_document_versions" USING btree ("source_document_id","version_no");--> statement-breakpoint
CREATE INDEX "sdv_user_idx" ON "source_document_versions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "source_documents_user_idx" ON "source_documents" USING btree ("user_id");