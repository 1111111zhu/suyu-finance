-- Generic project deletion/import operations may not alter a confirmed wage projection.
CREATE FUNCTION rd.guard_payroll_projection() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_snapshot uuid; new_snapshot uuid; active_snapshot uuid;
BEGIN
 IF TG_OP='UPDATE' AND (OLD.id LIKE 'payroll:%' OR NEW.id LIKE 'payroll:%') THEN
  RAISE EXCEPTION 'Confirmed wage projection cannot be edited directly' USING ERRCODE='23514';
 END IF;
 IF TG_OP='DELETE' AND OLD.id LIKE 'payroll:%' THEN
  old_snapshot:=split_part(OLD.id,':',2)::uuid;
  active_snapshot:=NULLIF(current_setting('rd.payroll_sync_snapshot',true),'')::uuid;
  IF active_snapshot IS NULL OR NOT EXISTS(SELECT 1 FROM rd.payroll_labor_snapshots WHERE id=active_snapshot AND supersedes=old_snapshot) THEN
   RAISE EXCEPTION 'Confirmed wage projection requires an explicit revision' USING ERRCODE='23514';
  END IF;
 END IF;
 IF TG_OP='INSERT' AND NEW.id LIKE 'payroll:%' THEN
  new_snapshot:=split_part(NEW.id,':',2)::uuid;
  active_snapshot:=NULLIF(current_setting('rd.payroll_sync_snapshot',true),'')::uuid;
  IF active_snapshot IS NULL OR active_snapshot<>new_snapshot OR NOT EXISTS(SELECT 1 FROM rd.payroll_labor_snapshots WHERE id=new_snapshot) THEN
   RAISE EXCEPTION 'Wage projection requires a confirmed snapshot' USING ERRCODE='23514';
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_payroll_projection BEFORE INSERT OR UPDATE OR DELETE ON rd.ledger_entries
 FOR EACH ROW EXECUTE FUNCTION rd.guard_payroll_projection();
