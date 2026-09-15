-- PostgreSQL 17+. Apply using migrate.mjs; the runner owns the transaction.
CREATE SCHEMA payroll;

CREATE TABLE payroll.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL UNIQUE CHECK (length(btrim(username)) > 0),
  password_hash text NOT NULL CHECK (password_hash LIKE 'scrypt$%'),
  display_name text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE payroll.companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  short_name text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES payroll.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE payroll.employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  created_by uuid NOT NULL REFERENCES payroll.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Neither name nor employee_number is an identity key.
CREATE TABLE payroll.employments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES payroll.employees(id),
  company_id uuid NOT NULL REFERENCES payroll.companies(id),
  joined_on date NOT NULL,
  left_on date,
  created_by uuid NOT NULL REFERENCES payroll.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, employee_id, company_id),
  CHECK (left_on IS NULL OR left_on >= joined_on)
);
CREATE TABLE payroll.employment_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employment_id uuid NOT NULL REFERENCES payroll.employments(id),
  effective_on date NOT NULL,
  employee_number text,
  department text,
  subdepartment text,
  employee_type text NOT NULL CHECK (employee_type IN ('regular','probation','intern','other')),
  regularization_date date,
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  created_by uuid NOT NULL REFERENCES payroll.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employment_id, effective_on)
);
CREATE TABLE payroll.rule_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version text NOT NULL UNIQUE,
  effective_from date NOT NULL,
  effective_to date,
  engine_version text NOT NULL,
  parameters jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(parameters) = 'object'),
  created_by uuid NOT NULL REFERENCES payroll.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE TABLE payroll.batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  month date NOT NULL CHECK (extract(day FROM month) = 1),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  workdays numeric(10,4) NOT NULL CHECK (workdays > 0 AND workdays <= 31),
  makeup_dates date[] NOT NULL DEFAULT '{}',
  settings jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(settings) = 'object'),
  stage text NOT NULL DEFAULT 'gross' CHECK (stage IN ('gross','net_generated','net_uploaded')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','confirmed','archived')),
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  current_run_id uuid,
  created_by uuid NOT NULL REFERENCES payroll.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE payroll.batch_companies (
  batch_id uuid NOT NULL REFERENCES payroll.batches(id),
  company_id uuid NOT NULL REFERENCES payroll.companies(id),
  PRIMARY KEY (batch_id, company_id)
);
CREATE TABLE payroll.files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES payroll.batches(id),
  run_id uuid,
  kind text NOT NULL CHECK (kind IN ('source','export','attachment')),
  original_name text NOT NULL,
  storage_profile text NOT NULL CHECK (length(btrim(storage_profile)) > 0),
  object_key text NOT NULL CHECK (length(btrim(object_key)) > 0),
  sha256 text CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  byte_size bigint CHECK (byte_size >= 0),
  content_type text,
  status text NOT NULL CHECK (status IN ('pending','ready','failed','missing')),
  created_by uuid NOT NULL REFERENCES payroll.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (storage_profile, object_key),
  UNIQUE (id, batch_id),
  CHECK (status <> 'ready' OR (sha256 IS NOT NULL AND byte_size IS NOT NULL)),
  CHECK (kind <> 'export' OR run_id IS NOT NULL)
);
CREATE TABLE payroll.imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES payroll.batches(id),
  file_id uuid NOT NULL,
  scope text NOT NULL CHECK (scope IN ('gross','net_generated','net_uploaded')),
  source_type text NOT NULL CHECK (source_type IN ('roster','salary','performance','attendance','other','social','fund','gross_upload','tax','after_tax','manual')),
  version integer NOT NULL CHECK (version > 0),
  parser_version text NOT NULL,
  field_mapping jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(field_mapping) = 'object'),
  issues jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(issues) = 'array'),
  sealed boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL REFERENCES payroll.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (file_id, batch_id) REFERENCES payroll.files(id, batch_id),
  UNIQUE (batch_id, scope, source_type, version),
  UNIQUE (id, batch_id),
  CHECK (source_type <> 'gross_upload' OR scope = 'net_uploaded'),
  CHECK (scope <> 'gross' OR source_type NOT IN ('tax','after_tax','gross_upload'))
);
CREATE TABLE payroll.source_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  sheet_name text NOT NULL,
  row_number integer NOT NULL CHECK (row_number > 0),
  raw_values jsonb NOT NULL CHECK (jsonb_typeof(raw_values) IN ('object','array')),
  normalized_values jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(normalized_values) = 'object'),
  mapping_status text NOT NULL DEFAULT 'unmatched' CHECK (mapping_status IN ('unmatched','matched','ignored')),
  employee_id uuid,
  employment_id uuid,
  company_id uuid,
  mapping_reason text,
  issues jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(issues) = 'array'),
  FOREIGN KEY (import_id, batch_id) REFERENCES payroll.imports(id, batch_id),
  FOREIGN KEY (employment_id, employee_id, company_id) REFERENCES payroll.employments(id, employee_id, company_id),
  FOREIGN KEY (batch_id, company_id) REFERENCES payroll.batch_companies(batch_id, company_id),
  UNIQUE (import_id, sheet_name, row_number),
  CHECK ((mapping_status = 'matched' AND employee_id IS NOT NULL AND employment_id IS NOT NULL AND company_id IS NOT NULL AND length(btrim(mapping_reason)) > 0)
    OR (mapping_status = 'unmatched' AND employee_id IS NULL AND employment_id IS NULL AND company_id IS NULL)
    OR (mapping_status = 'ignored' AND employee_id IS NULL AND employment_id IS NULL AND company_id IS NULL AND length(btrim(mapping_reason)) > 0))
);
CREATE TABLE payroll.runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES payroll.batches(id),
  version integer NOT NULL CHECK (version > 0),
  scope text NOT NULL CHECK (scope IN ('gross','net_generated','net_uploaded')),
  rule_version_id uuid NOT NULL REFERENCES payroll.rule_versions(id),
  previous_run_id uuid,
  gross_run_id uuid,
  input_snapshot jsonb NOT NULL CHECK (jsonb_typeof(input_snapshot) = 'object'),
  status text NOT NULL DEFAULT 'building' CHECK (status IN ('building','draft','confirmed','archived')),
  created_by uuid NOT NULL REFERENCES payroll.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_by uuid REFERENCES payroll.users(id),
  confirmed_at timestamptz,
  archived_at timestamptz,
  UNIQUE (batch_id, version),
  UNIQUE (id, batch_id),
  FOREIGN KEY (previous_run_id, batch_id) REFERENCES payroll.runs(id, batch_id),
  FOREIGN KEY (gross_run_id, batch_id) REFERENCES payroll.runs(id, batch_id),
  CHECK ((scope = 'net_generated') = (gross_run_id IS NOT NULL)),
  CHECK ((status IN ('confirmed','archived')) = (confirmed_at IS NOT NULL AND confirmed_by IS NOT NULL)),
  CHECK ((status = 'archived') = (archived_at IS NOT NULL))
);
ALTER TABLE payroll.batches ADD FOREIGN KEY (current_run_id, id) REFERENCES payroll.runs(id, batch_id);
ALTER TABLE payroll.files ADD FOREIGN KEY (run_id, batch_id) REFERENCES payroll.runs(id, batch_id);
CREATE TABLE payroll.run_sources (
  run_id uuid NOT NULL,
  import_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  PRIMARY KEY (run_id, import_id),
  FOREIGN KEY (run_id, batch_id) REFERENCES payroll.runs(id, batch_id),
  FOREIGN KEY (import_id, batch_id) REFERENCES payroll.imports(id, batch_id)
);
-- Salary columns are installed by migration 002 from the checked-in field contract.
CREATE TABLE payroll.items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  employment_id uuid NOT NULL,
  company_id uuid NOT NULL,
  employee_snapshot jsonb NOT NULL CHECK (jsonb_typeof(employee_snapshot) = 'object'),
  source_row_ids uuid[] NOT NULL CHECK (cardinality(source_row_ids) > 0),
  calculation_detail jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(calculation_detail) = 'object'),
  issues jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(issues) = 'array'),
  FOREIGN KEY (run_id, batch_id) REFERENCES payroll.runs(id, batch_id),
  FOREIGN KEY (employment_id, employee_id, company_id) REFERENCES payroll.employments(id, employee_id, company_id),
  FOREIGN KEY (batch_id, company_id) REFERENCES payroll.batch_companies(batch_id, company_id),
  UNIQUE (run_id, employment_id),
  UNIQUE (id, run_id)
);
CREATE TABLE payroll.adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL,
  scope text NOT NULL CHECK (scope IN ('gross','net_generated','net_uploaded')),
  employee_id uuid NOT NULL,
  employment_id uuid NOT NULL,
  company_id uuid NOT NULL,
  source_run_id uuid NOT NULL,
  field_key text NOT NULL,
  before_value jsonb NOT NULL,
  after_value jsonb NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  operation text NOT NULL DEFAULT 'set' CHECK (operation IN ('set','revoke')),
  reverses_id uuid REFERENCES payroll.adjustments(id),
  created_by uuid NOT NULL REFERENCES payroll.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (reverses_id),
  UNIQUE (id, batch_id),
  FOREIGN KEY (source_run_id, batch_id) REFERENCES payroll.runs(id, batch_id),
  FOREIGN KEY (employment_id, employee_id, company_id) REFERENCES payroll.employments(id, employee_id, company_id),
  FOREIGN KEY (batch_id, company_id) REFERENCES payroll.batch_companies(batch_id, company_id),
  CHECK ((operation = 'revoke') = (reverses_id IS NOT NULL))
);
CREATE TABLE payroll.run_adjustments (
  run_id uuid NOT NULL,
  adjustment_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  PRIMARY KEY (run_id, adjustment_id),
  FOREIGN KEY (run_id, batch_id) REFERENCES payroll.runs(id, batch_id),
  FOREIGN KEY (adjustment_id, batch_id) REFERENCES payroll.adjustments(id, batch_id)
);
CREATE TABLE payroll.reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  item_id uuid NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('accepted','needs_correction')),
  note text NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES payroll.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (item_id, run_id) REFERENCES payroll.items(id, run_id)
);
CREATE TABLE payroll.email_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL,
  run_id uuid NOT NULL,
  basis_revision integer NOT NULL,
  recipients jsonb NOT NULL CHECK (jsonb_typeof(recipients) = 'array'),
  subject text NOT NULL,
  generated_body text NOT NULL,
  manual_body text,
  details jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(details) = 'object'),
  created_by uuid NOT NULL REFERENCES payroll.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (run_id, batch_id) REFERENCES payroll.runs(id, batch_id)
);
CREATE TABLE payroll.audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id uuid NOT NULL REFERENCES payroll.users(id),
  batch_id uuid REFERENCES payroll.batches(id),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  details jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(details) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE payroll.requests (
  request_key text PRIMARY KEY CHECK (length(request_key) BETWEEN 1 AND 200),
  operation text NOT NULL,
  actor_id uuid NOT NULL REFERENCES payroll.users(id),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX employees_name_idx ON payroll.employees(name);
CREATE INDEX employments_employee_idx ON payroll.employments(employee_id, joined_on);
CREATE INDEX employments_company_idx ON payroll.employments(company_id, joined_on, left_on);
CREATE INDEX employment_number_reference_idx ON payroll.employment_changes(employee_number);
CREATE INDEX batches_month_idx ON payroll.batches(month, created_at);
CREATE INDEX batch_company_idx ON payroll.batch_companies(company_id, batch_id);
CREATE INDEX files_batch_idx ON payroll.files(batch_id, run_id);
CREATE INDEX source_rows_person_idx ON payroll.source_rows(employee_id, employment_id);
CREATE INDEX items_employee_idx ON payroll.items(employee_id, run_id);
CREATE INDEX items_company_idx ON payroll.items(company_id, run_id);
CREATE INDEX adjustments_batch_idx ON payroll.adjustments(batch_id, scope, employment_id, created_at);
CREATE INDEX reviews_item_idx ON payroll.reviews(item_id, created_at, id);
CREATE INDEX email_batch_idx ON payroll.email_drafts(batch_id, run_id);
CREATE INDEX audit_batch_idx ON payroll.audit_events(batch_id, created_at, id);

CREATE FUNCTION payroll.reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '% is append-only; create a revision', TG_TABLE_NAME USING ERRCODE = '23514'; END;
$$;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['employees','employment_changes','rule_versions','source_rows','run_sources','items','adjustments','run_adjustments','reviews','audit_events','requests'] LOOP
    EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON payroll.%I FOR EACH ROW EXECUTE FUNCTION payroll.reject_mutation()', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['users','companies','employments','batches','batch_companies','files','imports','runs','email_drafts'] LOOP
    EXECUTE format('CREATE TRIGGER no_delete BEFORE DELETE ON payroll.%I FOR EACH ROW EXECUTE FUNCTION payroll.reject_mutation()', t);
  END LOOP;
END $$;

CREATE FUNCTION payroll.guard_employment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'left_on') IS DISTINCT FROM (to_jsonb(OLD) - 'left_on') OR OLD.left_on IS NOT NULL THEN
    RAISE EXCEPTION 'Employment identity is immutable; transfer/rehire creates a new employment' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_employment BEFORE UPDATE ON payroll.employments FOR EACH ROW EXECUTE FUNCTION payroll.guard_employment();

