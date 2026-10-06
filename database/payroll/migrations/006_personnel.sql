-- The WeCom directory is an observed reference, never a payroll identity source.
-- A successful sync is atomic; its first observation is a baseline, not mass hiring.
CREATE TABLE payroll.wecom_directory_syncs (
  corp_id text PRIMARY KEY,
  synced_at timestamptz NOT NULL,
  department_count integer NOT NULL CHECK (department_count >= 0),
  member_count integer NOT NULL CHECK (member_count >= 0)
);

CREATE TABLE payroll.wecom_departments (
  corp_id text NOT NULL,
  department_id text NOT NULL,
  name text NOT NULL,
  parent_id text NOT NULL,
  display_order integer NOT NULL DEFAULT 0,
  leader_userid text,
  active boolean NOT NULL DEFAULT true,
  observed_at timestamptz NOT NULL,
  PRIMARY KEY (corp_id, department_id)
);
CREATE INDEX wecom_departments_current_idx ON payroll.wecom_departments(corp_id, active, parent_id, display_order, department_id);

CREATE TABLE payroll.wecom_members (
  corp_id text NOT NULL,
  userid text NOT NULL,
  name text NOT NULL,
  department_ids jsonb NOT NULL CHECK (jsonb_typeof(department_ids) = 'array'),
  position text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  observed_at timestamptz NOT NULL,
  PRIMARY KEY (corp_id, userid)
);
CREATE INDEX wecom_members_current_idx ON payroll.wecom_members(corp_id, active, name, userid);

CREATE TABLE payroll.wecom_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  corp_id text NOT NULL,
  userid text NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('joined_visible','no_longer_visible','department_changed','position_changed','name_changed')),
  previous_synced_at timestamptz,
  current_synced_at timestamptz NOT NULL,
  detected_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  before_value jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(before_value) = 'object'),
  after_value jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(after_value) = 'object'),
  reason text NOT NULL CHECK (length(btrim(reason)) > 0)
);
CREATE INDEX wecom_events_history_idx ON payroll.wecom_events(corp_id, detected_at DESC, id);
CREATE INDEX wecom_events_member_idx ON payroll.wecom_events(corp_id, userid, detected_at DESC);

CREATE TABLE payroll.wecom_employee_links (
  corp_id text NOT NULL,
  userid text NOT NULL,
  employee_id uuid NOT NULL REFERENCES payroll.employees(id),
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  created_by uuid NOT NULL REFERENCES payroll.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_by uuid NOT NULL REFERENCES payroll.users(id),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (corp_id, userid),
  UNIQUE (employee_id),
  FOREIGN KEY (corp_id, userid) REFERENCES payroll.wecom_members(corp_id, userid)
);

CREATE TABLE payroll.personnel_rosters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  corp_id text NOT NULL,
  source_name text NOT NULL CHECK (length(btrim(source_name)) > 0),
  sheet_name text NOT NULL CHECK (length(btrim(sheet_name)) > 0),
  payroll_month date CHECK (payroll_month IS NULL OR EXTRACT(day FROM payroll_month) = 1),
  source_hash text CHECK (source_hash IS NULL OR source_hash ~ '^[0-9a-f]{64}$'),
  imported_by uuid NOT NULL REFERENCES payroll.users(id),
  imported_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  row_count integer NOT NULL CHECK (row_count BETWEEN 1 AND 20000)
);
CREATE INDEX personnel_rosters_recent_idx ON payroll.personnel_rosters(corp_id, imported_at DESC);

-- Deliberately excludes identity documents and all bank fields. Raw spreadsheet
-- values remain in the client/private payroll import, not in this directory log.
CREATE TABLE payroll.personnel_roster_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  roster_id uuid NOT NULL REFERENCES payroll.personnel_rosters(id),
  row_number integer NOT NULL CHECK (row_number > 0),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  employee_number text,
  company text,
  department text,
  subdepartment text,
  third_department text,
  position text,
  employee_type text,
  employee_status text,
  joined_on date,
  regularization_on date,
  left_on date,
  field_sources jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(field_sources) = 'object'),
  employee_id uuid REFERENCES payroll.employees(id),
  wecom_userid text,
  linked_by uuid REFERENCES payroll.users(id),
  linked_at timestamptz,
  UNIQUE (roster_id, row_number),
  CHECK ((employee_id IS NULL AND wecom_userid IS NULL AND linked_by IS NULL AND linked_at IS NULL)
      OR (employee_id IS NOT NULL AND wecom_userid IS NOT NULL AND linked_by IS NOT NULL AND linked_at IS NOT NULL))
);
CREATE INDEX personnel_roster_rows_employee_idx ON payroll.personnel_roster_rows(employee_id, roster_id);

CREATE FUNCTION payroll.guard_personnel_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Personnel observation history is append-only' USING ERRCODE='23514';
END $$;
CREATE TRIGGER guard_wecom_events BEFORE UPDATE OR DELETE ON payroll.wecom_events
  FOR EACH ROW EXECUTE FUNCTION payroll.guard_personnel_history();
CREATE TRIGGER guard_personnel_rosters BEFORE UPDATE OR DELETE ON payroll.personnel_rosters
  FOR EACH ROW EXECUTE FUNCTION payroll.guard_personnel_history();

CREATE FUNCTION payroll.guard_personnel_roster_row() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - ARRAY['employee_id','wecom_userid','linked_by','linked_at'])
     IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['employee_id','wecom_userid','linked_by','linked_at']) THEN
    RAISE EXCEPTION 'Roster source fields are immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_personnel_roster_row BEFORE UPDATE ON payroll.personnel_roster_rows
  FOR EACH ROW EXECUTE FUNCTION payroll.guard_personnel_roster_row();
CREATE TRIGGER guard_personnel_roster_row_delete BEFORE DELETE ON payroll.personnel_roster_rows
  FOR EACH ROW EXECUTE FUNCTION payroll.guard_personnel_history();
