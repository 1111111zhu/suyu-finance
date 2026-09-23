CREATE TABLE rd.annual_platforms (
  code text PRIMARY KEY,
  platform_id text NOT NULL REFERENCES rd.platforms(id),
  source_year integer NOT NULL,
  name text NOT NULL,
  source_row integer NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (platform_id, source_year)
);

ALTER TABLE rd.projects ADD COLUMN annual_platform_code text REFERENCES rd.annual_platforms(code);
ALTER TABLE rd.projects ADD COLUMN source_name text;
ALTER TABLE rd.projects ADD COLUMN project_manager text;
ALTER TABLE rd.projects ADD COLUMN raw_status text;
ALTER TABLE rd.projects ADD COLUMN source_remark text;

CREATE TABLE rd.project_detail_rows (
  project_id text NOT NULL REFERENCES rd.projects(id) ON DELETE CASCADE,
  source_row integer NOT NULL,
  material_code text,
  source_name text,
  project_manager text,
  raw_status text,
  source_remark text,
  raw_cells jsonb NOT NULL,
  PRIMARY KEY (project_id, source_row)
);

CREATE TABLE rd.master_imports (
  sha256 text PRIMARY KEY REFERENCES rd.source_documents(sha256),
  filename text NOT NULL,
  platform_count integer NOT NULL,
  project_count integer NOT NULL,
  detail_count integer NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
