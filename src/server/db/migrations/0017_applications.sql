CREATE TYPE "public"."application_status" AS ENUM('not_applied', 'applied', 'resume_passed', 'interview_1', 'interview_2', 'interview_final', 'offer', 'rejected', 'withdrawn');--> statement-breakpoint
CREATE TABLE "application_steps" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"application_id" text NOT NULL,
	"status" "application_status" NOT NULL,
	"happened_on" date NOT NULL,
	"superseded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "applications" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"company" text NOT NULL,
	"position" text NOT NULL,
	"posting_url" text,
	"job_description" text NOT NULL,
	"requirements" text[] DEFAULT '{}' NOT NULL,
	"current_step" "application_status" DEFAULT 'not_applied' NOT NULL,
	"closed_as" "application_status",
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "applications_current_step_ck" CHECK ("applications"."current_step" not in ('rejected', 'withdrawn')),
	CONSTRAINT "applications_closed_as_ck" CHECK ("applications"."closed_as" in ('rejected', 'withdrawn'))
);
--> statement-breakpoint
ALTER TABLE "renders" ADD COLUMN "application_id" text;--> statement-breakpoint
ALTER TABLE "application_steps" ADD CONSTRAINT "application_steps_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_steps" ADD CONSTRAINT "application_steps_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "application_steps_live_uq" ON "application_steps" USING btree ("application_id","status") WHERE "application_steps"."superseded_at" is null;--> statement-breakpoint
CREATE INDEX "application_steps_user_idx" ON "application_steps" USING btree ("user_id") WHERE "application_steps"."superseded_at" is null;--> statement-breakpoint
CREATE INDEX "applications_user_idx" ON "applications" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "renders" ADD CONSTRAINT "renders_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "renders_application_idx" ON "renders" USING btree ("application_id") WHERE "renders"."application_id" is not null;--> statement-breakpoint
-- Applications replace the Tailored résumés screen (issue #70). Each tailored
-- résumé is carried over as an application at Not applied, holding the job
-- description the résumé was written toward. Its name becomes the company, the
-- only name the author gave it; the position is left empty for the author to
-- fill in. The day it was made is the day the job was added, in Japan time,
-- and the moment it was made is its last activity.
--
-- ADDITIVE: no row of "renders" loses anything. The résumé keeps its name, its
-- job description, its versions and its proposals, and gains a pointer to its
-- application. "down/0017_applications.sql" reverses the whole migration.
--
-- The id is the résumé's own with the prefix changed, so the three statements
-- agree on it without a lookup, and a résumé already carried over is skipped.
INSERT INTO "applications" ("id", "user_id", "company", "position", "job_description", "last_activity_at", "created_at")
SELECT 'app_' || regexp_replace(r."id", '^rnd_', ''), r."user_id", coalesce(r."label", ''), '', r."job_description", r."created_at", r."created_at"
FROM "renders" AS r
WHERE r."job_description" IS NOT NULL AND r."application_id" IS NULL;--> statement-breakpoint
INSERT INTO "application_steps" ("id", "user_id", "application_id", "status", "happened_on")
SELECT 'aps_' || regexp_replace(r."id", '^rnd_', ''), r."user_id", 'app_' || regexp_replace(r."id", '^rnd_', ''), 'not_applied', (r."created_at" AT TIME ZONE 'Asia/Tokyo')::date
FROM "renders" AS r
WHERE r."job_description" IS NOT NULL AND r."application_id" IS NULL;--> statement-breakpoint
UPDATE "renders" SET "application_id" = 'app_' || regexp_replace("id", '^rnd_', '')
WHERE "job_description" IS NOT NULL AND "application_id" IS NULL;
