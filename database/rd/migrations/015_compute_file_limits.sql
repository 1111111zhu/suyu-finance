ALTER TABLE rd.artifact_registry DROP CONSTRAINT IF EXISTS artifact_registry_byte_size_check;
ALTER TABLE rd.artifact_registry ADD CONSTRAINT artifact_registry_byte_size_check CHECK(byte_size BETWEEN 1 AND 52428800);
