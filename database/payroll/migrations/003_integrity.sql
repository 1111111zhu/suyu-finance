-- Defensive database boundaries also apply when a caller bypasses the repository.
ALTER TABLE payroll.source_rows ADD CONSTRAINT explicit_mapping_reason CHECK (
  mapping_status = 'unmatched' OR coalesce(length(btrim(mapping_reason)),0) > 0
);
ALTER TABLE payroll.batches ADD CONSTRAINT finite_workdays CHECK (workdays <> 'NaN'::numeric);

CREATE FUNCTION payroll.guard_file() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - ARRAY['status','sha256','byte_size']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','sha256','byte_size']) THEN
    RAISE EXCEPTION 'File identity and object location are immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.status IN ('ready','missing') AND (NEW.sha256 IS DISTINCT FROM OLD.sha256 OR NEW.byte_size IS DISTINCT FROM OLD.byte_size) THEN
    RAISE EXCEPTION 'Recorded file content cannot be replaced; register another file' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_file BEFORE UPDATE ON payroll.files FOR EACH ROW EXECUTE FUNCTION payroll.guard_file();

CREATE FUNCTION payroll.guard_review() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s text;
BEGIN
  SELECT status INTO s FROM payroll.runs WHERE id=NEW.run_id FOR UPDATE;
  IF s IS DISTINCT FROM 'draft' THEN RAISE EXCEPTION 'Only draft result versions can be reviewed' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_review BEFORE INSERT ON payroll.reviews FOR EACH ROW EXECUTE FUNCTION payroll.guard_review();

CREATE FUNCTION payroll.guard_adjustment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r payroll.runs; a payroll.adjustments;
BEGIN
  SELECT * INTO r FROM payroll.runs WHERE id=NEW.source_run_id;
  IF r.scope IS DISTINCT FROM NEW.scope OR r.status='building' OR NOT EXISTS
    (SELECT 1 FROM payroll.items WHERE run_id=r.id AND employee_id=NEW.employee_id AND employment_id=NEW.employment_id AND company_id=NEW.company_id) THEN
    RAISE EXCEPTION 'Adjustment must refer to this employee in the same calculation scope' USING ERRCODE='23514';
  END IF;
  IF NEW.reverses_id IS NOT NULL THEN
    SELECT * INTO a FROM payroll.adjustments WHERE id=NEW.reverses_id;
    IF a.batch_id IS DISTINCT FROM NEW.batch_id OR a.scope IS DISTINCT FROM NEW.scope OR a.employee_id IS DISTINCT FROM NEW.employee_id
       OR a.employment_id IS DISTINCT FROM NEW.employment_id OR a.field_key IS DISTINCT FROM NEW.field_key OR a.operation IS DISTINCT FROM 'set' THEN
      RAISE EXCEPTION 'Invalid adjustment reversal target' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_adjustment BEFORE INSERT ON payroll.adjustments FOR EACH ROW EXECUTE FUNCTION payroll.guard_adjustment();

CREATE FUNCTION payroll.guard_batch_state() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s text;
BEGIN
  IF NEW.revision < OLD.revision THEN RAISE EXCEPTION 'Batch revision cannot go backwards' USING ERRCODE='23514'; END IF;
  IF OLD.status <> 'draft' AND (to_jsonb(NEW) - ARRAY['status','revision','updated_at']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','revision','updated_at']) THEN
    RAISE EXCEPTION 'Reopen the batch before editing its inputs' USING ERRCODE='23514';
  END IF;
  IF NEW.status <> 'draft' THEN
    SELECT status INTO s FROM payroll.runs WHERE id=NEW.current_run_id;
    IF s IS DISTINCT FROM NEW.status THEN RAISE EXCEPTION 'Batch state must match its confirmed calculation' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_batch_state BEFORE UPDATE ON payroll.batches FOR EACH ROW EXECUTE FUNCTION payroll.guard_batch_state();

CREATE FUNCTION payroll.check_run_lineage() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b payroll.batches;
BEGIN
  IF NEW.status='confirmed' THEN
    SELECT * INTO b FROM payroll.batches WHERE id=NEW.batch_id;
    IF b.current_run_id IS DISTINCT FROM NEW.id OR b.revision <> (NEW.input_snapshot->>'basisRevision')::integer + 1 THEN
      RAISE EXCEPTION 'Stale or non-current calculation cannot be confirmed' USING ERRCODE='23514';
    END IF;
    -- A matched primary roster/gross source cannot silently disappear from results.
    IF EXISTS (SELECT 1 FROM payroll.run_sources rs JOIN payroll.imports imp ON imp.id=rs.import_id
      JOIN payroll.source_rows sr ON sr.import_id=imp.id
      WHERE rs.run_id IN (NEW.id,NEW.gross_run_id) AND imp.source_type IN ('roster','gross_upload','manual')
        AND sr.mapping_status='matched' AND NOT EXISTS (SELECT 1 FROM payroll.items i WHERE i.run_id=NEW.id AND i.employment_id=sr.employment_id)) THEN
      RAISE EXCEPTION 'A mapped employee in primary input is missing from calculation results' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER run_lineage BEFORE UPDATE ON payroll.runs FOR EACH ROW EXECUTE FUNCTION payroll.check_run_lineage();

CREATE FUNCTION payroll.require_sealed_at_commit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='imports' AND EXISTS (SELECT 1 FROM payroll.imports WHERE id=NEW.id AND NOT sealed) THEN
    RAISE EXCEPTION 'Import must be completely written and sealed before commit' USING ERRCODE='23514';
  ELSIF TG_TABLE_NAME='runs' AND EXISTS (SELECT 1 FROM payroll.runs WHERE id=NEW.id AND status='building') THEN
    RAISE EXCEPTION 'Calculation must be completely written and sealed before commit' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER complete_import AFTER INSERT ON payroll.imports DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION payroll.require_sealed_at_commit();
CREATE CONSTRAINT TRIGGER complete_run AFTER INSERT ON payroll.runs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION payroll.require_sealed_at_commit();