CREATE FUNCTION payroll.guard_import() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.sealed OR NOT NEW.sealed OR (to_jsonb(NEW) - 'sealed') IS DISTINCT FROM (to_jsonb(OLD) - 'sealed') THEN
    RAISE EXCEPTION 'Imported data is immutable; create an import revision' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_import BEFORE UPDATE ON payroll.imports FOR EACH ROW EXECUTE FUNCTION payroll.guard_import();
CREATE FUNCTION payroll.guard_source_row() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM payroll.imports WHERE id = NEW.import_id AND NOT sealed FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cannot append rows to a sealed import' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_source_row BEFORE INSERT ON payroll.source_rows FOR EACH ROW EXECUTE FUNCTION payroll.guard_source_row();

CREATE FUNCTION payroll.guard_run_child() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r payroll.runs; s payroll.imports; a payroll.adjustments; sid uuid;
BEGIN
  SELECT * INTO r FROM payroll.runs WHERE id = NEW.run_id FOR UPDATE;
  IF r.status IS DISTINCT FROM 'building' THEN RAISE EXCEPTION 'Calculation snapshot is immutable; create a new run' USING ERRCODE = '23514'; END IF;
  IF TG_TABLE_NAME = 'run_sources' THEN
    SELECT * INTO s FROM payroll.imports WHERE id = NEW.import_id;
    IF NOT s.sealed OR s.scope <> r.scope THEN RAISE EXCEPTION 'Import scope differs from calculation scope' USING ERRCODE = '23514'; END IF;
  ELSIF TG_TABLE_NAME = 'run_adjustments' THEN
    SELECT * INTO a FROM payroll.adjustments WHERE id = NEW.adjustment_id;
    IF a.scope <> r.scope THEN RAISE EXCEPTION 'Adjustment scope differs from calculation scope' USING ERRCODE = '23514'; END IF;
  ELSIF TG_TABLE_NAME = 'items' THEN
    FOREACH sid IN ARRAY NEW.source_row_ids LOOP
      IF NOT EXISTS (
        SELECT 1 FROM payroll.source_rows sr
        JOIN payroll.run_sources rs ON rs.import_id = sr.import_id
        WHERE rs.run_id IN (r.id, r.gross_run_id) AND sr.id = sid AND sr.mapping_status = 'matched'
        AND sr.employee_id = NEW.employee_id AND sr.employment_id = NEW.employment_id AND sr.company_id = NEW.company_id
      ) THEN RAISE EXCEPTION 'Source row is not mapped to this employee/employment/run' USING ERRCODE = '23514'; END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_run_sources BEFORE INSERT ON payroll.run_sources FOR EACH ROW EXECUTE FUNCTION payroll.guard_run_child();
