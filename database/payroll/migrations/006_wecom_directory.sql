-- Enterprise WeChat directory is a separate, read-only reference for payroll.
-- It never creates or updates payroll.employees or employment/pay records.
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
  leader_userid text,
  active boolean NOT NULL DEFAULT true,
  observed_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (corp_id, department_id)
);

CREATE TABLE payroll.wecom_members (
  corp_id text NOT NULL,
  userid text NOT NULL,
  name text NOT NULL,
  department_ids jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(department_ids) = 'array'),
  direct_leader_userid text,
  position text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  observed_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (corp_id, userid)
);

CREATE INDEX wecom_departments_active_idx ON payroll.wecom_departments (corp_id, active, name);
CREATE INDEX wecom_members_active_idx ON payroll.wecom_members (corp_id, active, name);
