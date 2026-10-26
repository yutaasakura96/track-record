CREATE FUNCTION application_one_rirekisho_guard() RETURNS trigger AS $$
DECLARE
  chosen_step text;
  new_tailored boolean;
BEGIN
  IF NEW.removed_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT current_step INTO chosen_step FROM applications WHERE id = NEW.application_id FOR UPDATE;
  IF chosen_step <> 'not_applied' THEN
    RETURN NEW;
  END IF;

  SELECT job_description IS NOT NULL INTO new_tailored
  FROM renders WHERE id = NEW.render_id AND kind = 'rirekisho';
  IF new_tailored IS NULL THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM application_documents AS d
    JOIN renders AS r ON r.id = d.render_id
    WHERE d.application_id = NEW.application_id
      AND d.removed_at IS NULL
      AND d.id <> NEW.id
      AND r.kind = 'rirekisho'
      AND (r.job_description IS NOT NULL) <> new_tailored
  ) THEN
    RAISE EXCEPTION 'application_one_rirekisho'
      USING ERRCODE = '23505', CONSTRAINT = 'application_one_rirekisho';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER application_one_rirekisho BEFORE INSERT OR UPDATE OF application_id, render_id, removed_at
ON application_documents FOR EACH ROW EXECUTE FUNCTION application_one_rirekisho_guard();
