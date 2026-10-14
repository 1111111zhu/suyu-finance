ALTER TABLE rd.result_files DROP CONSTRAINT IF EXISTS result_files_content_check;
ALTER TABLE rd.result_files ADD CONSTRAINT result_files_content_check CHECK(octet_length(content) BETWEEN 4 AND 52428800);
