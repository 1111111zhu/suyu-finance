ALTER TABLE rd.calculation_runs
  ADD COLUMN status text NOT NULL DEFAULT 'confirmed'
    CHECK (status IN ('confirmed', 'superseded')),
  ADD COLUMN confirmed_at timestamptz,
  ADD COLUMN superseded_at timestamptz,
  ADD COLUMN superseded_by uuid REFERENCES rd.calculation_runs(id);

WITH ranked AS (
  SELECT id,
         row_number() OVER (PARTITION BY scope, period ORDER BY created_at DESC, id DESC) AS position
  FROM rd.calculation_runs
)
UPDATE rd.calculation_runs AS run
SET status = CASE WHEN ranked.position = 1 THEN 'confirmed' ELSE 'superseded' END,
    confirmed_at = CASE WHEN ranked.position = 1 THEN run.created_at ELSE NULL END,
    superseded_at = CASE WHEN ranked.position = 1 THEN NULL ELSE run.created_at END
FROM ranked
WHERE ranked.id = run.id;

CREATE UNIQUE INDEX rd_one_confirmed_run_per_scope_period
  ON rd.calculation_runs(scope, period)
  WHERE status = 'confirmed';

ALTER TABLE rd.projects
  ADD COLUMN start_date date,
  ADD COLUMN end_date date,
  ADD COLUMN completed_at timestamptz,
  ADD CONSTRAINT rd_project_dates_valid
    CHECK (start_date IS NULL OR end_date IS NULL OR start_date <= end_date);

CREATE TABLE rd.project_documents (
  id uuid PRIMARY KEY,
  project_id text NOT NULL REFERENCES rd.projects(id) ON DELETE RESTRICT,
  document_type text NOT NULL CHECK (document_type IN ('initiation_charter')),
  filename text NOT NULL,
  sha256 text NOT NULL CHECK (length(sha256) = 64),
  mime_type text NOT NULL,
  content bytea NOT NULL,
  extracted_text text NOT NULL DEFAULT '',
  ocr_status text NOT NULL DEFAULT 'completed'
    CHECK (ocr_status IN ('completed', 'partial', 'manual')),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (project_id, sha256)
);

CREATE INDEX rd_project_documents_project_idx
  ON rd.project_documents(project_id, created_at DESC);
