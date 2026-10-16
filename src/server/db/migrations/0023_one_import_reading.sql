DO $$
DECLARE reading_count integer;
BEGIN
  LOCK TABLE "source_document_versions" IN SHARE MODE;
  SELECT count(*) INTO reading_count FROM "source_document_versions" WHERE "import_status" = 'extracting';
  IF reading_count > 0 THEN
    RAISE EXCEPTION 'Migration 0023 refused: % % extracting; wait for completion and retry the release.', reading_count, CASE WHEN reading_count = 1 THEN 'import is' ELSE 'imports are' END;
  END IF;
  EXECUTE 'CREATE UNIQUE INDEX "sdv_one_extracting_uq" ON "source_document_versions" USING btree ("user_id") WHERE "import_status" = ''extracting''';
END $$;
