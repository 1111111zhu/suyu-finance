-- Browser work in progress. These snapshots cannot confirm wages or create identities.
CREATE TABLE payroll.workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES payroll.users(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  month date NOT NULL CHECK (extract(day FROM month)=1),
  revision integer NOT NULL CHECK (revision >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE payroll.workspace_versions (
  workspace_id uuid NOT NULL REFERENCES payroll.workspaces(id) ON DELETE RESTRICT,
  revision integer NOT NULL CHECK (revision > 0),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot)='object'),
  created_by uuid NOT NULL REFERENCES payroll.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(workspace_id,revision),
  CHECK ((snapshot->>'formatVersion'='1' AND snapshot->>'provenance' IN ('user-import','empty')) IS TRUE)
);
ALTER TABLE payroll.workspaces ADD CONSTRAINT workspace_current_version
  FOREIGN KEY(id,revision) REFERENCES payroll.workspace_versions(workspace_id,revision)
  DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX workspaces_owner_month ON payroll.workspaces(owner_id,month DESC,updated_at DESC);
CREATE TRIGGER immutable_workspace_version BEFORE UPDATE OR DELETE ON payroll.workspace_versions
  FOR EACH ROW EXECUTE FUNCTION payroll.reject_mutation();
CREATE TRIGGER no_delete_workspace BEFORE DELETE ON payroll.workspaces
  FOR EACH ROW EXECUTE FUNCTION payroll.reject_mutation();
CREATE FUNCTION payroll.guard_workspace() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id,NEW.owner_id,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.owner_id,OLD.created_at)
    OR NEW.revision <> OLD.revision+1 THEN
    RAISE EXCEPTION 'Workspace owner and history cannot be replaced; append a version' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_workspace BEFORE UPDATE ON payroll.workspaces
  FOR EACH ROW EXECUTE FUNCTION payroll.guard_workspace();
COMMENT ON TABLE payroll.workspace_versions IS 'Unconfirmed browser drafts, including unmapped inputs. Separate from confirmed payroll.runs/items.';
