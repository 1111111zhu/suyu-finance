ALTER TABLE rd.platforms ADD COLUMN deleted_at timestamptz;
ALTER TABLE rd.platforms ADD COLUMN deletion_group uuid;
ALTER TABLE rd.projects ADD COLUMN deleted_at timestamptz;
ALTER TABLE rd.projects ADD COLUMN deletion_group uuid;
CREATE UNIQUE INDEX rd_project_number_global ON rd.projects(upper(number));
CREATE UNIQUE INDEX rd_platform_number_global ON rd.platforms(upper(number)) WHERE number IS NOT NULL;
ALTER TABLE rd.ledger_entries DROP CONSTRAINT ledger_entries_project_id_fkey;
ALTER TABLE rd.ledger_entries ADD CONSTRAINT ledger_entries_project_id_fkey FOREIGN KEY(project_id) REFERENCES rd.projects(id) ON DELETE RESTRICT;
