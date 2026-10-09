ALTER TABLE rd.access_sessions DROP CONSTRAINT access_sessions_role_check;
ALTER TABLE rd.access_sessions ADD CONSTRAINT access_sessions_role_check
  CHECK (role IN ('manager', 'finance', 'none', 'payroll', 'finance_payroll'));
