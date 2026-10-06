-- Compatibility for the earlier, read-only WeCom popup. The personnel
-- migration owns the directory tables and event history; never create a
-- second copy of those tables here.
ALTER TABLE payroll.wecom_members
  ADD COLUMN IF NOT EXISTS direct_leader_userid text;

CREATE INDEX IF NOT EXISTS wecom_departments_active_idx
  ON payroll.wecom_departments (corp_id, active, name);
CREATE INDEX IF NOT EXISTS wecom_members_active_idx
  ON payroll.wecom_members (corp_id, active, name);
