CREATE TABLE rd.analysis_imports (
  id uuid PRIMARY KEY,
  scope text NOT NULL CHECK (length(scope) BETWEEN 1 AND 80),
  period date NOT NULL,
  filename text NOT NULL CHECK (length(filename) BETWEEN 1 AND 255),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  source_format text NOT NULL CHECK (source_format IN ('fixed-template', 'legacy-main-sheet')),
  project_count integer NOT NULL CHECK (project_count BETWEEN 1 AND 1000),
  total numeric(16,2) NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'superseded')),
  imported_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  superseded_at timestamptz
);

CREATE UNIQUE INDEX rd_analysis_imports_one_active_period
  ON rd.analysis_imports(scope, period) WHERE status = 'active';

CREATE TABLE rd.analysis_import_lines (
  import_id uuid NOT NULL REFERENCES rd.analysis_imports(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (length(category) BETWEEN 1 AND 160),
  amount numeric(16,2) NOT NULL,
  PRIMARY KEY (import_id, category)
);

CREATE INDEX rd_analysis_imports_period_idx
  ON rd.analysis_imports(period, scope) WHERE status = 'active';
