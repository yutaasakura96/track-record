-- The author's explanation of a gap in 学歴・職歴, printed as a ※ row under the
-- 退社 line (issue #117, review §5 G2). A new table and nothing else: no existing
-- row is read or changed.
CREATE TABLE "career_gap_notes" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"from_on" date NOT NULL,
	"to_on" date NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "career_gap_notes_months_ck" CHECK ("career_gap_notes"."from_on" <= "career_gap_notes"."to_on")
);
--> statement-breakpoint
ALTER TABLE "career_gap_notes" ADD CONSTRAINT "career_gap_notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "career_gap_notes_user_months_uq" ON "career_gap_notes" USING btree ("user_id","from_on","to_on");