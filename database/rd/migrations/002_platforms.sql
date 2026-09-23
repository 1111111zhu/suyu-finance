CREATE TABLE rd.platforms (
 id text PRIMARY KEY, name text NOT NULL UNIQUE, number text, sort_order integer NOT NULL DEFAULT 0
);
ALTER TABLE rd.projects ADD COLUMN platform_id text REFERENCES rd.platforms(id);
ALTER TABLE rd.projects ADD COLUMN source_year integer;
ALTER TABLE rd.projects ADD COLUMN source_records jsonb NOT NULL DEFAULT '[]';
ALTER TABLE rd.projects DROP CONSTRAINT projects_number_key;
CREATE UNIQUE INDEX rd_project_platform_number ON rd.projects(COALESCE(platform_id,''),number);
CREATE TABLE rd.source_documents (
 sha256 text PRIMARY KEY, filename text NOT NULL, content bytea NOT NULL, imported_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE rd.calculation_runs (
 id uuid PRIMARY KEY, request_key uuid NOT NULL UNIQUE, scope text NOT NULL,
 period date NOT NULL, payload_hash text NOT NULL, payload jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE rd.ledger_entries ADD COLUMN run_id uuid REFERENCES rd.calculation_runs(id);
ALTER TABLE rd.ledger_entries DROP CONSTRAINT ledger_entries_amount_check;
CREATE INDEX rd_runs_scope_period ON rd.calculation_runs(scope,period);
