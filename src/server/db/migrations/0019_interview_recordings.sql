CREATE TYPE "public"."recording_kind" AS ENUM('link');--> statement-breakpoint
CREATE TABLE "interview_recordings" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"interview_id" text NOT NULL,
	"kind" "recording_kind" NOT NULL,
	"url" text,
	"label" text DEFAULT '' NOT NULL,
	"removed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "interview_recordings_link_ck" CHECK ("interview_recordings"."kind" <> 'link' or ("interview_recordings"."url" is null) = ("interview_recordings"."removed_at" is not null)),
	CONSTRAINT "interview_recordings_removed_ck" CHECK ("interview_recordings"."removed_at" is null or "interview_recordings"."label" = '')
);
--> statement-breakpoint
ALTER TABLE "interview_recordings" ADD CONSTRAINT "interview_recordings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_recordings" ADD CONSTRAINT "interview_recordings_interview_id_interviews_id_fk" FOREIGN KEY ("interview_id") REFERENCES "public"."interviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "interview_recordings_interview_idx" ON "interview_recordings" USING btree ("user_id","interview_id");