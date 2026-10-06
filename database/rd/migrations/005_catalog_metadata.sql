ALTER TABLE rd.platforms ADD COLUMN codes jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(codes)='array');
ALTER TABLE rd.projects ADD COLUMN source_status text;
ALTER TABLE rd.projects ADD COLUMN financial_entity text;
ALTER TABLE rd.projects ADD COLUMN materials jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(materials)='array');
ALTER TABLE rd.projects ADD COLUMN parent_number text;
