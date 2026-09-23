CREATE TABLE rd.source_registry (
 filename text PRIMARY KEY, sha256 text REFERENCES rd.source_documents(sha256),
 status text NOT NULL CHECK(status IN ('available','file_missing')),
 note text NOT NULL DEFAULT ''
);
