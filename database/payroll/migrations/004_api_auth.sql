-- Operational authentication state only; never seed demo or production users.
-- Apply with the migration owner. Runtime role names/GRANTs belong in admin.mjs.
CREATE TABLE payroll.auth_sessions (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid NOT NULL REFERENCES payroll.users(id) ON DELETE RESTRICT,
  csrf_token text NOT NULL CHECK (csrf_token ~ '^[A-Za-z0-9_-]{43}$'),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  CHECK (expires_at = created_at + interval '8 hours')
);
CREATE INDEX auth_sessions_expiry_idx ON payroll.auth_sessions(expires_at);
CREATE INDEX auth_sessions_user_created_idx
  ON payroll.auth_sessions(user_id, created_at DESC, token_hash);

CREATE TABLE payroll.auth_login_limits (
  kind text NOT NULL CHECK (kind IN ('account', 'address')),
  key_hash text NOT NULL CHECK (key_hash ~ '^[0-9a-f]{64}$'),
  failures integer NOT NULL CHECK (
    failures >= 1 AND failures <= CASE WHEN kind = 'account' THEN 5 ELSE 30 END
  ),
  window_started_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (kind, key_hash),
  CHECK (expires_at = window_started_at + interval '15 minutes')
);
CREATE INDEX auth_login_limits_expiry_idx ON payroll.auth_login_limits(expires_at);

COMMENT ON TABLE payroll.auth_sessions IS
  '可清理的8小时会话；仅保存登录token的SHA256，CSRF随机值供已认证session接口返回；不保存密码或明文登录token';
COMMENT ON TABLE payroll.auth_login_limits IS
  '可清理的15分钟登录失败窗口；规范化用户名和IP分别哈希；服务限制最多10000行，成功清除账户失败，IP失败保留到窗口结束';

-- Minimum runtime permissions (provisioned separately by admin.mjs):
-- USAGE ON SCHEMA payroll;
-- SELECT (id, username, display_name, password_hash, enabled) ON payroll.users;
-- SELECT, INSERT, DELETE ON payroll.auth_sessions;
-- SELECT, INSERT, DELETE ON payroll.auth_login_limits;
-- UPDATE (failures) ON payroll.auth_login_limits;
-- No new sequences, user writes, salary DELETEs, or SECURITY DEFINER functions.
