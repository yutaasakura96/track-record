CREATE TABLE "capture_prompt_dismissals" (
	"user_id" text PRIMARY KEY NOT NULL,
	"dismissed_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "capture_prompt_dismissals" ADD CONSTRAINT "capture_prompt_dismissals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;