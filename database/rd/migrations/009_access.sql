CREATE TABLE rd.access_sessions (
 token_hash text PRIMARY KEY CHECK(length(token_hash)=64),
 corp_id text NOT NULL, userid text NOT NULL, display_name text NOT NULL,
 role text NOT NULL CHECK(role IN ('manager','finance','none')),
 checked_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '8 hours'
);
CREATE INDEX access_sessions_expiry ON rd.access_sessions(expires_at);
CREATE TABLE rd.access_oauth_states (
 state_hash text PRIMARY KEY, expires_at timestamptz NOT NULL DEFAULT now()+interval '10 minutes'
);
