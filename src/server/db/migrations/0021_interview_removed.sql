ALTER TABLE "interviews" ADD COLUMN "removed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "interview_questions" ADD COLUMN "removed_at" timestamp with time zone;--> statement-breakpoint
DROP INDEX "interview_questions_order_uq";--> statement-breakpoint
CREATE UNIQUE INDEX "interview_questions_order_uq" ON "interview_questions" USING btree ("interview_id","position") WHERE "removed_at" is null;
