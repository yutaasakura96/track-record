-- A tailored 履歴書 per application (`docs/06`, 2026-10-26). An application may
-- now hold one tailored document of each kind, and gains the author's two
-- optional notes for it. No existing row is read or changed: every application
-- that held a tailored résumé held one, which the wider index still allows.
DROP INDEX "renders_application_uq";--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "motivation_note" text;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "kibou_note" text;--> statement-breakpoint
CREATE UNIQUE INDEX "renders_application_uq" ON "renders" USING btree ("application_id","kind") WHERE "renders"."application_id" is not null;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_motivation_note_ck" CHECK (char_length("applications"."motivation_note") <= 400);--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_kibou_note_ck" CHECK (char_length("applications"."kibou_note") <= 400);