CREATE TABLE "application_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"application_id" text NOT NULL,
	"render_id" text NOT NULL,
	"removed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "application_sent_copies" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"application_id" text NOT NULL,
	"render_id" text NOT NULL,
	"render_version_id" text NOT NULL,
	"kind" "render_kind" NOT NULL,
	"title" text NOT NULL,
	"version_no" integer NOT NULL,
	"filename" text NOT NULL,
	"file" "bytea" NOT NULL,
	"page" jsonb NOT NULL,
	"sent_on" date NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"frozen_step_id" text,
	"undone_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "renders_application_idx";--> statement-breakpoint
ALTER TABLE "application_documents" ADD CONSTRAINT "application_documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_documents" ADD CONSTRAINT "application_documents_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_documents" ADD CONSTRAINT "application_documents_render_id_renders_id_fk" FOREIGN KEY ("render_id") REFERENCES "public"."renders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_sent_copies" ADD CONSTRAINT "application_sent_copies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_sent_copies" ADD CONSTRAINT "application_sent_copies_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_sent_copies" ADD CONSTRAINT "application_sent_copies_render_id_renders_id_fk" FOREIGN KEY ("render_id") REFERENCES "public"."renders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_sent_copies" ADD CONSTRAINT "application_sent_copies_render_version_id_render_versions_id_fk" FOREIGN KEY ("render_version_id") REFERENCES "public"."render_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_sent_copies" ADD CONSTRAINT "application_sent_copies_frozen_step_id_application_steps_id_fk" FOREIGN KEY ("frozen_step_id") REFERENCES "public"."application_steps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "application_documents_live_uq" ON "application_documents" USING btree ("application_id","render_id") WHERE "application_documents"."removed_at" is null;--> statement-breakpoint
CREATE INDEX "application_documents_user_idx" ON "application_documents" USING btree ("user_id") WHERE "application_documents"."removed_at" is null;--> statement-breakpoint
CREATE INDEX "application_sent_copies_application_idx" ON "application_sent_copies" USING btree ("application_id") WHERE "application_sent_copies"."undone_at" is null;--> statement-breakpoint
CREATE INDEX "application_sent_copies_user_idx" ON "application_sent_copies" USING btree ("user_id") WHERE "application_sent_copies"."undone_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "renders_application_uq" ON "renders" USING btree ("application_id") WHERE "renders"."application_id" is not null;--> statement-breakpoint
-- A tailored résumé is on its application from the start (issue #71). Each one
-- that 0017 carried over is listed as a document of the application it points
-- at. The id is the résumé's own with the prefix changed, as 0017 made its
-- application's, and a résumé already listed is skipped.
--
-- ADDITIVE: nothing in "renders" or "applications" is changed.
-- "down/0020_application_documents.sql" reverses the whole migration.
INSERT INTO "application_documents" ("id", "user_id", "application_id", "render_id", "created_at")
SELECT 'apd_' || regexp_replace(r."id", '^rnd_', ''), r."user_id", r."application_id", r."id", r."created_at"
FROM "renders" AS r
WHERE r."application_id" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "application_documents" AS d WHERE d."render_id" = r."id" AND d."application_id" = r."application_id");
