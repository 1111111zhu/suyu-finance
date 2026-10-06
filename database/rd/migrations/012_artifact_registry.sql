-- Immutable content-addressed file mappings; old bytea records remain readable.
CREATE TABLE rd.artifact_registry (
 kind text NOT NULL CHECK(kind IN ('project_document','result_file','source_document')),
 object_id text NOT NULL CHECK(length(object_id) BETWEEN 1 AND 120),
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 byte_size bigint NOT NULL CHECK(byte_size BETWEEN 1 AND 31457280),
 relative_path text NOT NULL CHECK(relative_path = sha256 || '.bin'),
 created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(kind,object_id)
);
CREATE FUNCTION rd.reject_artifact_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'artifact registry is immutable'; END;
$$;
CREATE TRIGGER artifact_registry_immutable BEFORE UPDATE OR DELETE ON rd.artifact_registry
FOR EACH ROW EXECUTE FUNCTION rd.reject_artifact_change();