CREATE TRIGGER guard_run_adjustments BEFORE INSERT ON payroll.run_adjustments FOR EACH ROW EXECUTE FUNCTION payroll.guard_run_child();
CREATE TRIGGER guard_items BEFORE INSERT ON payroll.items FOR EACH ROW EXECUTE FUNCTION payroll.guard_run_child();

CREATE FUNCTION payroll.guard_run() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'building' THEN RAISE EXCEPTION 'Create run in building state' USING ERRCODE = '23514'; END IF;
    IF NEW.gross_run_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM payroll.runs WHERE id = NEW.gross_run_id AND scope = 'gross' AND status <> 'building') THEN
      RAISE EXCEPTION 'Generated net requires a sealed gross calculation' USING ERRCODE = '23514';
    END IF;
    IF NEW.previous_run_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM payroll.runs WHERE id = NEW.previous_run_id AND scope = NEW.scope AND status <> 'building') THEN
      RAISE EXCEPTION 'Revision must reference a prior run of the same scope' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF (to_jsonb(NEW) - ARRAY['status','confirmed_by','confirmed_at','archived_at']) IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['status','confirmed_by','confirmed_at','archived_at']) THEN
      RAISE EXCEPTION 'Run inputs are immutable' USING ERRCODE = '23514';
    END IF;
    IF NOT ((OLD.status = 'building' AND NEW.status = 'draft') OR (OLD.status = 'draft' AND NEW.status = 'confirmed') OR (OLD.status = 'confirmed' AND NEW.status = 'archived')) THEN
      RAISE EXCEPTION 'Invalid run state transition' USING ERRCODE = '23514';
    END IF;
    IF NEW.status = 'confirmed' THEN
      IF NOT EXISTS (SELECT 1 FROM payroll.items WHERE run_id = NEW.id) THEN RAISE EXCEPTION 'Empty run cannot be confirmed' USING ERRCODE = '23514'; END IF;
      IF EXISTS (SELECT 1 FROM payroll.run_sources rs JOIN payroll.source_rows sr ON sr.import_id = rs.import_id
        WHERE rs.run_id IN (NEW.id, NEW.gross_run_id) AND sr.mapping_status = 'unmatched') THEN
        RAISE EXCEPTION 'Unresolved employee mappings block confirmation' USING ERRCODE = '23514';
      END IF;
      IF EXISTS (SELECT 1 FROM payroll.items i WHERE i.run_id = NEW.id AND NOT EXISTS
        (SELECT 1 FROM payroll.reviews rv WHERE rv.item_id = i.id AND rv.outcome = 'accepted'
         AND rv.id = (SELECT id FROM payroll.reviews WHERE item_id = i.id ORDER BY created_at DESC, id DESC LIMIT 1))) THEN
        RAISE EXCEPTION 'All calculation items must be reviewed before confirmation' USING ERRCODE = '23514';
      END IF;
    END IF;
    IF OLD.status = 'confirmed' AND (NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at OR NEW.confirmed_by IS DISTINCT FROM OLD.confirmed_by) THEN
      RAISE EXCEPTION 'Confirmation metadata is immutable' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_run BEFORE INSERT OR UPDATE ON payroll.runs FOR EACH ROW EXECUTE FUNCTION payroll.guard_run();

CREATE VIEW payroll.email_draft_status AS
SELECT d.*, (d.basis_revision <> b.revision OR d.run_id IS DISTINCT FROM b.current_run_id) AS needs_regeneration
FROM payroll.email_drafts d JOIN payroll.batches b ON b.id = d.batch_id;

COMMENT ON SCHEMA payroll IS '工资数据库：员工UUID为身份，工号仅作参考；文件本体在外部存储';
COMMENT ON TABLE payroll.employments IS '每次任职单独记录，跨公司调动和复聘新建任职；离职不删除历史';
COMMENT ON TABLE payroll.source_rows IS '原始资料与本版员工关联；纠正关联使用新的导入版本';
COMMENT ON TABLE payroll.runs IS '冻结的计算快照，修订创建新版本；数据库不执行工资计算规则';
COMMENT ON TABLE payroll.files IS '仅保存外部文件元数据和不可复用的对象路径，不保存文件字节或访问密钥';
COMMENT ON TABLE payroll.requests IS '事务内幂等记录，同一请求键不能用于不同操作或内容';
