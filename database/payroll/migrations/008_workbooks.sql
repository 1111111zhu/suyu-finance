-- Reusable account-owned Excel masters, separate from monthly payroll history.
CREATE TABLE payroll.workbook_originals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES payroll.users(id),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  filename text NOT NULL,
  bytes bytea NOT NULL CHECK (octet_length(bytes) BETWEEN 1 AND 20971520),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(owner_id,sha256)
);
CREATE TABLE payroll.workbook_masters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES payroll.users(id),
  workbook_key text NOT NULL CHECK (workbook_key IN ('roster','salary')),
  revision integer NOT NULL CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(owner_id,workbook_key)
);
CREATE TABLE payroll.workbook_versions (
  master_id uuid NOT NULL REFERENCES payroll.workbook_masters(id),
  revision integer NOT NULL CHECK (revision > 0),
  request_key uuid NOT NULL,
  request_sha256 text NOT NULL CHECK(request_sha256 ~ '^[0-9a-f]{64}$'),
  filename text NOT NULL CHECK(length(filename) BETWEEN 1 AND 200),
  snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
  rows jsonb NOT NULL CHECK(jsonb_typeof(rows)='array'),
  warnings jsonb NOT NULL CHECK(jsonb_typeof(warnings)='array'),
  original_id uuid REFERENCES payroll.workbook_originals(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(master_id,revision), UNIQUE(master_id,request_key)
);
ALTER TABLE payroll.workbook_masters ADD CONSTRAINT workbook_current_version
  FOREIGN KEY(id,revision) REFERENCES payroll.workbook_versions(master_id,revision)
  DEFERRABLE INITIALLY DEFERRED;
CREATE TRIGGER immutable_workbook_version BEFORE UPDATE OR DELETE ON payroll.workbook_versions
  FOR EACH ROW EXECUTE FUNCTION payroll.reject_mutation();
CREATE TRIGGER immutable_workbook_original BEFORE UPDATE OR DELETE ON payroll.workbook_originals
  FOR EACH ROW EXECUTE FUNCTION payroll.reject_mutation();
CREATE TRIGGER no_delete_workbook_master BEFORE DELETE ON payroll.workbook_masters
  FOR EACH ROW EXECUTE FUNCTION payroll.reject_mutation();
CREATE FUNCTION payroll.guard_workbook_master() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id,NEW.owner_id,NEW.workbook_key) IS DISTINCT FROM (OLD.id,OLD.owner_id,OLD.workbook_key)
    OR NEW.revision <> OLD.revision+1 THEN
    RAISE EXCEPTION 'Workbook ownership cannot change; append a version' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_workbook_master BEFORE UPDATE ON payroll.workbook_masters
  FOR EACH ROW EXECUTE FUNCTION payroll.guard_workbook_master();
