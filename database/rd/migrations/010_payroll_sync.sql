CREATE TABLE rd.payroll_sync_tasks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), request_key uuid NOT NULL UNIQUE,
 payload_hash text NOT NULL, payload jsonb NOT NULL, actor_id text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','failed','completed')),
 attempts integer NOT NULL DEFAULT 0, error_code text, result jsonb,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE rd.payroll_labor_snapshots (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), task_id uuid NOT NULL UNIQUE REFERENCES rd.payroll_sync_tasks(id),
 source_batch_id uuid NOT NULL, source_run_id uuid NOT NULL, source_version integer NOT NULL,
 month date NOT NULL, revision integer NOT NULL, supersedes uuid REFERENCES rd.payroll_labor_snapshots(id),
 rule jsonb NOT NULL, source_hash text NOT NULL, personnel jsonb NOT NULL,
 allocations jsonb NOT NULL, totals jsonb NOT NULL, reason text NOT NULL, actor_id text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(source_batch_id,revision)
);
CREATE TABLE rd.payroll_labor_current (
 source_batch_id uuid PRIMARY KEY, snapshot_id uuid NOT NULL REFERENCES rd.payroll_labor_snapshots(id)
);
CREATE FUNCTION rd.reject_labor_snapshot_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Confirmed labor snapshot is immutable'; END $$;
CREATE TRIGGER immutable_labor_snapshot BEFORE UPDATE OR DELETE ON rd.payroll_labor_snapshots
 FOR EACH ROW EXECUTE FUNCTION rd.reject_labor_snapshot_mutation();
