insert into employers (id, user_id, name_ja, employment_type, started_on)
values ('emp_nm_a', 'VRRB0s10h5R5THXVaNq6VK7IZN9l3mP1', '青空商事', 'full_time', '2020-01-01');
insert into source_documents (id, user_id, filename, mime_type)
values
  ('doc_nm_narrative', 'VRRB0s10h5R5THXVaNq6VK7IZN9l3mP1', 'narrative.md', 'text/markdown'),
  ('doc_nm_portfolio', 'VRRB0s10h5R5THXVaNq6VK7IZN9l3mP1', 'portfolio.md', 'text/markdown');
insert into source_document_versions
  (id, user_id, source_document_id, version_no, original_bytes, extracted_text, extractor_version, byte_size, word_count, import_status)
values
  ('sdv_nm_narrative', 'VRRB0s10h5R5THXVaNq6VK7IZN9l3mP1', 'doc_nm_narrative', 1, '\x61', 'Cut the nightly settlement batch from six hours to 90 minutes.', 'test', 1, 12, 'ready'),
  ('sdv_nm_portfolio', 'VRRB0s10h5R5THXVaNq6VK7IZN9l3mP1', 'doc_nm_portfolio', 1, '\x62', 'Reduced nightly batch runtime from 6 hours to 90 minutes.\nReduced the nightly settlement batch runtime to 80 minutes.\nAdded a customer sign-in page to the tracking portal.', 'test', 1, 30, 'ready');
insert into facts
  (id, user_id, employer_id, claim, provenance, disclosure, status, source_document_version_id, quote, quote_start, quote_end, line_number)
values
  ('fct_nm_accepted', 'VRRB0s10h5R5THXVaNq6VK7IZN9l3mP1', 'emp_nm_a', 'Cut the nightly settlement batch from six hours to 90 minutes', 'attested', 'public', 'accepted', 'sdv_nm_narrative', 'Cut the nightly settlement batch from six hours to 90 minutes.', 0, 64, 1),
  ('fct_nm_restate', 'VRRB0s10h5R5THXVaNq6VK7IZN9l3mP1', 'emp_nm_a', 'Reduced nightly batch runtime from 6 hours to 90 minutes', 'generated', 'private', 'candidate', 'sdv_nm_portfolio', 'Reduced nightly batch runtime from 6 hours to 90 minutes.', 0, 59, 1),
  ('fct_nm_conflict', 'VRRB0s10h5R5THXVaNq6VK7IZN9l3mP1', 'emp_nm_a', 'Reduced the nightly settlement batch runtime to 80 minutes', 'generated', 'private', 'candidate', 'sdv_nm_portfolio', 'Reduced the nightly settlement batch runtime to 80 minutes.', 60, 120, 2),
  ('fct_nm_unrelated', 'VRRB0s10h5R5THXVaNq6VK7IZN9l3mP1', 'emp_nm_a', 'Added a customer sign-in page to the tracking portal', 'generated', 'private', 'candidate', 'sdv_nm_portfolio', 'Added a customer sign-in page to the tracking portal.', 121, 176, 3);
