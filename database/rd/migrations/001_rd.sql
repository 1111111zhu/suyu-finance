CREATE SCHEMA IF NOT EXISTS rd;

CREATE TABLE rd.projects (
  id text PRIMARY KEY,
  number text NOT NULL UNIQUE,
  name text NOT NULL,
  status text NOT NULL CHECK (status IN ('init', 'active', 'completed')),
  budget numeric(16,2) NOT NULL CHECK (budget >= 0),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (length(id) BETWEEN 1 AND 120),
  CHECK (length(number) BETWEEN 1 AND 80),
  CHECK (length(name) BETWEEN 1 AND 300)
);

CREATE TABLE rd.ledger_entries (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES rd.projects(id) ON DELETE CASCADE,
  entry_date date NOT NULL,
  category text NOT NULL,
  amount numeric(16,2) NOT NULL CHECK (amount >= 0),
  description text NOT NULL DEFAULT '',
  source text NOT NULL CHECK (source IN ('calculation', 'import', 'manual')),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (length(id) BETWEEN 1 AND 120),
  CHECK (length(category) BETWEEN 1 AND 160),
  CHECK (length(description) <= 1000)
);

CREATE INDEX rd_ledger_entries_project_date_idx ON rd.ledger_entries(project_id, entry_date DESC);
CREATE INDEX rd_ledger_entries_calculation_idx ON rd.ledger_entries(project_id, source, entry_date) WHERE source = 'calculation';

CREATE TABLE rd.import_requests (
  request_key uuid PRIMARY KEY,
  payload_hash text NOT NULL,
  project_count integer NOT NULL,
  ledger_count integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (length(payload_hash) = 64),
  CHECK (project_count >= 0),
  CHECK (ledger_count >= 0)
);
