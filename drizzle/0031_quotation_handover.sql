-- Additive only: existing quotations, costs, documents and files remain untouched.
CREATE TABLE quotation_handovers (
  id TEXT PRIMARY KEY,
  quotation_id TEXT NOT NULL,
  previous_id TEXT NOT NULL DEFAULT '',
  data_json TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (quotation_id, previous_id)
);
CREATE INDEX quotation_handovers_quote ON quotation_handovers(quotation_id, created_at);
CREATE TABLE quotation_handover_files (
  id TEXT PRIMARY KEY,
  quotation_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  object_key TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
