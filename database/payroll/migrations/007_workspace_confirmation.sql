-- Formal confirmation of a real, versioned workbench snapshot. A later
-- confirmation of this same workspace supersedes the batch's current run;
-- older runs and their original sources remain immutable for audit.
CREATE TABLE payroll.workspace_confirmations (
  workspace_id uuid NOT NULL,
  workspace_revision integer NOT NULL CHECK (workspace_revision > 0),
  batch_id uuid NOT NULL REFERENCES payroll.batches(id),
  run_id uuid NOT NULL REFERENCES payroll.runs(id),
  identity_mapping jsonb NOT NULL CHECK (jsonb_typeof(identity_mapping) = 'array'),
  confirmed_by uuid NOT NULL REFERENCES payroll.users(id),
  confirmed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (workspace_id,workspace_revision),
  FOREIGN KEY (workspace_id,workspace_revision) REFERENCES payroll.workspace_versions(workspace_id,revision),
  UNIQUE (run_id)
);
CREATE INDEX workspace_confirmations_latest_idx ON payroll.workspace_confirmations(workspace_id,workspace_revision DESC);

CREATE TRIGGER guard_workspace_confirmations BEFORE UPDATE OR DELETE ON payroll.workspace_confirmations
  FOR EACH ROW EXECUTE FUNCTION payroll.guard_personnel_history();
