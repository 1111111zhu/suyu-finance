-- Independent finance credentials; no public registration or runtime account writes.
CREATE TABLE rd.password_accounts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 username text NOT NULL UNIQUE CHECK (username=btrim(username) AND length(username) BETWEEN 1 AND 256),
 display_name text NOT NULL CHECK (length(btrim(display_name))>0),
 password_hash text NOT NULL CHECK (password_hash ~ '^scrypt\$32768\$8\$1\$[0-9a-f]{32}\$[0-9a-f]{128}$'),
 role text NOT NULL CHECK (role IN ('manager','finance')),
 enabled boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE rd.password_sessions (
 token_hash text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
 account_id uuid NOT NULL REFERENCES rd.password_accounts(id) ON DELETE CASCADE,
 password_hash_snapshot text NOT NULL,
 created_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL CHECK (expires_at>created_at)
);
CREATE INDEX password_sessions_expiry ON rd.password_sessions(expires_at);
CREATE INDEX password_sessions_account ON rd.password_sessions(account_id,created_at);
CREATE TABLE rd.password_login_limits (
 kind text NOT NULL CHECK (kind IN ('account','address')),
 key_hash text NOT NULL CHECK (key_hash ~ '^[0-9a-f]{64}$'),
 failures integer NOT NULL CHECK (failures>0),
 window_started_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL CHECK (expires_at>window_started_at),
 PRIMARY KEY (kind,key_hash)
);
CREATE INDEX password_login_limits_expiry ON rd.password_login_limits(expires_at);
