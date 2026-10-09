CREATE TYPE "public"."fact_flag_kind" AS ENUM('confidential', 'number', 'unsure', 'repeat');--> statement-breakpoint
CREATE TABLE "fact_flags" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"fact_id" text NOT NULL,
	"kind" "fact_flag_kind" NOT NULL,
	"reason" text NOT NULL,
	"explanation" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"cache_creation_input_tokens" integer,
	"cache_read_input_tokens" integer,
	"checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "renders_user_kind_uq";--> statement-breakpoint
ALTER TABLE "facts" ADD COLUMN "auto_accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "renders" ADD COLUMN "job_description" text;--> statement-breakpoint
ALTER TABLE "renders" ADD COLUMN "label" text;--> statement-breakpoint
ALTER TABLE "fact_flags" ADD CONSTRAINT "fact_flags_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_flags" ADD CONSTRAINT "fact_flags_fact_id_facts_id_fk" FOREIGN KEY ("fact_id") REFERENCES "public"."facts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fact_flags_fact_kind_uq" ON "fact_flags" USING btree ("fact_id","kind");--> statement-breakpoint
CREATE INDEX "fact_flags_user_checked_idx" ON "fact_flags" USING btree ("user_id","checked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "renders_user_kind_uq" ON "renders" USING btree ("user_id","kind") WHERE "renders"."job_description" is null;