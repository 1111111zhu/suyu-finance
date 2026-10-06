CREATE TABLE rd.platform_ledger_entries (
  id uuid PRIMARY KEY,
  platform_id text NOT NULL REFERENCES rd.platforms(id) ON DELETE RESTRICT,
  source_code text NOT NULL CHECK (length(source_code) BETWEEN 1 AND 80),
  entry_date date NOT NULL,
  category text NOT NULL CHECK (length(category) BETWEEN 1 AND 160),
  amount numeric(16,2) NOT NULL,
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 1000),
  run_id uuid NOT NULL REFERENCES rd.calculation_runs(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (run_id, source_code, category)
);

CREATE INDEX rd_platform_ledger_platform_date_idx
  ON rd.platform_ledger_entries(platform_id, entry_date DESC);

CREATE INDEX rd_platform_ledger_run_idx
  ON rd.platform_ledger_entries(run_id);
