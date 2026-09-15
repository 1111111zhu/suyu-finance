-- Read-only examples. Use SQL parameters in application code.
-- 1. Monthly batches (same month can have multiple batches).
SELECT id,month,name,stage,status,revision,current_run_id
FROM payroll.batches
ORDER BY month DESC,created_at DESC;

-- 2. Companies in each batch; a batch can include all three companies.
SELECT b.id AS batch_id,b.month,b.name,c.name AS company
FROM payroll.batches b
JOIN payroll.batch_companies bc ON bc.batch_id=b.id
JOIN payroll.companies c ON c.id=bc.company_id
ORDER BY b.month DESC,b.id,c.name;

-- 3. Current selected result per batch; never sum all historical revisions.
SELECT b.month,b.name,b.status,t.*
FROM payroll.batches b
JOIN payroll.run_company_totals t ON t.run_id=b.current_run_id
ORDER BY b.month DESC,b.id,t.company_id;

-- 4. Historical salary: employee identity and the historical snapshot are both kept.
SELECT b.month,r.version,r.scope,r.status,i.employee_id,i.employment_id,
       i.employee_snapshot->>'name' AS employee_name,
       i.employee_snapshot->>'companyName' AS company_name,
       i.employee_snapshot->>'department' AS department,
       i.employee_snapshot->>'employeeNumber' AS reference_number,
       i.gross,i.social,i.fund,i.tax,i.net,i.company_cost
FROM payroll.items i
JOIN payroll.runs r ON r.id=i.run_id
JOIN payroll.batches b ON b.id=i.batch_id
ORDER BY b.month DESC,r.version DESC,i.employee_id;

-- 5. Unresolved identity mappings (a missing name this month does not mean departure).
SELECT i.batch_id,i.scope,i.source_type,i.version,s.sheet_name,s.row_number,s.issues
FROM payroll.source_rows s JOIN payroll.imports i ON i.id=s.import_id
WHERE s.mapping_status='unmatched'
ORDER BY i.batch_id,i.version,s.sheet_name,s.row_number;

-- 6. Stale salary explanation drafts.
SELECT id,batch_id,run_id,subject,needs_regeneration FROM payroll.email_draft_status
ORDER BY created_at DESC;

-- 7. File metadata only; use the storage adapter to fetch the actual protected object.
SELECT id,batch_id,run_id,kind,original_name,storage_profile,object_key,sha256,byte_size,status
FROM payroll.files ORDER BY created_at DESC;
