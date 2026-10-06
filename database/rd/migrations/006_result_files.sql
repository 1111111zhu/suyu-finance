CREATE TABLE rd.result_files (
 run_id uuid PRIMARY KEY REFERENCES rd.calculation_runs(id) ON DELETE RESTRICT,
 filename text NOT NULL,
 sha256 text NOT NULL CHECK(length(sha256)=64),
 content bytea NOT NULL CHECK(octet_length(content) BETWEEN 4 AND 31457280),
 created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE rd.calculation_runs ADD COLUMN revision bigint GENERATED ALWAYS AS IDENTITY;
ALTER TABLE rd.calculation_runs ALTER COLUMN created_at SET DEFAULT clock_timestamp();
CREATE INDEX rd_runs_export_latest ON rd.calculation_runs(scope,period,created_at DESC,revision DESC);
